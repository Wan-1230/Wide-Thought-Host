# WTH 优化变更说明（阶段 4 · M1/M2 第一批）

| 项目 | 内容 |
|---|---|
| 文档类型 | 阶段 4 交付物：变更说明与效果验证（按 PRD 要求随模块同步输出） |
| 日期 | 2026-09-05 |
| 对应 PRD | `docs/WTH-优化PRD.md` v1.0 · 覆盖 M1 全部 + M2 的 F-01/A-02/F-04 |
| 变更基线 | v1.0.0 @ `3dcf234`（未提交，全部改动在工作区，可 `git diff` 审查） |

---

## 1. S-01 · 清除硬编码 API Key + 密钥扫描门禁（P0 ✅）

**变更**
- 删除 `crates/desktop/wth-desktop/src/main.rs` 中内置 "Agnes AI" Key 的明文种子逻辑（历史提交 `abd3978` 引入）。
- 密钥缺失时的报错改为可操作引导："请先在设置中配置 API Key，或在设置 → 模型与 API 中检测并使用本地模型（Ollama/vLLM）"（`ipc/agent.rs`、`ipc/subagents.rs`、`ipc/workflow.rs` 三处调用点统一）。
- 新增 `.github/workflows/secret-scan.yml`：gitleaks 扫描（push/PR/每日全量历史）。
- 新增 `.gitleaks.toml`：对历史提交 `abd3978` 做一次性豁免，并注明**该 Key 需在服务端吊销**（PRD 风险 RK2——本地无法执行）。

**效果验证**
- 全仓 `grep "sk-49YlKg3"` 仅剩 git 历史（工作区源码零命中）。
- 桌面端行为：新装环境默认 Provider 无 Key 时不再静默注入，而是给出双路径引导（配置云端 Key / 一键使用本地模型）。

## 2. F-01 · 本地模型一等公民（P0 ✅ Rust + UI；CLI 侧列入后续）

**变更**
- 新增 `crates/desktop/wth-desktop/src/ipc/local_models.rs`：
  - 启动探测 Ollama（`localhost:11434/api/tags`）与 vLLM（`localhost:8000/v1/models`），900ms 超时，embedding 模型（bge/nomic-embed/rerank）自动过滤；
  - `register_local_providers`：注册 `local-ollama` / `local-vllm` Provider（幂等），**当前默认 Provider 不可用（无 Key/停用/缺失）时自动接管默认项**；
  - `detect_register_and_persist`：探测 + 注册 + 落盘一站式入口；启动时后台执行（`main.rs`）。
- `ProviderConfig` 新增 `local: bool`（serde 默认，向后兼容旧 settings.json）；本地 Provider 调用时**跳过 API Key 校验**（agent/subagents/workflow 三路径）。
- 新增 Tauri 命令 `local_providers_detect`，设置页"模型与 API"新增**「检测本地模型」**按钮（`Settings.tsx` + `ipc.ts`），结果实时提示并刷新列表。

**对标依据**：Continue.dev 的本地模型体验；PRD G3。
**效果验证**
- `local_models.rs` 单元测试 3 项：embedding 过滤、无可用默认时接管、可用默认不被抢占（通过，见 §9）。
- 前端 `npm run build` 通过（含新按钮）。

## 3. F-02 · 真 Token 计量（P0 ✅）

**变更**（`crates/codegen/xai-token-estimation`）
- 两层计数体系：
  1. `estimate_tokens_for_model(model, s)`——按模型族用**真实 BPE**（tiktoken-rs）：OpenAI 系按 id 选择 o200k/cl100k，DeepSeek 用 cl100k 近似；构造失败自动回退启发式；
  2. `estimate_tokens(s)`——升级为 **CJK 感知启发式**：ASCII 文本与旧 bytes/4 完全一致（现有测试零改动通过），CJK/假名/谚文按 1 token/字计——修复中文文本被低估约 4 倍导致压缩阈值触发过晚、上下文溢出的缺陷（对本项目中文用户群是实打实的正确性修复）。
- 新增 `model_family()` 分类、`estimate_tokens_bytes4()` 旧语义保留、`ModelFamily` 枚举。
- 所有现有调用方（shell 压缩阈值、`/context`、chat-state 计数等 7 个 crate）零改动自动受益；按模型的精确计数 API 已就绪，供逐调用点接入（列入 M2 后续）。

**对标依据**：Cursor 用量精度；PRD G4。
**效果验证**：`cargo test -p xai-token-estimation` **22/22 通过**，含锚点测试（cl100k "hello world" = 2 tokens）、CJK 改善属性测试、模型族分类、ASCII 兼容性回归。

## 4. F-03 · 熔断器接入采样路径（P0 ✅）

**变更**
- 新增 `crates/codegen/xai-grok-sampler/src/breaker.rs`：按 `base_url` 分桶的熔断器（复用既有 `xai-circuit-breaker`，此前仅保护 GCS 上传——见基线 R6）：
  - `probe()`：请求前检查熔断状态，**熔断打开→快速失败**（不烧 15 次重试预算），错误携带 `retry_after`；
  - 上游故障分类 `is_upstream_fault`：429/5xx/连接错误/超时/流空闲计入熔断；鉴权/序列化/doom-loop/截断等客户端侧故障不计；
  - 参数经 `CB_SAMPLER_*` 环境变量（`CB_SAMPLER_ENABLED=0` 一键停用），与文件上传的 `CB_*` 配置隔离。
- `actor/request_task.rs` 接线：Completed→记录成功；Failed/InitFailed→按分类记录失败；每次 attempt 后实时记账。

**对标依据**：Codex 的上游韧性；PRD G4。
**效果验证**：breaker 模块单测（阈值跳闸、half-open 恢复、故障分类）随 `cargo test -p xai-grok-sampler` 执行；请求路径接线经 `cargo check` 验证（结果见 §9）。

## 5. A-02 · 子代理深度配置化（P0 ✅）

**变更**
- `xai-grok-tools/.../task/mod.rs`：`MAX_SUBAGENT_DEPTH = 1` 常量 → `max_subagent_depth()` 函数，读 `WTH_MAX_SUBAGENT_DEPTH`（兼容 `GROK_MAX_SUBAGENT_DEPTH`），**默认 2**，clamp 1..=8（防手误关闭限制）；
- 双重执行点同步：工具侧深度检查 + shell 侧 `handle_request.rs` 的 Task 工具剥离逻辑（两处都改为读函数）；
- 测试更新为"在限必须拒绝"语义 + 新增解析器单测（默认/空白/非法值/越界 clamp）。

**对标依据**：Codex/Cursor 并行代理；PRD G5。
**说明**：PRD 中的"子代理 token 预算继承"需在 coordinator 的用量归集路径加截断逻辑，涉及 `agent_ops.rs` 大文件改造，列入下一批（变更说明如实记录，避免半成品）。
**效果验证**：tools task 模块测试全绿（见 §9）。

## 6. F-04 · Git 一等公民工具集（M2 ✅ 提前落地）

**变更**（`xai-grok-tools` 新增 `grok_build/git` 模块，4 个工具 + 中央 I/O 枚举接线）
- `git_status`（`--porcelain=v1 --branch`）、`git_diff`（staged/路径过滤）、`git_log`（limit 1..=50）——只读（`ToolKind::Read`，免审批）；
- `git_commit`（非空消息校验、可选 `stage_all=git add -u`、拒绝暂存未跟踪文件）——`ToolKind::Execute`，**走既有审批流**；
- 输出统一 `GitToolOutput::{Content, Error}`，40k 字符截断 + 明示截断提示；接线 `tool_io::ToolInput`/`output::ToolOutput` 中央枚举、`canonical_input` 元数据投影、`to_prompt_format` 渲染、`consumed_completion_ids` 忽略表。

**对标依据**：Aider 的 git 原生工作流；PRD G5。
**说明**：v1 用 git CLI（porcelain 格式成熟、全平台可用）；gix 化为后续项（与 PRD 原文一致地标注为演进方向）。
**效果验证**：截断/缺仓库错误路径单测 + 全 crate lib 测试（见 §9）。

## 7. S-02 · README/文档与实现对齐（P0 ✅）

- 特性表"多后端 LLM"行改为与实现一致（本地模型为桌面端一键检测 + CLI 配置化接入）；
- FAQ"桌面端与 CLI 的关系？"由不实的"共享同一套 Agent 内核"改为如实描述 + 指向 PRD A-01 路线；
- FAQ 补充"如何用本地模型"操作说明。

## 8. Q-01 · 包名迁移方案定稿 ✅

`docs/Q01-包名迁移方案.md`：B0-B6 分批迁移、lib.name 固定实现代码零改动、每批独立可回滚；B0 批次（wth-models / xai-token-estimation）待独立提交执行。

## 9. 验证汇总

| 模块 | 验证命令 | 结果 |
|---|---|---|
| F-02 | `cargo test -p xai-token-estimation` | ✅ **22/22 通过**（含 cl100k 锚点、CJK 修正、ASCII 兼容回归） |
| F-03 | `cargo test -p xai-grok-sampler` | ✅ **157/157 通过**（lib）+ 集成/doc 测试全绿 |
| A-02 | `cargo test -p xai-grok-tools --lib task::tests` | ✅ **79/79 通过**（含新增深度解析测试） |
| F-04 | `cargo test -p xai-grok-tools --lib git` | ✅ git 模块测试通过；全 crate lib **2518 通过 / 45 失败**——45 个经 `git stash` 对照与失败模块聚类确认为**预存环境性失败**（`computer::local::terminal` 进程组/时序 13 个、LSP e2e 需真实语言服务器 13 个、`gitignore`/路径语义 Windows 差异、bash 流式进度时序等；其中 `registry::full_toolset_descriptions` 失败为预存 `deploy_app` stub 缺注册问题，即 PRD F-12，在未改动的工作树上同样失败）。我改动的 git/task/tool_io/output/normalization 模块测试全绿（136 项） |
| S-01/F-01 | `cargo check -p wth-desktop` + `cargo test -p wth-desktop` | ✅ 编译通过；**38/38 通过**（含 local_models 新增 3 项：embedding 过滤 / 无默认时接管 / 可用默认不抢占） |
| 影响面 | `cargo check -p xai-grok-shell`、`-p xai-grok-agent` | ✅ 均通过（子代理深度接线、工具集变更无破坏） |
| 前端 | `npm run build`（ui/） | ✅ 通过（含「检测本地模型」按钮，tsc 零错误） |

**验证环境**：Windows 11 · stable-x86_64-pc-windows-gnu（与项目 CI `build-wth-windows` job 一致）· 本地自建 mingw 工具链（见 §10）。

### 验证执行记录（2026-09-05）
```
cargo test -p xai-token-estimation     → 22 passed / 0 failed
cargo test -p xai-grok-sampler         → 157 passed / 0 failed (lib) + 18 integration/doc passed
cargo test -p xai-grok-tools --lib task::tests → 79 passed / 0 failed
cargo test -p xai-grok-tools --lib     → 2518 passed / 45 failed (全部预存环境性，见上)
cargo test -p wth-desktop              → 38 passed / 0 failed
cargo check -p xai-grok-shell          → Finished
cargo check -p xai-grok-agent          → Finished
cargo check -p wth-desktop             → Finished (1 pre-existing warning)
npm run build (ui)                     → built in 18.42s
```

> 测试期间修复的两个自引入问题（过程记录）：① sampler breaker 测试对 half-open 恢复语义的断言与 `xai-circuit-breaker` 实际状态机不符（探测成功即 Closed，非保持 HalfOpen），已按实现语义修正断言并加注释；② `MockClock` 需要 `test-hooks` feature（在 sampler dev-dependencies 显式启用）。

## 10. 环境备注（本机构建发现，供后续维护者参考）

本机（Windows 11 + 中文用户名）从零搭建 gnu 工具链时暴露一组环境问题，与项目代码无关但影响贡献者上手，已在本会话解决：
1. Git Bash 的 GNU `link` 工具会遮蔽 MSVC link.exe（未装 VS 时）；
2. GNU ld/dlltool/ar 与 **非 ASCII 用户名路径**（`C:\Users\刘克凡\...`）不兼容——`RUSTUP_HOME`/`CARGO_HOME`/`TMP` 需指向纯 ASCII 路径；
3. windows-gnu 目标需要完整 mingw binutils（dlltool/as）+ cmake/nasm（aws-lc-sys 需要）。

建议在 CONTRIBUTING.md 中补充"中文用户名 Windows 环境"的已知问题说明（待办）。

## 11. 未尽事项（下一批）

- A-01 桌面端 ACP 接入内核（M2 主体，独立工作流）
- A-02 的子代理 token 预算继承
- F-02 的按模型计数接入 shell 压缩路径逐调用点
- F-06/F-07/F-08/F-09/F-10（M2/M3 余项）
- 硬编码 Key 的服务端吊销（需维护者在 Agnes 平台操作）

---

# 第二批变更（M2 收尾：A-01 步骤1 + U-02 + F-05）

> 日期：2026-09-05 · 承接上表 §9/§11 未尽事项

## 12. A-01 · 桌面端接入统一内核 —— 步骤 1 落地（P0）

**变更**
- **shell 侧**：`leader::resolve_binary_impl` 新增 `WTH_LEADER_BIN` 环境变量覆盖（解析顺序：env → `~/.wth/bin` 管理安装 → 当前 exe），使桌面端可指向本机构建的 `wth` 可执行文件（桌面自身 exe 不是 agent 运行器）。
- **桌面端新增 `ipc/acp_bridge.rs`**：
  - `AcpKernel::connect`：经 `xai_grok_shell::leader::connect_or_spawn` 连接/拉起 leader（Windows 命名管道 `\.\pipe\grok-leader-<hash>`），完成 ACP `initialize` → `session/new` 握手；单 pump 任务以 `select!` 同时服务出站请求与入站消息；
  - 事件映射：`session/update`（agent_message_chunk / tool_call / tool_call_update）→ 既有 `AgentStreamChunk`（TextDelta / ToolCallStart / ToolCallEnd）——前端零改动；
  - 审批桥接：`session/request_permission` → 既有 `agent:approval` 事件与审批按钮，`agent_approve_tool/agent_deny_tool` 优先路由 ACP outcome 响应（allow/reject 类 option 自动选择）；
  - `session/cancel` 接入 `agent_abort`；`acp_status` 诊断命令（连接态 / 会话 id / leader 版本）。
  - 开关与回退：`settings.kernel_agent`（**默认 false**）控制 `agent_send` 路由；连接失败回退自研循环并记日志——符合 PRD"保留自研循环作为离线降级"的步骤 1 验收口径。
- 协议形状与映射为纯函数，6 项单测锁定（initialize/session-new/prompt/消息分片/工具生命周期/权限响应）。

**效果验证**：`cargo check -p wth-desktop` ✅、`cargo test -p wth-desktop` **44/44** ✅（含新增 6 项）、`cargo check -p xai-grok-shell` ✅。
**说明**：技能注入与 JSONL 统一持久化属于步骤 2/3（PRD 5.1），本批未动。端到端联调需本机存在 `wth` 可执行文件（构建 `wth-pager-bin` 后在设置中指定路径，或放入 `~/.wth/bin`）。

## 13. U-02 · 用量与预算真数据 —— 计费精度补齐（P1）

**审计结论**：桌面端用量解析（SSE usage → 累计 → 持久化）与预算拦截（请求前比较 `spent >= budget`）在 v0.3 已是真实数据，roadmap 文档中的"占位"描述过时；真实缺口是**计费不分输入/输出价差**。
**变更**：`settings.price_per_million_output_tokens: Option<f64>`（缺省回退统一单价，兼容旧配置）；费用计算改为 `prompt_tokens×输入价 + completion_tokens×输出价`；设置页新增"输出 Token 单价"输入框 + 负值校验；`ipc.ts` 类型同步。
**验证**：`cargo check` + 前端构建通过。每模型计价表仍归 F-06（模型调度）一并实现。

## 14. F-05 · 测试验证循环（P0，提前落地）

**变更**（`agent.rs`）
- 设置：`test_cmd`（空=禁用）、`verify_max_rounds`（默认 3）；设置页"预算"区新增两项配置。
- 主循环：编辑类工具（`file_write`/`file_edit`，以 `full_before/after` 信号 + 工具名双判定）成功后置 `verification_pending`；本轮结束时自动在工作区根目录运行 `test_cmd`——**通过则正常结束，失败把尾部 4000 字符输出回注为用户消息进入修复轮**（事件流实时显示"[验证 第n/m轮] 运行 …"状态）。
- `run_verification`：cmd/sh 包装、10 分钟超时、输出尾部截断；`verify_run` 命令供手动触发。
**对标依据**：Aider 测试驱动验证循环；PRD G5。
**效果验证**：`cargo check` ✅ + 44/44 ✅。多轮端到端行为需接真实模型联调（结构为纯 Rust 控制流，无隐藏状态）。

## 15. 第二批验证汇总

```
cargo check -p wth-desktop      → Finished
cargo test  -p wth-desktop      → 44/44（新增 ACP 桥接 6 项）
cargo check -p xai-grok-shell   → Finished（WTH_LEADER_BIN）
npm run build (ui)              → built in 17.19s（新增验证循环配置与开关类型）
```

## 16. 更新后的未尽事项

- A-01 步骤 2/3：桌面专属 IPC 逐步切内核 ToolBridge、记忆切 `xai-grok-memory`、会话存储统一 JSONL、最终拆自研循环
- A-01 端到端联调（需 `wth` 可执行文件）
- F-02 逐调用点接入 shell 压缩路径；F-06 模型调度与每模型计价表（合并 U-02 剩余）
- M3 项：F-07 MCP 服务器端 / F-08 Web 搜索抽象 / F-09 DAG 增强 / F-10 语义索引统一 / E-01 技能模板库 / A-03 Windows 沙箱
- A-02 的子代理 token 预算继承
- 硬编码 Key 的服务端吊销（维护者操作）

---

# 第三批变更（M3 开篇：E-01 + F-08 + F-09）

> 日期：2026-09-05 · 对应 PRD v1.3「编排与生态」里程碑

## 17. E-01 · 捆绑技能模板库（P1 ✅）

**变更**
- 新增仓库目录 `bundled-skills/`：10 个面向中文开发场景的实战技能（各含 `SKILL.md` frontmatter，兼容引擎解析器要求的 name/description 字段）：git-commit（规范提交）、test-gen（单测生成）、refactor（安全重构）、docs-gen（文档生成）、i18n-extract（文案抽取）、release-notes（发布说明）、mcp-author（MCP 服务器编写）、plugin-author（WTH 插件编写）、perf-profile（性能剖析）、dependency-audit（依赖审计）。与上游内置 6 个技能（code-review/best-of-n 等）互补不重名。
- 桌面端新增 `ipc/bundled_skills.rs`：`include_str!` 编译期内嵌 + 启动时种子到 `~/.wth/bundled/<name>/SKILL.md`（**已存在不覆盖**，尊重用户修改），注册于 `main.rs` setup。CLI/TUI 侧因技能发现本就扫描 `~/.wth/bundled`（`wth-agent/prompt/skills.rs`），**零改动自动获得同一批技能**——一次种子、双端受益。
- 附 `bundled-skills/README.md`（用途表 + 作用域优先级说明 + 新增指引）。

**效果验证**：`cargo test -p wth-desktop` **46/46**（新增 2 项：frontmatter 完整性与唯一性校验、种子幂等与不覆盖语义）。

## 18. F-08 · Web 搜索 provider 补齐（P1 ✅ 桌面端）

**审计发现**：桌面端设置可选 bing/searxng/tavily/brave/perplexity 五个引擎，但实现只有 tavily 分支——**其余四个静默回退 DuckDuckGo**，且默认引擎恰是"bing"（无实现）。
**变更**（`ipc/tools.rs` + `settings.rs` + 设置页）
- 补齐 4 个引擎实现：Brave（Search API）、Bing（Azure v7.0）、Perplexity（sonar 综合回答+citations）、SearXNG（自托管 JSON 端点，含"实例需开启 formats=json"的可操作错误提示）。
- `with_search_key` 统一凭据读取（Windows 凭据管理器 `service/<engine>`），缺 Key 返回可操作提示而非静默换引擎。
- **默认引擎改为 duckduckgo**（无需 Key，与隐私优先主张一致）；设置页新增对应选项、三个引擎 Key 输入（复用凭据管理器模式）、SearXNG 实例地址输入；校验白名单同步。
**对标依据**：Continue/Aider 的搜索可插拔；PRD G"摆脱 xAI 绑定"。
**效果验证**：`cargo check` + 前端构建 ✅；各引擎实际调用需各自 API Key（凭据分发后即可用）。
**说明**：CLI 侧（xai-grok-tools web_search）的 provider trait 化仍按 PRD 归入后续批次。

## 19. F-09 · DAG 工作流增强（P1，第一阶段 ✅）

**变更**（`settings.rs::WorkflowNode` + `ipc/workflow.rs`）
- 节点新增三个可序列化字段（serde default，旧配置无损）：`retry`（失败自动重试次数，默认 1）、`timeout_secs`（单次尝试超时，None=不限时）、`output_limit`（节点输出字符上限，默认 8000——消除 PRD 指出的硬编码）。
- 执行引擎：重试循环携带上次失败摘要回注入子智能体提示（修复上下文）；退避 500ms×次数；重试中发射 `workflow:progress`（status="retrying"，前端结果表透传显示）；超时经 `tokio::time::timeout` 包装，产出明确错误。
- 嵌套子工作流与 CLI 侧同引擎仍按 PRD 归后续（需先做内核统一后的命令面）。
**效果验证**：`cargo check` + 46/46 ✅（`workflow.rs` 既有 DAG 测试全绿，节点字面量改用 `..Default::default()` 保持可扩展）。

## 20. 第三批验证汇总

```
cargo check -p wth-desktop    → Finished
cargo test  -p wth-desktop    → 46/46（新增捆绑技能 2 项）
cargo check -p xai-grok-shell → Finished
npm run build (ui)            → built in 16.15s（搜索引擎设置区扩展）
```

## 21. 更新后的未尽事项（M3 余量）

- F-06 模型调度（按角色/成本路由 + fallback 链 + 每模型计价表）
- F-07 `wth mcp-serve`（MCP 服务器端模式）
- F-10 语义索引统一（CLI/GUI 共用 workspace 索引服务）
- A-03 Windows 沙箱第一阶段；U-01 桌面 rewind/分支/对话内搜索；Q-02 测试补强
- F-09 第二阶段：嵌套子工作流 + CLI 侧引擎；F-08 CLI 侧 provider trait
- A-01 步骤 2/3 与端到端联调

---

# 第四批变更（M3：F-06 模型调度）

> 日期：2026-09-05

## 22. F-06 · 模型调度：fallback 链 + 每模型计价（P1 ✅ 桌面端主会话）

**变更**
- **设置**：`fallback_provider_ids: Vec<String>`（有序备用 Provider 列表）；`ProviderConfig` 新增 `price_input`/`price_output`（每模型单价覆盖，serde default 旧配置无损）。
- **执行引擎**（`ipc/agent.rs`）：主会话构建 `[主端点, ...备用]` 端点链；请求失败时按 `is_fallback_eligible` 判定（5xx/429/传输错误降级，4xx 配置类错误不降级）沿链切换，**粘滞生效**（切换后继续用新端点完成本轮所有工具迭代）；切换事件实时透出（"[模型调度] 当前端点不可用（…），切换到备用模型 X"）；请求体 model 字段按激活端点覆盖。
- **计价**：费用 = 激活端点 `price_input/price_output` 优先 → 全局分价 → 全局统一价（三级回退），与 U-02 分价计费衔接；跨端点的用量统一累计。
- **UI**：模型页新增"备用模型链"编辑器（有序列表 + 下拉添加 + 移除）；模型编辑表单新增输入/输出单价字段。
- 调用面：子代理与工作流路径传空链（fallback 先主会话生效；子代理链路列入后续）。
**对标依据**：Copilot 按任务路由、Continue model hub；PRD G"按角色/成本路由"的第一阶段。
**效果验证**：`cargo check -p wth-desktop` + `cargo test -p wth-desktop` **46/46** ✅；端到端降级行为需配置真实备用端点联调（结构为纯 Rust 控制流）。

## 23. 第四批验证汇总

```
cargo check -p wth-desktop    → Finished
cargo test  -p wth-desktop    → 46/46
cargo check -p xai-grok-shell → Finished
npm run build (ui)            → ✓ built（模型页 fallback 编辑器 + 单价字段）
```

## 24. 更新后的未尽事项

- F-06 第二阶段：子代理/工作流路径的 fallback；按任务角色（压缩/摘要用小模型）的路由
- U-01 桌面会话增强（rewind/分支）；Q-02 前端测试补强
- F-07 `wth mcp-serve`；F-10 语义索引统一；A-03 Windows 沙箱第一阶段
- A-01 步骤 2/3 与端到端联调；A-02 子代理 token 预算继承

---

# 第五批变更（模块化提交 + U-01 分支修复）

> 日期：2026-09-05

## 25. 模块化提交（7 个 commit）

四批累计变更已按模块拆分入库（工作区清零）：

| commit | 内容 |
|---|---|
| `chore(security)` | S-01 密钥扫描门禁与历史豁免基线 |
| `feat(metrics)` | F-02 模型族 tokenizer 与 CJK 感知计量（22 测试） |
| `feat(resilience)` | F-03 采样路径熔断（157 测试） |
| `feat(kernel)` | A-02 子代理深度 + F-04 Git 工具集（79 task 测试） |
| `feat(leader)` | A-01 服务侧 WTH_LEADER_BIN 覆盖 |
| `docs` | 基线/对标/PRD/变更说明 + README 对齐（S-02） |
| `feat(desktop)` | 桌面端整合批次（A-01 桥接/F-01/F-05/U-02/F-06/F-08/F-09/E-01，46 测试） |

> 说明：桌面端各特性经由共享的 settings/agent.rs/Settings.tsx 深度交织，
> 为保证可审查性合并为一个提交；模块级说明以 docs/变更说明 §1-24 为准。
> bisect 粒度受此限制。

## 26. U-01 会话分支——审计与缺陷修复（P1 ✅）

**审计结论**：桌面端会话增强的主体（G4 对话内/全局检索、"重新生成"就地回滚重放、"从此处分支"forkFrom）在 v0.2/v0.3 已实现，PRD U-01 的真实缺口是一个**数据丢失缺陷**：

- **forkFrom 不持久化**：`setMessages` 仅写 zustand 内存态（stores/chat.ts:166 无自动落盘），新建分支会话的消息文件从未写入——应用重启后分支内容全部丢失（对比"复制会话"手动调用了 `sessionSaveMessages`）。
- 分支标题固定为"分支会话"，侧栏无法识别来源。

**修复**（ChatView.tsx forkFrom）：① 分支创建后立即 `sessionSaveMessages` 持久化（并同步 message_count）；② 标题改为 `{源会话标题}（分支）`。
**效果验证**：`npm run build` ✅ + `cargo test -p wth-desktop` 46/46 ✅。rewind 场景由既有"重新生成"（截断+重放）与"从此处分支"（保留原会话）共同覆盖，U-01 就此关闭。

## 27. M3/M4 余量（最终盘点）

- F-06 二阶段（子代理 fallback、按任务角色路由）；F-07 `wth mcp-serve`；F-10 语义索引统一；A-03 Windows 沙箱；Q-02 前端测试补强
- A-01 步骤 2/3（记忆/存储统一）与端到端联调；A-02 子代理 token 预算
- 硬编码 Key 服务端吊销（维护者操作）；B0 包名迁移提交（方案已定稿）

---

# 第六批变更（M3 收官：A-03 + F-06 二阶段 + Q-02）

> 日期：2026-09-05

## 28. A-03 · Windows 子进程 containment 第一阶段（P1 ✅）

**变更**
- 新增 `ipc/sandbox_windows.rs`：`ChildJob`（kill-on-close Job Object）——Agent 执行的 shell 命令整棵进程树纳入 Job，命令结束（含超时路径）句柄 Drop 触发内核级清理，根治"agent 启动常驻进程未回收"的泄漏面。
- `tools.rs::run_shell` 重构为 `spawn → assign → wait_with_output`，Job 创建/挂入失败 fail-open 降级（Windows 嵌套 Job 于 Win8+ 支持，实测正常）；补 `kill_on_drop(true)` 保证超时路径直连子进程必然终止。
- 第一阶段刻意**不含内存限额**（cargo/rustc 类合法命令可能超限误伤），作为后续可选配置项。
**效果验证**：47/47（新增测试实证 kill-on-close：30 秒 ping 子进程在句柄 Drop 后 0.3s 内被终止）。

## 29. F-06 二阶段 · 子代理/工作流接入 fallback 链（P1 ✅）

- 抽取公共 `resolve_fallback_chain(settings, exclude_provider_id)`（跳过停用/主端点自身/无 Key 云端备用）；
- **子代理委派**（`subagents.rs`）与 **DAG 工作流节点**（`workflow.rs`，链构建一次、节点并发共享）均接入降级链——此前仅主会话生效；
- 主会话同函数复用，消除三处重复。

## 30. Q-02 · 前端测试补强（P1 ✅ 第一阶段）

- chat store 测试 10 → **15 项**：新增工具调用生命周期（只挂 assistant 尾消息/状态与结果更新/未知 id 无副作用）与消息截断（rewind/重新生成的基础原语）两组共 5 项。
- 效果验证：`npx vitest run` **15/15** ✅。

## 31. 本批验证汇总

```
cargo test  -p wth-desktop  → 47/47（新增 Job Object kill-on-close 实证测试）
cargo check -p xai-grok-shell → Finished
npx vitest run (ui)         → 15/15
npm run build (ui)          → ✓ built
```

## 32. M3/M4 收尾清单（全部余量）

- F-07 `wth mcp-serve`（MCP 服务器端）；F-10 语义索引统一；A-03 第二阶段（deny-ACL/内存限额可选）
- A-01 步骤 2/3 与端到端联调；F-06 三阶段（按任务角色路由小模型）
- 硬编码 Key 服务端吊销（维护者操作）；B0 包名迁移提交（方案已定稿）

---

# 第七批变更（B0 包名迁移 + F-07 MCP 服务器端）

> 日期：2026-09-05

## 33. Q-01 B0 · 包名迁移第一批落地（P1 ✅）

按《Q01-包名迁移方案.md》执行 B0 批次：`xai-grok-models` → `wth-models`、`xai-token-estimation` → `wth-token-estimation`。仅改 Cargo 包名，`[lib] name` 显式固定——**全部 `use` 语句与代码零改动**；workspace.dependencies 与 10 个依赖方 Cargo.toml 同步。验证：受影响 crate（agent/pager/chat-state/pager-minimal/telemetry/tools/shared/shell/desktop/pager-bin）cargo check 全绿。

## 34. F-07 · `wth mcp-serve` MCP 服务器端模式（P1 ✅ 第一阶段）

**变更**
- 新增 crate `wth-mcp-server`（零第三方协议依赖，手写 JSON-RPC，符合 MCP 2025-06-18 规范）：
  - **stdio 传输**（newline-delimited JSON-RPC）：initialize 握手（protocolVersion/capabilities/serverInfo）、tools/list、tools/call、ping；通知静默、未知方法 -32601、非法 JSON 行回 -32700；
  - **只读工具面三件**：`wth_read_file`（UTF-8 + 截断）、`wth_list_dir`、`wth_grep`（大小写不敏感子串、跳过 .git/target/node_modules/二进制、命中上限）；
  - **路径围栏**：与桌面端同款 `contained_path`——拒绝绝对路径与 `..` 逃逸，全部访问限制在 `--root` 工作区内。
- CLI 接入：`wth mcp-serve [--root <dir>]` 子命令（wth-pager cli.rs + pager-bin 分发）。
- **生态卡位**：WTH 从"消费者"升级为"提供方"——VS Code（MCP 配置）/ Claude Desktop / 其他 Agent 均可作为客户端直接读取 WTH 工作区。

**效果验证**
- 单测 6/6：协议形状、通知语义、tools/list 与分发一致、路径围栏（绝对路径/`..` 逃逸拒绝）、grep 命中、端到端 round-trip；
- **真实二进制冒烟**：`wth mcp-serve --root <dir>` 完成 initialize 握手 + `tools/call` 读取文件，协议输出符合规范。
**后续**：会话级工具（`wth_ask` 经内核会话面）、HTTP 传输、写操作面（带审批）。

## 35. 本批验证汇总

```
cargo check（B0 受影响 10 crate）→ 全绿
cargo test  -p wth-mcp-server    → 6/6
cargo build -p wth-pager-bin     → ✓（wth mcp-serve 端到端冒烟通过）
```

---

# 第八批变更（F-12 决断 + A-03 二阶段 + F-06 三阶段 + Q-02）

> 日期：2026-09-05

## 36. F-12 · deploy_app 决断：补齐 stub 本意（P2 ✅）

PRD 要求"stub 要么实现要么移除"。完整移除需动 shell 5 文件 + builder 的 `AppBuilderDeployerConfig` 管线，风险高；**决断为补齐 stub 的设计意图**——Disabled 状态下注册 `DeployAppStubTool` 占位工具（明确返回"deploy_app 未启用"错误，而非工具缺失导致 toolset finalize 失败），走完整注册仪式（中央 I/O 枚举/元数据投影/渲染）。
**附带收益**：修复了基线记录的**预存测试失败** `full_toolset_descriptions_render_cleanly`（tools 测试 2519 通过/44 失败，净修复 1；剩余 44 个经聚类核对为纯环境性失败，与此前完全一致）。

## 37. A-03 二阶段 + F-06 三阶段（P1/P2 ✅）

- **A-03 内存限额（可选）**：`ChildJob::create_with_memory_limit(mb)`（`JOB_OBJECT_LIMIT_PROCESS_MEMORY`）；`settings.bash_memory_limit_mb`（默认 None——cargo/rustc 重构建可能合法超限，不开启限额）；run_shell 接线 + 设置页输入框。
- **F-06 摘要角色路由**：`settings.summary_model`——上下文压缩摘要用更便宜的小模型（留空跟随会话模型）；`summarize_history` 接线 + 设置页输入框。
- 工程事故记录：批处理脚本尾部一个错误的恒等写回把 `tools.rs` 截断为 0 字节，**已从上一提交 git checkout 恢复并重放补丁**（无损失；教训：脚本禁止用 'w' 模式做恒等写回）。

## 38. Q-02 + 本批验证

- Rust 新增 3 项：`is_fallback_eligible` 分类（5xx/429/传输 vs 4xx）、`body_with_model` 覆盖、`resolve_fallback_chain` 跳过规则（本地入链/无 Key 云端跳过/主端点排除/缺失 id 跳过）。
- 前端 15/15、Rust 51/51、ui build、全绿。

```
cargo test  -p wth-desktop → 51/51
cargo test  -p xai-grok-tools --lib → 2519 通过（预存失败 -1）
npm run build (ui) → ✓
```

---

# 第九批变更（Q-01 B1–B6 全量包名迁移）

> 日期：2026-09-05

## 39. Q-01 B1–B6 · 其余 62 个 `xai-*` 包全量迁移为 `wth-*`（P2 ✅）

- **范围**：除 B0 两包与 7 个保留 vendor/上游组件（computer-hub 三件套、voice、announcements、mixpanel、proto-build）外的全部 workspace 成员——含 pager 全家（414 文件的最大 crate）、shell、tools、sampler、markdown 系、ratatui 系等。
- **方法**：与 B0 相同的 lib.name 固定策略——**全部 `use` 语句与代码零改动**，纯清单操作。
- **迁移中修复的三类隐藏引用形式与 2 处历史笔误**：点语法（`xai-tool-types.workspace = true`——且为指向不存在包名的既有笔误）、段式声明（`[dependencies.xai-ratatui-textarea]`）、feature 跨包引用（`"xai-grok-sandbox/enforce"`）与 `dep:xai-*` 语法。
- **验证**：`cargo check --workspace` 86 crate 零错误；关键套件新包名下全绿（22+70+6+51+79）。
- 至此 Q-01（基线风险 R9"命名双轨混乱"）**整体关闭**；`grep xai- --include=Cargo.toml` 仅剩 vendor 保留集与目录路径。
