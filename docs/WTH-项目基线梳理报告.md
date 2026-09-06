# WTH 项目基线梳理报告

| 项目 | 内容 |
|---|---|
| 文档类型 | 阶段 1 交付物：《WTH 项目基线梳理报告》 |
| 梳理日期 | 2026-09-05 |
| 梳理对象 | Wan-1230/Wide-Thought-Host @ `3dcf234`（v1.0.0，2026-08 发布） |
| 梳理方式 | 源码静态走读（3 个并行探索代理 + 关键结论人工抽查验证） |
| 代码规模 | Rust workspace 86 成员 crate · 2165 个 `.rs` 文件 · 约 133 万行 Rust；桌面前端 React/TS 约 1.5 万行 |

---

## 1. 项目概览

**Wide Thought Host（WTH）** 是基于 [xai-org/grok-build](https://github.com/xai-org/grok-build)（Apache-2.0）从源码定制的开源 AI 编码代理平台，提供两种形态：

- **CLI / TUI**（二进制 `wth`）：ratatui 全屏终端界面 + `--minimal` 原生滚动区模式，另有 headless `-p` 单轮模式、stdio/serve/leader 多种运行时模式
- **桌面 GUI**（Tauri v2）：React 18 + TypeScript，多会话聊天、Monaco 编辑器、xterm 终端、系统托盘，NSIS/MSI 双语（中/英）Windows 安装包

产品主张：**多模型、可扩展、隐私优先**——无厂商遥测、无研究上传、数据只发往用户配置的 LLM 端点。

> ⚠️ **重要更名事实**：仓库内目录名（`wth-agent`、`wth-models` 等）与实际 Cargo 包名（`xai-grok-agent`、`xai-grok-models`）不一致，是 fork 更名未彻底的结果。用户主目录已迁移为 `~/.wth`（回退兼容 `~/.grok`），而 `wth-pager` 等核心 crate 仍以 `xai-grok-pager` 包名发布。这是代码规范层面需要统一的债务。

---

## 2. 技术栈清单

| 层 | 技术 | 版本/说明 |
|---|---|---|
| 语言 | Rust | edition 2024，rust-toolchain 指定 stable，1.92+（README） |
| TUI | ratatui + crossterm | 0.29 / 0.28，`unstable-widget-ref`；`xai-ratatui-inline`（自研 inline viewport fork，支持 `insert_before`、OSC8 逐格链接层） |
| 语法高亮/Diff | syntect 5.3 + two-face、similar | 主题 groknight/grokday/tokyonight/rosepine-moon/oscura-midnight |
| Markdown/公式/图表 | pulldown-cmark 0.13、自研 LaTeX→Unicode、Mermaid→PNG | `xai-grok-mermaid`：vendored mermaid-to-svg + dagre_rust + resvg，**进程外子进程渲染**隔离 panic |
| PTY | alacritty_terminal 0.26、portable-pty | `ptyctl`（axum REST/WS 无头 PTY 控制器，用于测试/自动化） |
| 桌面框架 | Tauri | Cargo.lock 锁 2.10.3，插件 shell/dialog/notification/global-shortcut/fs/process/clipboard-manager/single-instance |
| 桌面前端 | React 18.3 + TS 5.5 + Vite 5.4 + Tailwind 3.4 + zustand 4.5 | Monaco 0.56、xterm 5.3、react-markdown 9；vitest 仅 1 个测试文件 |
| LLM SDK | async-openai 0.33（仅用类型）、手写 SSE 解析 | 三种 API 后端：ChatCompletions / Responses / Messages，无第三方 SDK |
| MCP | rmcp 2.1（quarantine 隔离） | 仅客户端；SSE/stdio/Streamable HTTP 三种传输 + OAuth |
| 持久化 | JSONL 追加日志、rusqlite 0.37 bundled + FTS5 + sqlite-vec | 会话转录 JSONL；搜索/记忆用 SQLite |
| 沙箱 | nono（Landlock/Seatbelt）+ bwrap + seccomp | **仅 Unix**，Windows 无内核沙箱 |
| LSP | async-lsp 0.2.3 | 语言无关（服务器由用户配置） |
| 构建/CI | GitHub Actions（ci.yml、desktop-ci.yml）、NSIS/MSI | 依赖 protoc（`bin/` 内置）、Node 20+ |
| 代码规范 | rustfmt.toml、clippy.toml、`deny(warnings)` 风格 CI | 既有代码注释密度低，中文注释集中在 fork 新增部分 |

---

## 3. 核心架构说明

### 3.1 分层总览

```
┌──────────────────────────┐      ┌───────────────────────────────────┐
│  wth-pager (TUI 客户端)   │ ACP  │  xai-grok-shell (Agent 会话宿主)    │
│  wth-pager-bin (`wth`)    │◄────►│  SessionActor / MvpAgent          │
│  minimal 模式 / leader 客户│ stdio│  ├─ run_loop / turn（采样循环核心）  │
└──────────────────────────┘ /WS  │  ├─ goal_*（Plan-Execute-Verify）  │
                                  │  ├─ subagent coordinator           │
┌──────────────────────────┐ stdio│  ├─ compaction（两段式压缩）         │
│ wth-desktop (Tauri GUI)  │─────►│  └─ persistence（JSONL + FTS5）    │
│ ⚠️ 自研 agent 循环，未接内核 │      └───────┬───────────────────────────┘
└──────────────────────────┘              │
                    ┌─────────────────────┼───────────────────────┐
                    ▼                     ▼                       ▼
          ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
          │ wth-agent        │  │ xai-grok-sampler │  │ xai-grok-tools     │
          │ Agent定义/提示词  │  │ 三后端采样 actor  │  │ 工具实现 + 注册表    │
          │ 技能/插件发现     │  │ 重试/doom-loop   │  │ LSP/Git/Bash/MCP   │
          └──────────────────┘  └──────────────────┘  └────────────────────┘
                    │                     │                       │
                    ▼                     ▼                       ▼
          ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
          │ xai-grok-workspace│ │ xai-grok-http    │  │ xai-grok-mcp       │
          │ FS/权限/索引/信任  │  │ 连接池预热        │  │ MCP 客户端+OAuth   │
          └──────────────────┘  └──────────────────┘  └────────────────────┘
```

### 3.2 关键链路

1. **TUI ↔ Agent**：pager 通过 stdio 以 **ACP（agent-client-protocol 0.10.4，Zed 协议，unstable feature）** 驱动 shell 子进程；每个 ACP session 对应一个 `SessionActor`（`crates/codegen/xai-grok-shell/src/session/acp_session.rs`，2054 行）。
2. **Turn 循环**（`acp_session_impl/turn.rs`，约 2600 行）：准备工具定义 → 循环{注入 interjection/skill reminder/monitor 事件 → 采样 → 流式输出 → 执行工具调用 → 回填结果}，直到 end_turn；结构化输出在 Messages API 下用合成工具 `StructuredOutput`（最多 3 次重试）。
3. **Plan-Execute-Verify**：非硬编码循环，而是 **Goal 模式**——模型经 `update_goal` 工具驱动 `GoalPhase::{Planning, Executing}` 状态机，配 Skeptic（怀疑者验证）与 Strategist 角色（`goal_tracker.rs` 3703 行 + `goal_orchestrator/planner/strategist/classifier/stop_detector`）。
4. **上下文压缩**：`xai-grok-compaction`（传输无关引擎，code/intra/inter 三风格）+ shell 侧两段式预取（低于阈值 10 个百分点启动后台 pass-1）；默认 **70%** 窗口阈值触发，120s 墙钟预算。
5. **多模型采样**：`xai-grok-sampler` 三层架构（SSE 解码 → 流变换 per backend → actor），重试策略 5xx/连接错误/空响应最多 15 次（429 仅 2 次），doom-loop 独立恢复预算。

### 3.3 模块划分（crate 分组）

| 组 | 数量 | 代表 crate | 职责 |
|---|---|---|---|
| `crates/codegen/` | ~70 | wth-pager、xai-grok-shell、wth-agent、xai-grok-tools、xai-grok-sampler、xai-grok-mcp、xai-grok-workspace、xai-grok-memory、xai-grok-sandbox、xai-grok-hooks、xai-grok-plugin-marketplace、wth-models、wth-config | 全部功能实现；`xai-grok-pager` 单 crate 即 414 个文件约 16MB，是最大 crate |
| `crates/common/` | 10 | wth-tool-runtime/protocol/types、xai-grok-compaction、xai-circuit-breaker、xai-computer-hub-* | 统一工具契约（trait→wire）、压缩引擎、熔断器、远程工具服务器（Hub） |
| `crates/desktop/` | 1 | wth-desktop | Tauri 桌面端（**自研弱版 agent 循环**，见 §6 风险） |
| `third_party/` | 4 | dagre_rust、graphlib_rust、mermaid-to-svg、ordered_hashmap | vendored 以审计"不可信模型输出"渲染路径 |
| `prod/mc/` | 1 | cli-chat-proxy-types | xAI 聊天代理 wire 类型 |

---

## 4. 现有功能清单（功能矩阵）

### 4.1 Agent 核心能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 多步推理循环（计划-执行-验证） | ✅ | Goal 模式 + Skeptic/Strategist 面板，fail-open 降级 |
| 子代理委派 | ✅ | Task 工具（`spawn_subagent`），general-purpose/explore/plan 内置角色；**深度固定 1 层**；三种初始上下文（New/Forked/Resumed）；并行子代理目录面板 |
| DAG 工作流 | ✅ | 桌面端实现（`ipc/workflow.rs`）：拓扑分层 + JoinSet 并行、条件边（成功/失败）、内置"审查流水线"模板；**无重试/超时/嵌套** |
| 上下文管理 | ✅ | 70% 阈值 auto-compact、两段式预取、手动 /compact、`/context` 用量展示、prompt 队列 |
| 提示词缓存 | ✅ | 采样层支持（Responses/Messages 稳定前缀）；加密内置提示词模板 |
| 长期记忆 | ✅×2 | CLI 侧：`xai-grok-memory`（SQLite FTS5 + 向量 KNN 混合检索、MMR 多样性、/dream 整理，实验开关）；桌面侧：markdown 文件 + 关键词打分注入（最多 20 条），两套独立实现 |
| 会话持久化/恢复 | ✅ | JSONL 追加日志（chat_history/updates/rewind_points）、rewind、fork、跨会话 FTS5 搜索、导入 Claude/Codex 会话 |
| Token 估算 | ⚠️ | **bytes/4 启发式**（`xai-token-estimation`），无真实 tokenizer；图像按 765 token/张 |

### 4.2 多模型支持

| 能力 | 状态 | 说明 |
|---|---|---|
| API 后端 | ✅ | ChatCompletions（默认）/ Responses / Messages 三种请求形态，手写 SSE 解析 |
| 内置模型 | ⚠️ | 仅 6 个硬编码（gpt-4.1/-mini、claude-sonnet-4/opus-4、grok-build、deepseek-chat），`default_models.json` |
| 第三方接入 | ✅ | `[model.<id>]` TOML 配置：base_url/api_backend/env_key(BYOK)/extra_headers/context_window/reasoning_effort |
| 本地模型 | ⚠️ | **无 Ollama/vLLM 专用后端**，仅靠 OpenAI 兼容端点接入；README 宣传与实现有差距 |
| Provider 默认值 | ⚠️ | 内置模型 base_url 全部指向 xAI 代理（`cli-chat-proxy.grok.com/v1`）/`api.x.ai/v1`，直连第三方必须用户配置 |
| 鉴权 | ✅ | BYOK（模型级 api_key/env_key）> OAuth 会话 > XAI_API_KEY；401 刷新链；Windows 凭据管理器（桌面端） |
| 模型目录 | ✅ | ModelManager：远程拉取 + ETag 缓存 + 鉴权 watcher；角色模型（default/web_search/session_summary/image_description） |
| 思考流式 | ✅ | reasoning token 流式（ChannelToken reasoning 通道）、ReasoningEffort 低/中/高 |

### 4.3 工具生态

| 工具/机制 | 状态 | 说明 |
|---|---|---|
| 内置工具集 | ✅ 丰富 | Bash（持久会话+前后台）、Read/SearchReplace/ListDir/Grep(ripgrep)、Todo/Goal/Task/WebSearch/WebFetch/LSP、Monitor（后台监视器）、Scheduler（/loop 定时任务）、AskUserQuestion、Enter/ExitPlanMode；另有 codex 命名空间（apply_patch）与 opencode 命名空间工具集 |
| MCP | ✅ 客户端 | Streamable HTTP/stdio/SSE 三传输、OAuth、凭据存储、托管 MCP、 resilience（自研抗坏 JSON-RPC 行传输）；**无服务器端实现**；ACP 反向通道半双工限制 |
| 权限/审批 | ✅ | 工具 read_only 标注 → AccessKind 策略（含复合 bash 命令拆分）→ Auto 模式 LLM 分类器 + 快路径 → 兼容 Claude settings 规则；SessionMode::{Default,Plan,Ask}；桌面端四档 Plan/Review/Auto/YOLO |
| 沙箱 | ⚠️ | nono 内核级（Linux Landlock / macOS Seatbelt）+ bwrap re-exec + seccomp 子进程网络封锁；**Windows 无内核沙箱** |
| LSP | ✅ | async-lsp，goToDefinition/findReferences/hover/impl/symbol 操作、诊断回注、崩溃重启监视；语言覆盖=用户配置 |
| Git | ⚠️ | 无独立 git 工具（走 bash）；gix 状态扫描、hunk tracker、fast-worktree（CoW 隔离） |
| Web 搜索 | ⚠️ | 依赖 Responses API 服务端 web_search（需 xAI 后端）；web_fetch 有 SSRF 防护/域名白名单/缓存 |
| 计算机使用 | ❌ | `xai-computer-hub-*` 是**可插拔工具服务器/路由基础设施**（自研 wire 协议），非屏幕/鼠标控制 |
| deploy_app | ❌ | stub 未实现 |

### 4.4 扩展性

| 机制 | 状态 | 说明 |
|---|---|---|
| 技能 Skills | ✅ | `SKILL.md` frontmatter（description/when-to-use/paths 条件触发 glob），Local>Repo>User>Server>Bundled>Plugin 六级作用域，斜杠命令注入 + SkillDiscoveryReminder 延迟解锁；兼容 Claude/Codex 目录 |
| 插件 | ✅ | plugin.json 清单：可携带 skills/commands/agents/hooks/MCP/**LSP servers**；四作用域（CLI/Project/User/Config）；信任模型（Project 需显式授权）；兼容 `.claude/plugins` |
| 插件市场 | ✅ | git clone 分发（官方源 + 自定义源）、plugin-index.json、provenance 记录、卸载；**无 zip/HTTP 分发** |
| Hooks | ✅ | 14 生命周期事件（SessionStart/PreToolUse/PostToolUse/UserPromptSubmit/SubagentStart…），command/HTTP 两种 handler，blocking 语义，fail-open |
| 斜杠命令 | ✅ ~70 个 | 内置 + ACP 双来源、alias/hidden、技能注入为命令 |
| 自定义工具 | ✅ | `ToolRegistryBuilder::register_tool_pack()` 树外注入；ToolBridge 动态注册 MCP 工具 |
| 远程工具服务器 | ✅ | Computer Hub（自研协议）：Local/Remote 双传输、本地遮蔽远程、OIDC、WebSocket 连接池 |

### 4.5 双端 UI

**TUI（wth-pager，Elm 风格 Action→dispatch→Effect）**：28 种滚动区 block、鼠标支持（点击/双击选词/滚轮归一化/触控板加速）、语法高亮 Diff、Kitty 图形协议内联图片、Mermaid→PNG、五种主题、Simple/Vim 双键位模式、`@` 文件搜索、`!` bash 模式、命令面板、rewind、多会话 dashboard、语音听写（xai-grok-voice）、OSC52 剪贴板、`wth wrap` PTY 包装器、gboom 彩蛋小游戏。约 70 斜杠命令。PTY e2e 测试完善（`xai-grok-pager-pty-harness`）。

**桌面 GUI（Tauri）**：多会话（置顶/重命名/搜索/导出）、`@` 子代理与文件提及、工具调用内联审批按钮、Monaco 编辑器 + DiffModal 逐块接受/拒绝、xterm 多标签终端、Inspector 面板（日志/计划/上下文）、13 页设置、命令面板、托盘（Alt+W、快速提问、最近会话）、GitHub Device Flow 登录、i18n（zh-CN 默认）、备份 `.wthbackup`（含路径穿越防护）、headroom token 压缩代理 sidecar、用量统计与预算、首次引导、崩溃恢复与日志面板、消息全文检索、插件市场（哈希校验）、应用内更新（SHA-256 校验）、网络韧性（代理三态/超时/重试）。

---

## 5. 依赖关系与构建

- **构建链**：Rust stable（`rust-toolchain.toml`）+ protoc（workspace 内置 win64 二进制）+ Node 20+（仅桌面前端）→ `cargo build -p wth-pager-bin`（TUI）/ `npm run tauri build`（桌面 NSIS/MSI）。
- **CI**：`ci.yml`（Rust 测试）、`desktop-ci.yml`（Rust 单测 + 前端单测 + 打包 + tag 触发 Release，60 分钟超时）。
- **发布**：v1.0.0 已发布（2026-08），NSIS/MSI 未签名（SmartScreen 提示），无自动更新通道（桌面端有应用内"检查更新+下载校验"，无静默更新）。
- **隐私配套**：`scripts/privacy_egress_check.sh` + egress 代理做 CI 出口断言，支撑"隐私优先"主张。

## 6. 已知问题与风险清单（后续优化输入）

| # | 问题 | 位置/证据 | 严重度 |
|---|---|---|---|
| R1 | **硬编码内置 API Key 明文提交进仓库** | `crates/desktop/wth-desktop/src/main.rs:127`（"Agnes AI" `sk-...`，已验证） | 🔴 安全 |
| R2 | **桌面端与 CLI 双内核**：Cargo.toml 声明 wth-agent/shell/tools/mcp/sampler/memory/sandbox 全套依赖，但源码 **0 处使用**（已 grep 验证）；桌面端自研 8 工具弱循环，无沙箱/计划模式/LSP/hunk 追踪 | `crates/desktop/wth-desktop/src/ipc/agent.rs`、`tools.rs` | 🔴 架构 |
| R3 | README"桌面端与 CLI 共享同一 Agent 内核"与实现不符 | README 特性表 vs R2 | 🟠 诚信/文档 |
| R4 | Windows 无内核沙箱（nono 仅 Unix） | `xai-grok-sandbox` | 🟠 安全 |
| R5 | Token 估算 bytes/4 启发式，跨语言/跨模型误差大，影响压缩阈值与用量计费 | `xai-token-estimation` | 🟠 准确性 |
| R6 | 熔断器（xai-circuit-breaker）未接入采样路径，仅保护 GCS 上传 | `xai-file-utils/storage_client.rs` | 🟡 韧性 |
| R7 | 子代理深度硬编码 1 层 | `xai-grok-tools/.../task/mod.rs MAX_SUBAGENT_DEPTH` | 🟡 能力 |
| R8 | MCP 仅客户端，无服务器端（WTH 不能作为 MCP server 被其他工具消费） | `xai-grok-mcp` | 🟡 生态 |
| R9 | 命名混乱：`wth-*` 目录 vs `xai-grok-*` 包名双轨；桌面端记忆/工作区检索与 CLI 侧重复实现 | 全仓 | 🟡 规范 |
| R10 | DAG 工作流无重试/超时/嵌套；节点输出截断 8000 字符 | `wth-desktop/src/ipc/workflow.rs` | 🟡 功能 |
| R11 | web_search 绑定 xAI Responses API；无通用搜索引擎 | `xai-grok-tools/.../web_search` | 🟡 生态 |
| R12 | 插件市场仅 git 分发；ACP 反向 MCP 半双工 | `xai-grok-plugin-marketplace` | 🟢 生态 |
| R13 | 桌面前端测试近乎缺失（vitest 仅 1 文件）；诊断页部分为占位/假数据 | `ui/src` | 🟢 质量 |
| R14 | 跨平台：桌面打包仅 Windows；README 平台徽章仅 Win 10/11 | `tauri.conf.json` | 🟢 覆盖 |
| R15 | `.workbuddy/` 遗留目录与 `docs/superpowers/specs/2026-07-19-workbuddy-ui-style-design.md` 表明项目曾用名 Workbuddy，历史痕迹未清理 | 仓库根 | 🟢 卫生 |

---

## 7. 小结

WTH 是一个**工程完成度显著高于典型个人开源项目**的 fork：TUI 侧继承自 xAI 的 grok-build，具备企业级架构（actor 模型、ACP 协议化、传输无关压缩引擎、纵深权限模型、PTY e2e 测试），fork 新增价值集中在桌面 GUI、中文化、多模型接入配置与隐私主张。**核心矛盾**在于：最强的一面（TUI + 完整工具生态）与最新的一面（桌面 GUI）没有打通——桌面端是一个并行重写的弱内核，这既是最大的架构风险（R2/R3），也是最大的优化机会（统一内核后桌面端一步获得沙箱、MCP、LSP、技能、计划模式全部能力）。

> 本报告结论已通过源码抽查验证（R1 硬编码 Key、R2 依赖未使用、leader 端口 2419 等）；其余细节引用自三个并行探索代理的走读报告，路径均可复核。
