# ADR: 双内核对齐与灰度（kernel_parity）

## 状态

已接受（2026-09，批次 3）。本 ADR 与 `unified-kernel-policy.md` 并行生效：后者定
「默认值的原则」，本文件定「差异如何被度量、灰度如何扩大」。

## 背景

桌面端有两条 agent 执行路径，都不删除：

1. **自研循环**：`crates/desktop/wth-desktop/src/ipc/agent.rs` 自己做
   chat/completions + 工具调用；工具与权限判定在 `src/ipc/tools.rs`（8 个工具、
   危险命令规则库、沙箱档位）。
2. **内核 ACP 桥**：`src/ipc/acp_bridge.rs` 经
   `xai_grok_shell::leader::connect_or_spawn` 连本机 `wth` leader，与 TUI 同源，
   工具/审批/技能走内核全量生态。

在此之前，两者的能力面差异只以文字形式散落在注释与 ADR 里，无法验证、也无法
发现新引入的偏差。内核工具注册表（`wth-tools`，lib `xai_grok_tools`）与桌面自研
工具集是两套独立命名与粒度，审批档位也是两套模型（桌面四档 ⇄ 内核两标志 +
三态 session mode）。

## 决策

1. **对齐测试进 CI，且只测静态能力面与协议映射。**
   `crates/desktop/wth-desktop/tests/kernel_parity.rs` 不依赖真实模型、不依赖已安装
   的 `wth` CLI、不开网络：
   - 桌面侧清单从 `src/ipc/tools.rs` / `src/settings.rs` 的**源码文本**解析
     （`include_str!`），断言「`build_tools()` 声明 == `execute_tool()` 实现」；
   - 内核侧清单来自真实的 `ToolRegistryBuilder::new().known_tool_ids()`，
     通过显式别名表 `TOOL_ALIASES` 断言**语义覆盖 100%**（硬断言）；
   - 审批档位与降级判定提取为 `src/ipc/approval_mode.rs`（只依赖 std 的叶子模块，
     测试用 `#[path]` 原样编进去），因此断言的是运行时真正执行的那份映射。
2. **已知差异「记录而非失败」，但用双向棘轮锁死。** 观测到的差异集合必须
   **恰好等于** `KNOWN_GAPS`：新差异 → 红；差异被修复而登记表未清理 → 同样红。
   因此本文件第「已知差异」表不会腐烂成免罪金牌。
3. **`kernel_agent` 改条件默认值。** `settings::load_settings` 只在「本机没有**可解析**的
   settings.json」（文件缺失，或内容损坏到无法反序列化）时按内核可定位性取
   `true`/`false`；有可解析记录（含缺字段的老配置，由 `#[serde(default)]` 落到
   `false`）一律沿用存值。持久化格式与向后兼容不变，`DesktopSettings::default()` 的
   无条件基线仍是 `false`，损坏文件因此与全新安装同权（两者都不存在「用户曾做过
   的选择」）。内核可定位性由 `settings::kernel_binary_path` 判定：设置里的显式路径
   → `WTH_LEADER_BIN` → 与主程序同目录（捆绑分发场景）→ `PATH`；只用环境变量与文件
   系统，不引入 `which` 依赖、不发网络请求。探针经 `load_settings_with` 注入，单测
   不触碰真实 `PATH`。
4. **降级必须留痕。** `approval_mode::kernel_route` 是 `agent_send` 唯一的分支来源；
   降级时 `tracing::warn!` 文案不变，并额外写入 `state.log_buffer`，复用既有
   `diagnostics_get` 的「最近日志」项与 `log_list` 命令（设置 → 诊断）；
   `acp_status` 增返 `kernel_binary` 字段，使 UI 能解释灰度默认值为何是 off。
   全程不新建面板、不改 `ui/**`。

## 已知差异

| # | 差异 | 位置 | 影响 | 登记表条目 |
|---|------|------|------|-----------|
| D1 | 工具命名不通用：桌面 8 个工具里有 6 个在内核注册表里不是字面短 id —— 见下方映射表。仅 `bash`、`web_search` 字面一致 | `src/ipc/tools.rs::build_tools` ⇄ `wth-tools/src/registry/types.rs::ToolRegistryBuilder::new` | 同一份会话历史与提示词不能跨内核直接搬运；按工具名做的日志检索、审批记录回放在两档下不可比（`UsageStats::tool_calls_ok/fail` 只按成功失败聚合，不带名字，所以两档间同样无法归因） | `tool-name:file_read`、`tool-name:file_write`、`tool-name:file_edit`、`tool-name:file_list`、`tool-name:file_search`、`tool-name:git` |
| D2 | 工具粒度/归属不同：桌面 `git` 一个工具收任意子命令数组，内核拆 `GrokBuild:git_status`/`git_diff`/`git_log`/`git_commit` 四个；桌面 `file_write`/`file_edit` 在内核没有单一等价物，只能落到跨 namespace 的多个实现，`bash` 更是只有 `OpenCode:bash`（GrokBuild 系里没有同名项） | `tools.rs::git_risk` ⇄ `implementations/grok_build/git/`、`implementations/{opencode,codex,grok_build_hashline}/` | 桌面能 `git push`/`rebase`/`stash`，内核档位下**没有这些能力**；反之内核的写操作分档在桌面上退化成 `git_risk` 的三档启发式。file_write/file_edit 的「多实现」意味着切内核后落盘语义（是否整文件覆盖、是否走 hashline 校验）随所选 namespace 而变 | `tool-granularity:git`、`tool-granularity:file_write`、`tool-granularity:file_edit` |
| D3 | `file_delete` 只出现在审批判定里，既未声明也未实现 | `tools.rs::needs_approval`（`tool_name == "file_delete"`） | 死分支：`is_sensitive_path` / `is_forbidden_system_path` 对删除的保护当前无实际生效路径；将来若补删除工具，容易绕过 `build_tools()` 白名单 | `tool-undeclared:file_delete` |
| D4 | 桌面四档在内核侧塌缩为 3 种有效组合：`plan` 与 `review` 都是 `(yolo=false, auto=false)` | `src/ipc/approval_mode.rs::APPROVAL_MODE_MAP` | 切内核后 Plan 与 Review 行为无差别；桌面「计划模式所有写操作均需确认」的语义由内核默认档近似承担 | `mode:plan-review-collapse` |
| D5 | 桌面从不下发内核 `SessionMode`（`default`/`plan`/`ask` 三档均在，`as_id()` 可用） | `acp_bridge.rs::build_session_new`（无 mode 字段）；参照 `wth-pager/src/app/dispatch/modes.rs` | 内核真正的 plan 模式（禁写、先出计划）在桌面档位下**不可达**，桌面 Plan 只是「全部要确认」 | `mode:session-mode-never-sent` |
| D6 | 桌面只填 `ClientCapabilities` 的 `yolo_mode`/`auto_mode`/`client_version`/`default_model`，不声明 `terminal`/`fs_read`/`fs_write`/`code_nav_enabled` | `acp_bridge.rs::AcpKernel::connect` | **最实质的一条**：内核档位下 shell 与文件读写由 leader 自己执行，桌面的 PTY 终端、`sandbox_profile`（restricted 受限 Token）、`bash_memory_limit_mb`、工作区越界路径校验全部不生效 | `bridge:client-capabilities-partial` |
| D7 | 桌面的危险命令/敏感路径/系统目录规则库（`is_dangerous_shell`、`is_sensitive_path`、`is_forbidden_system_path`）不参与内核档位判定 | `tools.rs::needs_approval` ⇄ `wth-workspace/src/permission/types.rs::AccessKind` | YOLO 档「危险命令仍强制确认」这条红线在内核路径上由内核 classifier 决定，桌面无法保证与自研循环一致 | `bridge:no-desktop-side-dangerous-command-gate` |

差异不视为缺陷的判据：D1/D2/D4 是概念模型不同，D5/D6/D7 是待补的接线，D3 是死代码。
其中 **D6 与 D7 是灰度扩大的阻塞项**（安全语义不等价），D3 应顺手清理。

### D1/D2 的证据：工具映射表

内核侧限定名由 `kernel_parity::kernel_registry_is_populated` 在每次 CI 运行时打印，
下表是 2026-09 的输出快照（别名表在 `tests/kernel_parity.rs::TOOL_ALIASES`）。

| 桌面工具 | 内核短 id | 内核限定名（实测） |
|---------|-----------|------------------|
| `file_read` | `read_file` | `GrokBuild:read_file`（另有 Codex / GrokBuildConcise 变体） |
| `file_write` | `write`, `apply_patch` | `OpenCode:write`, `Codex:apply_patch` |
| `file_edit` | `search_replace`, `edit`, `hashline_edit` | `GrokBuild:search_replace`, `OpenCode:edit`, `GrokBuildHashline:hashline_edit` |
| `file_list` | `list_dir` | `GrokBuild:list_dir`（另有 `Codex:list_dir`） |
| `file_search` | `glob` | `OpenCode:glob` |
| `bash` | `bash` | `OpenCode:bash` |
| `git` | `git_status`, `git_diff`, `git_log`, `git_commit` | `GrokBuild:git_*` |
| `web_search` | `web_search` | `GrokBuild:web_search` |

## 如何扩大灰度

指标只能来自本机（项目主张无遥测），回收方式是诊断面板 / `doctor` 导出，人工汇总。

| 指标 | 定义 | 取数位置 |
|------|------|---------|
| 内核命中率 | `UseKernel` 轮次 ÷ `kernel_agent=true` 轮次 | `state.log_buffer` 中 `FALLBACK_LOG_PREFIX` 出现次数（分母取会话数） |
| 降级率与原因分布 | `FallbackToLegacy` 占比，按 reason 分类：未定位到二进制 / `connect_or_spawn` 失败 / 握手超时（30s） / `session/new` 缺 sessionId | `agent.rs` 降级 warn 文案 + `acp_status.kernel_binary` |
| 审批密度差 | 同一 `edit_mode` 下 `ToolCallStart(needs_approval=true)` 的比例差 | `agent:stream` 事件（自研侧）⇄ `session/request_permission`（内核侧） |
| 能力回退投诉 | 用户在 Plan 档发现「没被拦住」/在 YOLO 档发现「比预期更保守」的反馈计数 | 人工回收，无自动通道 |

扩大灰度的下一步条件（按顺序）：

1. **前置**：D6、D7 关闭 —— 桌面在 `ClientCapabilities` 里声明 `terminal`/`fs_read`/
   `fs_write`，或把沙箱与危险命令判定以 `AccessKind` 形式随 `session/new` 下发。
   在此之前，`kernel_agent` 的灰度范围仅限「无沙箱需求」的装机。
2. **捆绑分发**：`wth` CLI 与安装包同目录发布后，`settings::kernel_binary_path` 的第
   3 顺位（current_exe 同目录）自然命中，新装用户默认即为内核路径 —— 这正是
   `unified-kernel-policy.md`「后果」一节预留的评估触发点。
3. **观察一个发布周期**：降级率 < 1%、且降级原因分布里不存在「握手成功但
   `session/prompt` 失败」这一类，才把 `DesktopSettings::default()` 的无条件基线也
   翻成开启。
4. **收敛命名**：灰度稳定后再决定桌面工具面是否直接换成内核 id（会破 D1 登记条目，
   届时 `gap_records_are_not_stale` 会强制删条目并更新本表）。

## 后果

- **无需新增 CI job**：`.github/workflows/desktop-ci.yml` 的 `cargo test -p wth-desktop`
  已经会跑 `tests/kernel_parity.rs`（集成测试随包发现），同文件的
  `cargo clippy --no-deps -p wth-desktop --all-targets -- -D warnings` 也覆盖测试本身。
  代价是该测试把 `wth-tools` 拉进桌面测试的编译闭包 —— 在 desktop-ci 上是分钟级
  增量，因为 `wth-shell` 本就依赖它。
- `wth-desktop` 的 `[dev-dependencies]` 新增 `wth-tools`。刻意不进 `[dependencies]`：
  `wth-shell` 已传递依赖 `wth-tools`，编译产物复用，故 dev-dep 无额外编译成本，但
  避免了把内核符号表重新焊回自研循环路径的链接面。
- `approval_mode.rs` 必须是只依赖 std 的叶子模块（测试用 `#[path]` 编入），这条约束
  写在模块头注释里。
- `settings::validate` 的 `edit_mode` 白名单不再是字面量，改由 `DESKTOP_APPROVAL_MODES`
  提供；这是本次唯一的**非行为性**结构改动（取值集合完全相同）。

## 参考

- `docs/adr/unified-kernel-policy.md`
- `crates/desktop/wth-desktop/tests/kernel_parity.rs`
- `crates/codegen/xai-grok-tools/src/registry/types.rs`
- `crates/codegen/xai-grok-shell/src/leader/protocol.rs`
