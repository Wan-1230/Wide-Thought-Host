# Wide-Thought-Host 优化 PRD（v1.0 草案，待评审）

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0（草案，**评审方向确认后进入阶段 4 落地**） |
| 编写日期 | 2026-09-05 |
| 依据 | 《WTH 项目基线梳理报告》（源码实测）+ 《AI 编码 Agent 竞品对标报告》 |
| 适用范围 | WTH 全仓库（CLI/TUI + 桌面 GUI + 扩展生态），版本基线 v1.0.0 |
| 优先级定义 | **P0** = 本迭代必须完成（安全/诚信/主轴）；**P1** = 应完成（差异化主打）；**P2** = 可延后（体验与长期） |

---

## 1. 产品定位与迭代目标

### 1.1 产品定位（迭代后）

**"隐私优先、本地模型一等公民的开源 AI 编码工作台"**——一个内核、两种形态（TUI + 桌面 GUI）、全量能力对等。

- 放弃与 Cursor/Copilot 比拼自研模型与云服务；坚持开源 Apache-2.0、无遥测、数据不出本机（只发往用户配置的端点）。
- 把"多模型"从宣传语变成产品事实：本地模型（Ollama/vLLM）开箱即用，第三方模型配置零门槛。
- 把"双形态"从双内核变成单内核：桌面 GUI 与 TUI 共享同一 Agent 能力面。

### 1.2 迭代目标（可度量）

| # | 目标 | 度量标准 |
|---|---|---|
| G1 | 安全清污 | 仓库中零硬编码密钥；密钥扫描进 CI；README 与实现一致 |
| G2 | 内核统一第一阶段 | 桌面 GUI 通过 ACP 连接 shell 内核，工具数 8 → 30+（含 MCP/LSP/技能），桌面端复用沙箱与权限门控 |
| G3 | 本地模型一等公民 | 全新机器安装 Ollama 后，WTH 自动发现端点与模型列表并可在 `/models` 与 GUI 模型选择器中直接使用；全程 0 手工编辑配置 |
| G4 | 计量与韧性准确 | Token 计量按模型 tokenizer 计算（误差 ≤5%）；熔断器接入采样路径；429/5xx 退避策略按模型可配 |
| G5 | 编码工作流增强 | 内置 git 工具集 + lint/test 验证循环（失败自动修复，最多 N 轮）；子代理深度放开到 2+ 并带预算控制 |
| G6 | 质量与规范 | `xai-grok-*` → `wth-*` 包名迁移方案定稿并开始执行；核心链路测试覆盖率提升；桌面端前端测试从 1 个文件增至关键 store/IPC 全覆盖 |

---

## 2. 用户画像与核心痛点

| 画像 | 描述 | 核心痛点（现状证据） |
|---|---|---|
| P-1 隐私敏感的个人开发者 | 处理敏感代码（公司/合规），拒绝云端 IDE | 竞品均需上云或信任厂商；WTH 主张可信但存在硬编码 Key 污点（R1）与未签名安装包，说服力打折 |
| P-2 本地模型玩家 | 用 Ollama/vLLM 跑开源模型，追求零 API 成本 | WTH 无专用后端：模型目录写死 6 个、默认端点指向 xAI 代理、README 宣传与实现不符 |
| P-3 GUI 偏好型开发者 | 想要 agent 能力但不愿住进终端 | 桌面 GUI 是弱内核（8 工具、无沙箱/LSP/MCP/技能），被迫"GUI 看着爽、干活回 TUI" |
| P-4 中文生态开发者 | 中文语境、国产模型（DeepSeek/GLM/Qwen 等） | GUI 中英双语良好，但 CLI 侧英文；国产模型需手工写 `[model.*]` 配置 |
| P-5 团队/企业引入者 | 需要权限、审计、可分发 | 沙箱在 Windows 缺失（最大用户群）；团队配置已有雏形（`.wthconfig`）但缺乏审计与签名分发 |

**共同痛点排序**：①宣传与实现不符损害信任 → ②桌面端能力残缺 → ③本地/第三方模型接入摩擦 → ④Windows 安全短板 → ⑤计量不准。

---

## 3. 功能需求清单

> 每条需求标注：优先级、类型（新增/优化/增强）、来源机会点（O 编号，见对标报告）、验收标准。编号规则：`A`=架构，`F`=功能，`U`=体验，`E`=生态，`Q`=质量，`S`=安全。

### P0（必须完成）

| ID | 需求 | 类型 | 来源 | 说明与验收标准 |
|---|---|---|---|---|
| **S-01** | 清除硬编码 API Key | 优化 | O2 | 移除 `crates/desktop/wth-desktop/src/main.rs:127` 的内置 Key；如需"开箱即用"，改为引导用户配置或官方按需发放的安装时注入；增加 `gitleaks`/密钥扫描 CI job；全仓历史评估是否需要吊销该 Key。验收：仓库扫描零命中，CI 常驻扫描 |
| **S-02** | README/文档与实现对齐 | 优化 | O2 | 修正"桌面端与 CLI 共享内核"（在 G2 完成前）、"Ollama/vLLM 支持"（在 F-01 完成前）等夸大表述；标注平台徽章与实际一致。验收：逐条核对特性表与代码事实 |
| **A-01** | 桌面端接入统一 Agent 内核（第一阶段） | 增强 | O1 | 桌面端作为 ACP 客户端连接 shell（复用 `wth agent serve` 的 WebSocket leader 模式，127.0.0.1:2419）；保留现有自研循环作为离线降级。第一阶段范围：工具调用走内核注册表（获得 30+ 内置工具与 MCP 工具）、审批走内核权限管理器（四档映射 Default/Plan/Auto/YOLO）、技能注入、会话持久化统一到 JSONL。验收：GUI 内完成"改代码→跑测试→审查 diff"闭环且工具调用列表与 TUI 一致；降级开关可用 |
| **F-01** | 本地模型一等公民 | 新增 | O4 | 启动时探测 Ollama（`/api/tags`）与 vLLM（`/v1/models`）端点；自动生成临时模型条目；`/models` 与 GUI 模型选择器展示"本地"分组；连接失败给出可操作引导（下载命令/端口提示）。验收：G3 度量标准 |
| **F-02** | 真 Token 计量 | 优化 | O3 | `xai-token-estimation` 升级：按模型族接入 tokenizer（tiktoken-rs 覆盖 OpenAI 系/DeepSeek；Anthropic 计数 API 或近似表；本地模型按 chars≈tokens 折算表），保留 bytes/4 兜底。压缩阈值、`/context`、用量统计全部改用新计量。验收：对三种代表模型抽样误差 ≤5% |
| **F-03** | 熔断器接入采样路径 | 增强 | O6 | `xai-circuit-breaker`（现成 crate）接入 sampler：按 base_url 分桶，429/5xx 累计跳闸→快速失败→half-open 探测；与现有 retry.rs 协同（重试前查熔断状态）。验收：模拟上游 503，第 N 次后请求立即失败并提示，恢复后自动闭合 |
| **F-04** | Git 一等公民工具集 | 新增 | O12 | 新增内置工具：`git_status/git_diff/git_commit/git_log/git_branch`（基于 gix，只读优先，commit 需审批）；Aider 式"变更锚点"：每个 turn 前记录 HEAD，失败可一键还原。验收：模型可不经 bash 完成"查看变更→提交→回滚" |
| **F-05** | 测试验证循环 | 新增 | O13 | 项目级配置 `lint_cmd/test_cmd`（.wth/config.toml）；agent 完成 edit 后自动运行，失败输出回注模型进入修复循环（默认上限 3 轮，可配）；`/run <cmd>` 手动触发。验收：对含单测的示例项目，"改代码→测试失败→自动修复→通过"全流程无人值守完成 |
| **A-02** | 子代理深度与预算 | 增强 | O8 | `MAX_SUBAGENT_DEPTH` 配置化（默认 2）；子代理 token 预算上限（继承父级比例）；深度耗尽时模型收到明确错误提示。验收：三层委派示例可跑通且预算可被强制截断 |

### P1（应完成，差异化主打）

| ID | 需求 | 类型 | 来源 | 说明与验收标准 |
|---|---|---|---|---|
| **F-06** | 模型调度策略 | 新增 | O5 | 声明式路由规则：按任务角色（规划/压缩/摘要/补全）、上下文长度、成本排序选择模型；定义 fallback 链（主模型失败按链降级）；每模型计价表驱动真实成本统计（对齐 F-02）。验收：配置 fallback 链后模拟主模型故障，会话自动切换并在 UI 标注 |
| **F-07** | MCP 服务器端模式 | 新增 | O10 | `wth mcp-serve`：把当前会话/工作区暴露为 MCP server（stdio/HTTP），对外提供受限工具集（读文件/搜索/提问），可被其他 IDE 或 agent 消费。验收：VS Code 通过 MCP 配置连接 WTH 并调用其工具 |
| **F-08** | 通用 Web 搜索抽象 | 增强 | O11 | WebSearch provider trait：xAI Responses（现保留）/ Tavily / Brave / SearXNG（自托管）/ DuckDuckGo 网页解析；GUI/CLI 可配置与测试连接。验收：无 xAI Key 场景下用 Tavily 完成检索任务 |
| **F-09** | DAG 工作流增强 | 增强 | O9 | 节点级 retry（次数/退避）与 timeout；子工作流嵌套引用；节点输出传递上限可配（现 8000 硬编码）；CLI 侧暴露同一引擎（目前仅桌面端）。验收：含重试与超时的流水线示例在 CLI 与 GUI 均可运行 |
| **F-10** | 语义索引统一 | 增强 | O14 | 将桌面端的"关键词+Ollama 语义"检索与 CLI 侧 `xai-codebase-graph` 代码图谱合并为一套工作区索引服务（workspace crate），CLI/GUI 共用；嵌入模型自动发现（Ollama bge-m3 优先，逻辑已有）。验收：同一工作区在两端检索结果一致 |
| **E-01** | 技能模板库 | 新增 | O15 | 捆绑 10~15 个实战技能进发行包（`~/.wth/bundled` 机制已有）：git-commit、code-review、test-gen、refactor、docs-gen、i18n、release-notes、mcp-author、plugin-author、perf-profile 等。验收：全新安装后 `/skills` 可见并可直接使用 |
| **A-03** | Windows 应用层沙箱 | 新增 | O7 | 第一阶段：Windows Job Object（进程组终止/内存限额）+ 受限访问令牌（deny 写 ACL）实现文件系统限制；网络限制依赖权限门控（seccomp 等价物标注为后续 AppContainer）。验收：Windows 上 sandbox=workspace 时子进程写工作区外路径被拒绝 |
| **U-01** | 桌面端会话增强 | 增强 | O18 | rewind 检查点（复用 CLI rewind_points JSONL 机制）、会话分支、对话内搜索。验收：GUI 内回滚到任意检查点并从该点分叉 |
| **U-02** | 桌面端用量与预算真数据 | 优化 | O5/O3 | 状态栏 token/费用接真实计量（F-02/F-06 计价表）；预算拦截真实生效（超限阻断请求并提示）。验收：预置预算 $0.01 跑会话，超限时请求被拦截且有提示 |
| **Q-01** | 包名统一迁移启动 | 优化 | O19 | 制定 `xai-grok-*` → `wth-*` 迁移方案：第一批迁移低耦合 crate（models/config/types），旧名保留 `package rename` 兼容一个版本周期；文档与 CI 同步。验收：第一批 crate 迁移完成且 CI 绿 |
| **Q-02** | 测试补强 | 优化 | O22 | 桌面前端：chat store / ipc 封装 / 审批流关键路径测试；Rust 侧：turn 循环与 compaction 已有测试基线补齐边界用例；CI 加覆盖率报告（不设硬门槛，先可观测）。验收：前端测试文件 ≥5 且覆盖关键 store；CI 产出覆盖率徽章 |

### P2（可延后）

| ID | 需求 | 类型 | 来源 | 说明 |
|---|---|---|---|---|
| **U-03** | TUI 键位可重映射 + i18n | 优化 | O16 | 键位表落 config；TUI 文案抽词表（中英） |
| **U-04** | 桌面跨平台分发 | 新增 | O17 | macOS dmg（签名公证待定）+ Linux AppImage/deb；CI matrix 扩展 |
| **U-05** | 浏览器工具 | 新增 | O21 | 基于 Playwright MCP 的浏览器操作/截图/验证工具（仓库已有 `.playwright-mcp/` 痕迹，落地为一等工具） |
| **F-11** | ACP 反向 MCP 补全 | 增强 | 对标 Codex | 补全 server→client 通知/采样/roots 桥接（现为半双工） |
| **E-02** | 插件分发增强 | 增强 | O22 | 市场支持 zip/HTTP 直链分发（现仅 git）；插件签名（minisign）与哈希校验对齐桌面更新机制 |
| **Q-03** | 构建与体积优化 | 优化 | O20 | dev profile 换 lld/mold、拆分编译单元、安装包资源瘦身；产出构建时间基线对比 |
| **Q-04** | 贡献者体验包 | 优化 | O22 | 架构决策记录（ADR）、crate 依赖图、新手任务清单、CONTRIBUTING 对齐更名现实 |
| **F-12** | deploy_app 落地或移除 | 优化 | 基线 R 清单 | stub 工具要么实现（脚本化部署模板）要么从注册表移除，避免模型误调用 |

---

## 4. 非功能需求

| 维度 | 需求 | 度量 |
|---|---|---|
| **性能** | TUI 启动 ≤1.5s（现有基线上测得后固定）；大转录（10 万行）滚动不掉帧；压缩预取不阻塞前台 turn | 基准测试脚本进 CI（可选 daily） |
| **兼容性** | Windows 10/11 x64（主）、macOS/Linux TUI；OpenAI 兼容端点 / Anthropic / DeepSeek / Ollama 0.5+ / vLLM；MCP 规范跟随 rmcp 2.1 | 端点兼容性冒烟矩阵 |
| **安全性** | 零硬编码密钥（CI 扫描）；密钥仅存凭据管理器/env；工具默认最小权限；审计日志（工具调用/审批决定本地落盘，可选开启） | gitleaks 零命中；安全清单评审 |
| **隐私** | 维持"无遥测"主张；新增功能一律通过 `scripts/privacy_egress_check.sh` 出口断言；文档随功能同步隐私影响 | egress CI 常绿 |
| **可靠性** | 会话数据崩溃可恢复（JSONL 追加）；上游故障有熔断+退避+降级路径；备份/恢复覆盖新增数据 | 故障注入测试 |
| **可扩展性** | 新增 provider/web-search/沙箱 profile 均为 trait 扩展点，不修改核心；工具包注册面保持稳定 | 每个新能力附最小扩展示例 |
| **可维护性** | 包名统一推进；crate 循环依赖检查（cargo-deny）；文档与代码同 PR 更新 | CI 静态检查 |

---

## 5. 技术架构优化方案

### 5.1 内核统一（A-01）——本次迭代的中轴

**现状**：`wth-desktop` 声明了全套内核依赖但零使用（已验证），自研 8 工具循环；shell 已具备多前端服务能力（`run_stdio_agent` / `run_leader`，serve 监听 `127.0.0.1:2419`，WebSocket `ws://{addr}/ws?server-key=`）。

**方案**（分三步，风险递增）：
1. **步骤 1（P0）**：桌面端新增 `AcpAgentClient`（Rust 侧，复用 `xai-acp-lib` 的 channel/gateway），以 WS 客户端身份连接本机 shell leader；`ipc/agent.rs` 的 `run_agent` 改为优先路由 ACP，失败回退自研循环（保留离线模式）。UI 的工具卡片/审批事件直接消费 ACP `session/update` 与权限请求（wire 类型已有 `x.ai/hooks/*`、`x.ai/plugins/*` 等扩展面）。
2. **步骤 2（P1）**：桌面专属 IPC（file_read/file_write/terminal 等）逐步切到内核 ToolBridge；记忆注入切到 `xai-grok-memory`（FTS5+向量）；会话存储统一 JSONL（现 sessions.json 双轨保留只读迁移）。
3. **步骤 3（P2）**：拆掉自研循环与 `ipc/tools.rs`，桌面端等价于"TUI 的另一个客户端"；README 宣传从此成立。

**对标依据**：Copilot Agent HQ（统一内核多入口）、Cursor 2.0（多界面同代理池）。**设计原则**：不 fork ACP，遵循 Zed 协议 0.10.4 + unstable 扩展（已是 fork 现状，升级跟随上游）。

### 5.2 计量与调度（F-02/F-06）

```
wth-models（模型条目）
  └─ 新增：tokenizer 映射表（model_family → Tokenizer trait）
           pricing 表（input/output/缓存价，USD/Mtok）
xai-token-estimation → trait TokenEstimator { count(text, model) }
sampler → 用量记账 → GUI/TUI 状态栏 → 预算拦截（请求前检查）
路由器（新 crate wth-model-router 或并入 wth-models）：
  输入 { 角色, 上下文长度, 用户偏好 } → 候选排序 → fallback 链执行
```

**设计思路**：tokenizer 与 pricing 都是**数据驱动**（表文件随发行包更新，可被插件覆盖），避免硬编码进代码——这也回应 R1 的教训。对标：Continue 的 model hub 数据化配置、Cursor 的用量精度。

### 5.3 韧性栈（F-03）

现有：retry.rs（逻辑决策）+ shared_http 连接池 + doom-loop。新增：采样路径按 base_url 分桶熔断（server 预设：min_samples=10、阈值 0.5、60s 窗口），重试决策前查询熔断状态；桌面端 NetworkConfig 与内核统一（步骤 2 后自然获得）。

### 5.4 Windows 沙箱（A-03）

第一阶段不追求 nono 等价的内核强制：Job Object（kill-on-close + 内存限额）+ 受限令牌 + deny ACL 落地文件系统限制，与现有权限门控（AccessKind 策略 + Auto 分类器）组合成纵深防御；AppContainer 网络隔离列为后续。对标：Codex CLI 的平台沙箱分级策略。

### 5.5 架构红线（评审请确认）

1. 不引入第三方 Agent 框架/SDK 重写核心（保持自研 sampler/工具契约）。
2. 不做云端服务（云同步、云执行均不在本 PRD 范围）。
3. 保持 ACP 兼容，不私有化协议改造导致与 Zed 生态脱钩。
4. 所有新数据表/配置保持向后兼容（config.toml 增量字段，旧配置无损）。

---

## 6. 插件与技能生态规划

| 阶段 | 内容 |
|---|---|
| **基础（随 P0）** | 技能模板库 E-01 进发行包；为模板技能建立 lint（frontmatter 校验、paths glob 测试），避免坏模板破坏提示词 |
| **对齐（随 P1）** | 插件市场支持 WTH 官方源（从 xAI 源切换或并存 `https://github.com/Wan-1230/wth-marketplace`）；skills/hooks/LSP 组件分类展示对齐桌面端六类 UI |
| **增强（P2）** | zip/HTTP 分发 + minisign 签名；插件兼容层扩展（Codex/Cursor 规则文件导入）；MCP 服务器端（F-07）让 WTH 成为生态提供方 |
| **治理** | 技能/插件审查清单（权限声明、egress 检查进 CI）；版本化 API 兼容承诺（ToolCapabilities.behavior_version 已有，写进文档） |

---

## 7. 分阶段迭代路线图与里程碑

> 工期按 1~2 名全职贡献者估算，仅供参考；每阶段出口即"变更说明 + 效果验证"同步点（对应阶段 4 要求）。

### M1 · v1.1「信任修复」（~2 周，P0 中的安全与质量子集）
- S-01 硬编码 Key 清除 + 密钥扫描 CI；S-02 文档对齐
- F-02 真 Token 计量；F-03 熔断接入
- Q-01 包名迁移方案定稿 + 第一批 crate
- 🚩 里程碑验收：零密钥扫描命中；计量误差 ≤5%；上游故障注入走熔断路径

### M2 · v1.2「内核统一 + 本地模型」（~5 周，P0 主体）
- A-01 桌面端 ACP 接入（步骤 1 全部 + 步骤 2 起步）
- F-01 本地模型一等公民；F-04 git 工具集；F-05 测试验证循环；A-02 子代理深度
- U-02 用量真数据（依赖 F-02 计价表）
- 🚩 里程碑验收：G2/G3/G5 全部达成；GUI/TUI 工具能力对等演示

### M3 · v1.3「编排与生态」（~5 周，P1 余量）
- F-06 模型路由与 fallback；F-07 MCP 服务器端；F-08 Web 搜索抽象；F-09 DAG 增强；F-10 语义索引统一
- E-01 技能模板库（若未随 M1 落地）；A-03 Windows 沙箱第一阶段；U-01 桌面会话增强；Q-02 测试补强
- 🚩 里程碑验收：MCP server 被 VS Code 消费；无 xAI Key 全功能可用（搜索走第三方）

### M4 · v2.0「平台化」（~6 周，P2）
- U-03 键位/i18n；U-04 跨平台分发；U-05 浏览器工具；F-11 ACP 双向补全；E-02 插件分发与签名；Q-03/Q-04 构建与贡献者体验；F-12 deploy_app 决断
- 🚩 里程碑验收：三平台安装产物；插件签名分发链路通；架构文档齐备

---

## 8. 风险评估与应对方案

| # | 风险 | 概率/影响 | 应对 |
|---|---|---|---|
| RK1 | A-01 内核统一工程量失控（shell ACP 面大，桌面 UI 消费改造多） | 中/高 | 严格分三步走，每步保留自研循环回退开关；步骤 1 只做"工具+审批+技能"最小面对等，不做大爆炸切换 |
| RK2 | 历史 commit 中硬编码 Key 已扩散 | 低/高 | 吊销该 Key（若有效）；用 git 历史扫描确认扩散范围；必要时 filter-repo + 强推（需维护者决策，本 PRD 默认仅吊销+扫描） |
| RK3 | tokenizer 覆盖不全导致部分模型仍走兜底估算 | 中/中 | trait 化设计保证兜底可用且误差可标注；兜底时 UI 显示"≈"符号明示不确定性 |
| RK4 | 包名迁移（Q-01）破坏下游/用户脚本 | 中/中 | 旧包名保留 rename 兼容一个版本周期；迁移分批；CHANGELOG 明示 |
| RK5 | 上游 grok-build 演进与 fork 分叉加剧 | 高/中 | 记录 fork 补丁面（桌面端/更名/新增 crate）；核心链路尽量以"新增 crate 而非改上游文件"方式扩展；按季度评估上游合流价值 |
| RK6 | Windows 沙箱（A-03）与杀软/企业策略冲突 | 中/中 | 默认关闭、文档明示、profile 粒度开关；收集反馈后再定默认值 |
| RK7 | 本地模型质量参差导致 agent 循环失败率高，反噬口碑 | 中/中 | 本地模型场景自动降级策略（关掉流式工具调用依赖、简化工具集 preset `explore/plan` 已有）；文档给出推荐模型清单与实测基线 |
| RK8 | 单人/小团队维护带宽不足 | 高/中 | 里程碑切片保证每 2~5 周有可发布增量；P2 项允许整体顺延不做承诺 |

---

## 附：与既有 docs/PRD-desktop-* 系列的关系

本 PRD 是**全仓级**规划，与既有桌面端专项 PRD（v0.2/v0.3 已实现、remaining/roadmap 草案）互补：roadmap 中"桌面端接入内核"的愿景在本 PRD 中升级为 A-01 并给出可执行三步方案；其余桌面专项遗留项（F/G/H 系列）视为已并入本 PRD 对应条目或已完成。

---

**评审请求**：请确认 ①P0 范围（尤其 A-01 三步方案与 F-01 本地模型主轴）②路线图排期 ③架构红线 4 条。确认后进入阶段 4 落地执行。
