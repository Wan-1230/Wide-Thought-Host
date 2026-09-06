# AI 编码 Agent 竞品对标报告

| 项目 | 内容 |
|---|---|
| 文档类型 | 阶段 2 交付物：《AI 编码 Agent 竞品对标报告》 |
| 编写日期 | 2026-09-05 |
| 调研对象 | 开源：Workbuddy、CodeBuddy（任务指定 CoderBuddy）、Aider、Continue.dev；商业：OpenAI Codex、GitHub Copilot、ZCode、Cursor、Windsurf |
| 信息来源 | 竞品公开资料与行业共识（截至 2026-09）+ WTH 源码实测（阶段 1 基线报告）；标注 ⚠ 处为无法完全核实项 |

---

## 1. 竞品速览

| 竞品 | 形态 | 开源 | 核心定位 | 一句话画像 |
|---|---|---|---|---|
| **Aider** | CLI | ✅ Apache-2.0 | 结对编程 CLI | git 原生工作流（自动提交）、repo map、测试驱动验证循环的鼻祖，TUI 交互效率高但无 GUI |
| **Continue.dev** | IDE 插件 | ✅ Apache-2.0 | VS Code/JetBrains 助手 | 自定义中心（Hub）：模型/规则/MCP/上下文块均可自配，本地索引，BYO 本地模型标杆 |
| **Workbuddy** | CLI+GUI | ⚠ 同源分支 | 与 WTH 同谱系 | 仓库内证据（`.workbuddy/`、`workbuddy-ui-style-design.md`）表明其为 WTH 前身/姊妹分支（同一 grok-build 谱系），公开资料少；对比重点在于 fork 分化方向而非能力差距 |
| **CodeBuddy（腾讯）** | IDE+CLI | ❌ | 全流程 AI 工作台 | "产品-设计-研发-部署"一体化（CodeBuddy IDE 2025-07 内测），CodeBuddy Code CLI（2025-09）是中国首个引入 Skills 的编码工具；整合 Claude/GPT/Gemini，部署闭环到腾讯云 |
| **OpenAI Codex** | 云+CLI+IDE 插件 | CLI 部分开源 ✅ | 云端并行编码代理 | GPT-5-Codex 模型 + 云任务并行 + best-of-N 尝试 + 代码审查代理；提出 AGENTS.md 标准；CLI 沙箱（Seatbelt/Landlock）与 MCP 双向支持 |
| **GitHub Copilot** | IDE+Web+CLI | ❌ | 企业级多代理平台 | Agent HQ（2025-10）统一调度 Copilot/Claude/Codex 多代理；企业治理（审计/策略/计费）最完善，生态入口最强 |
| **ZCode** | CLI | 部分 | GLM 生态编码代理 | 智谱 GLM 模型驱动，规划模式、子代理、MCP/技能/Hook 扩展体系，中文场景与成本优势 |
| **Cursor** | IDE | ❌ | AI 原生 IDE 标杆 | 2.0 转向多代理界面：并行代理、自研 Composer/Tab 模型、BugBot 审查、语义索引、浏览器控制、后台代理 |
| **Windsurf** | IDE | ❌ | 代理流 IDE | Cascade 多步代理 + Memories 记忆 + 流式工作流；2025 经历 Google/Cognition 收购动荡后聚焦企业 |

> 注：任务指定的 "CoderBuddy" 经检索无对应知名开源项目（仅有腾讯 CodeBuddy 与零散同名小项目），本报告按腾讯 **CodeBuddy** 对标；"Workbuddy" 公开信息不足，按同源分支处理并标注 ⚠。

---

## 2. 八维度对标矩阵

评级：● 强 / ◐ 中 / ○ 弱或缺失。WTH 列基于阶段 1 源码实测（详见基线报告）。

### 维度 1：Agent 核心能力（规划-执行-验证、上下文管理、多步推理）

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| 计划-执行-验证循环 | ◐ Goal 模式+Skeptic 面板 | ◐ 测试驱动 /run 循环 | ◐ agent 模式 | ● Craft 全流程 | ● 云任务+验证 | ● Agent HQ | ● 规划模式 | ● 代理自校验 | ● Cascade |
| 上下文管理/压缩 | ◐ 70% 阈值+两段式压缩 | ◐ repo map | ◐ 本地索引 | ● | ● auto-compact | ● | ● | ● 语义索引 | ● Memories |
| 多步推理可靠性 | ◐ doom-loop 检测 | ◐ | ◐ | ● | ● best-of-N | ● | ● | ● 自研模型 RL | ● |
| 检查点/回滚 | ● rewind（仅 TUI） | ● git 兜底 | ○ | ● | ● | ● | ● | ● | ● |

**结论**：WTH 的 Goal 模式与 doom-loop 检测有亮点，但缺 best-of-N、缺真 tokenizer（bytes/4 估算）、rewind 未进桌面端。Codex 的 best-of-N 与 Cursor 的自研模型 RL 是代差项，短期不可追；**优先补 tokenizer 与桌面端 rewind**。

### 维度 2：多模型支持

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| 后端兼容范围 | ◐ 三协议，内置 6 模型写死且默认走 xAI 代理 | ● LiteLLM 百余模型 | ● BYO 任意 | ◐ 绑定腾讯云+少数 | ● GPT 系 | ● OpenAI/Anthropic/Google | ● GLM 系 | ● 多模型选择器 | ◐ SWE-1 系 |
| 模型调度策略 | ◐ 角色模型（default/web_search/summary） | ○ 单模型 | ◐ 按角色 | ◐ | ● best-of-N | ● 按任务路由 | ◐ | ● 主/补全/快慢分离 | ◐ |
| 本地模型适配 | ○ 仅 OpenAI 兼容端点硬凑 | ● Ollama/本地 | ● Ollama/LM Studio 一等公民 | ○ | ○ | ○ | ◐ | ◐ | ○ |

**结论**：WTH 协议层（ChatCompletions/Responses/Messages）设计良好，但**本地模型是宣称强项、实现弱项**（无专用后端、模型目录写死、默认端点指向 xAI 代理）。对标 Continue 补本地模型一等公民体验，是差异化性价比最高的一战。

### 维度 3：产品形态（TUI/GUI/跨平台）

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| TUI 完成度 | ● ratatui 全屏+鼠标+主题 | ● 原生终端 | ○ | ● CLI | ● TUI | ◐ Copilot CLI | ● TUI | ○ | ○ |
| GUI 完整度 | ◐ 双形态但 GUI 是弱内核（仅 8 工具） | ○ | ● IDE 内 | ● IDE | ◐ IDE 插件 | ● 全家桶 | ◐ IDE 插件 | ● IDE | ● IDE |
| 跨平台 | ◐ TUI 跨平台，桌面仅 Windows | ● | ● | ◐ | ● | ● | ● | ● 三平台 | ● 三平台 |

**结论**：WTH 是少数自建**桌面 GUI** 的开源 agent（差异化卖点），但 GUI 强度只到"带审批按钮的聊天客户端"。TUI 侧（继承 grok-build）完成度不输任何竞品。跨平台桌面（macOS/Linux）是低垂果实。

### 维度 4：工具生态

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| 内置工具集 | ● 丰富（Bash/文件/LSP/Grep/Monitor/Scheduler） | ◐ 精简 | ◐ | ● | ● | ● | ● | ● | ● |
| MCP 支持 | ◐ 客户端强，无服务器端 | ○ 社区方案 | ● 客户端+Hub | ● | ● 双向 | ● | ● | ● | ● |
| 插件/技能系统 | ● hooks+plugins+skills+marketplace 全家桶 | ○ | ● rules/Hub | ● Skills | ● AGENTS.md/skills | ● 扩展+自定义代理 | ● skills/hooks | ● rules/MCP/扩展 | ◐ |
| Git 集成 | ◐ 走 bash+gix 状态 | ● 自动提交标杆 | ○ | ◐ | ● GitHub 原生 | ● GitHub 原生 | ◐ | ● | ◐ |
| 浏览器控制 | ○ | ○ | ○ | ◐ 设计稿生成 | ○ | ◐ | ◐ | ● 内置浏览器测试 | ◐ |

**结论**：扩展性四件套（hooks/plugins/skills/marketplace）是 WTH 对标 Copilot/Cursor 的**最大既有优势**，且兼容 Claude 目录是聪明的生态搭车策略。短板：MCP 无服务器端（Codex CLI 已双向）、git 工具非一等公民（Aider 的自动提交工作流是标杆）、无浏览器控制。

### 维度 5：编码体验（Diff 审查、增量修改、LSP、审批）

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| Diff 审查 | ● TUI 语法高亮逐块 + GUI 逐块接受/拒绝 | ● | ◐ | ● | ● | ● | ● | ● | ● |
| 增量修改 | ● search_replace + codex apply_patch 双风格 | ● search/replace | ◐ | ● | ● apply_patch（WTH 已移植） | ● | ● | ● | ● |
| LSP 集成 | ● 语言无关可配置 | ○ | ● IDE 原生 | ● | ◐ | ● | ◐ | ◐ | ◐ |
| 审批模式分级 | ● Default/Plan/Auto/YOLO 四档+复合命令拆分 | ◐ | ◐ | ● | ● 沙箱分级 | ● | ● | ● | ● |
| 键位自定义 | ○ TUI 不可重映射 | ● vim 键 | ● | ● | ◐ | ● | ● | ● | ● |

**结论**：编码体验是 WTH 强维度——apply_patch 移植、复合 bash 命令拆分审批、LSP 诊断回注都是第一梯队。缺口：TUI 键位不可重映射、无 Tab 补全类交互（Cursor Tab 是代差，不追）。

### 维度 6：工作流编排

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| 子代理委派 | ◐ 单层并行 | ○ | ○ | ● | ● 云并行 | ● Agent HQ 多代理 | ● subagent | ● 并行代理 | ◐ |
| DAG/任务编排 | ◐ 桌面端 DAG（无重试/超时/嵌套） | ○ | ○ | ◐ | ◐ 云任务队列 | ● mission control | ◐ | ◐ 后台代理 | ◐ |
| 定时/后台任务 | ● /loop Scheduler + Monitor + 后台 bash | ○ | ○ | ◐ | ◐ | ◐ | ◐ | ● 后台代理 | ◐ |

**结论**：WTH 的子代理/编排能力"零件齐全、天花板低"：子代理深度 1 层、DAG 无重试超时嵌套、编排只在桌面端。对标 Copilot Agent HQ 的"多代理统一指挥"与 Codex 云并行，方向是**深度放开 + 可靠性增强**而非重新发明。

### 维度 7：性能体验

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| 响应速度 | ● Rust 原生+流式+预热连接池 | ◐ Python | ● | ● | ● | ● | ● | ● 自研模型低延迟 | ● |
| 资源占用 | ◐ Rust 高效但 86 crate 编译慢、安装包大 | ● 轻量 | ● | ◐ | ● | ● | ● | ◐ Electron | ◐ |
| 网络韧性 | ◐ 重试完善+代理+超时，熔断未接采样 | ◐ | ◐ | ◐ | ● | ● | ● | ◐ | ◐ |
| 容错恢复 | ● JSONL 追加日志、崩溃恢复、备份 | ◐ | ◐ | ◐ | ● | ● | ● | ● | ● |

**结论**：Rust 底座给 WTH 真实性能优势。短板可修：熔断器已有现成 crate 未接线；token 估算粗糙影响压缩时机与计费显示；编译时长影响贡献者体验。

### 维度 8：隐私安全

| 能力 | WTH | Aider | Continue | CodeBuddy | Codex | Copilot | ZCode | Cursor | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| 数据本地化 | ● 无遥测+egress CI 断言（宣称与实现一致） | ● 本地运行 | ● 可本地索引 | ○ 云 | ◐ 沙箱但上云 | ○ | ◐ | ◐ privacy mode | ◐ |
| 权限控制粒度 | ● 工具级+路径级+沙箱+文件夹信任 | ◐ | ◐ | ◐ | ● | ● 企业策略 | ● | ◐ | ◐ |
| 密钥管理 | ◐ CLI env/OAuth，桌面凭据管理器（但有硬编码 Key 污点） | ◐ | ◐ | ◐ | ● | ● | ● | ● | ● |
| 沙箱隔离 | ◐ Linux/macOS 内核级，Windows 缺失 | ○ | ○ | ◐ | ● 双平台内核级 | ● | ◐ | ◐ | ◐ |

**结论**：隐私优先是 WTH 最可信的差异化主张（有 CI 出口断言背书），但**硬编码 API Key（R1）直接损害这一人设**，必须最优先清除；Windows 沙箱缺失是隐私故事在最大用户群上的缺口。

---

## 3. WTH 综合优劣对比

**差异化优势（保持并放大）**
1. 隐私优先主张可验证（无遥测 + egress 断言 + 本地凭据）
2. 扩展性四件套齐全（hooks/plugins/skills/marketplace，兼容 Claude 生态目录）
3. 双形态（TUI 一线完成度 + 自建桌面 GUI，开源圈稀缺）
4. Rust 底座的性能与可靠性（JSONL 追加、崩溃恢复、备份恢复）
5. 中英双语开箱即用（中文默认，国产模型接入配置化）

**相对劣势（按可修复性排序）**
1. 桌面端弱内核与 README 宣传不符（最伤信任，也最值得修）
2. 本地模型宣称强实现弱
3. 硬编码 Key、未签名安装包损害安全人设
4. 无真 tokenizer；熔断未接线
5. 子代理/编排天花板低；MCP 无服务器端；git 工具非一等公民
6. 仅 Windows 桌面分发；TUI 键位不可重映射

---

## 4. WTH 优化机会点清单（输入 PRD）

| # | 机会点 | 对标来源 | 维度 | 价值评估 |
|---|---|---|---|---|
| O1 | 桌面端接入 CLI 同一 Agent 内核（shell 已有 `wth agent serve` WebSocket 模式，GUI 可作为 ACP 客户端接入），获得沙箱/MCP/LSP/技能/计划模式全量能力 | Copilot Agent HQ"统一内核多入口" | 架构 | ⭐⭐⭐⭐⭐ 一次投入，全维度受益 |
| O2 | 清除硬编码 API Key；密钥全部入凭据管理器；安全发布清单（签名计划、SECURITY.md 流程） | Aider/Continue 开源信誉实践 | 安全 | ⭐⭐⭐⭐⭐ 成本极低 |
| O3 | 真 tokenizer（tiktoken-rs / Claude tokenizer / 按模型映射），压缩阈值与用量计费精度对齐 | Cursor 用量精度 | 性能/体验 | ⭐⭐⭐⭐ |
| O4 | 本地模型一等公民：Ollama/vLLM 端点探测、模型目录自动发现、`/models` 列出可用本地模型、连接引导 | Continue.dev | 多模型 | ⭐⭐⭐⭐⭐ 差异化主打 |
| O5 | 模型调度策略：按角色/成本/上下文长度路由 + 失败 fallback 链 + 每模型计价表与成本统计 | Copilot/ZCode | 多模型 | ⭐⭐⭐⭐ |
| O6 | 熔断器接入采样路径（现成 `xai-circuit-breaker`）+ 429 退避策略分模型可配 | Codex 韧性 | 性能 | ⭐⭐⭐ |
| O7 | Windows 沙箱：Job Object + 受限令牌（或 AppContainer）实现与 nono 等价的文件/网络限制 | Codex 沙箱 | 安全 | ⭐⭐⭐⭐ 工程量大 |
| O8 | 子代理深度放开至 N 层 + 子代理间结果引用 + 预算继承限制 | Codex/Cursor 并行代理 | 编排 | ⭐⭐⭐⭐ |
| O9 | DAG 工作流增强：节点级重试/超时、嵌套子工作流、输出传递不截断、可视化编排器 | Copilot mission control | 编排 | ⭐⭐⭐ |
| O10 | MCP 服务器端模式：WTH 会话可暴露为 MCP server 被其他 IDE/Agent 消费 | Codex CLI 双向 MCP | 生态 | ⭐⭐⭐⭐ 生态卡位 |
| O11 | 通用 Web 搜索 provider 抽象（Tavily/Brave/SearXNG/本地），摆脱 xAI Responses 绑定 | Continue/Aider | 生态 | ⭐⭐⭐ |
| O12 | Git 一等公民工具集（status/diff/commit/branch/log 内置工具）+ Aider 式自动提交与回滚锚点 | Aider | 编码体验 | ⭐⭐⭐⭐ |
| O13 | 测试验证循环：lint/test hooks 配置化 + 失败自动修复循环 + /run 工具 | Aider 测试驱动 | Agent 能力 | ⭐⭐⭐⭐ |
| O14 | 语义索引升级：tree-sitter 代码图谱（已有 `xai-codebase-graph`）+ 本地 embeddings 统一 CLI/GUI 检索 | Aider repo map、Cursor 索引 | Agent 能力 | ⭐⭐⭐ |
| O15 | 技能模板库：随发行版捆绑 10~15 个实战技能（commit、review、test-gen、refactor、docs、i18n、release） | CodeBuddy Skills | 生态 | ⭐⭐⭐ |
| O16 | TUI 键位可重映射 + 主题/文案 i18n（中英） | 竞品标配 | 体验 | ⭐⭐ |
| O17 | 桌面端跨平台分发：macOS dmg + Linux AppImage/deb | 竞品标配 | 形态 | ⭐⭐⭐ |
| O18 | 桌面端会话增强：rewind 检查点、会话分支、对话内搜索（对齐 TUI 已有能力） | TUI 已有/竞品标配 | 体验 | ⭐⭐⭐ |
| O19 | 命名统一：`xai-grok-*` → `wth-*` 包名迁移计划（保留兼容别名一个版本周期） | 自身规范 | 质量 | ⭐⭐ |
| O20 | 构建与体积优化：dev profile 加速（mold/lld、cranelift）、workspace 拆分编译、安装包瘦身 | 竞品标配 | 性能 | ⭐⭐ |
| O21 | 桌面端浏览器内嵌预览/Playwright 工具（`.playwright-mcp/` 已有痕迹）| Cursor 浏览器测试 | 体验 | ⭐⭐ |
| O22 | 贡献者体验：架构文档、crate 依赖图、测试覆盖率门槛、贡献指南对齐更名现实 | 开源项目标配 | 质量 | ⭐⭐⭐ |

---

## 5. 结论

WTH 的竞争位势可概括为：**"一线 TUI + 三线 GUI + 独树一帜的隐私与扩展性主张"**。与 Cursor/Copilot/Codex 的代差在自研模型与云并行（不追）；与 Aider/Continue 的可竞争差距集中在本地模型体验、git 工作流、真 tokenizer、编排可靠性（可追）；与同源分支（Workbuddy）的分化方向应是桌面 GUI 完成度与多模型/本地模型差异化。机会点 O1（内核统一）、O2（安全清污）、O4（本地模型一等公民）三项性价比最高，建议作为 PRD 的 P0 主轴。

Sources: [CodeBuddy 官网](https://www.codebuddy.ai/home) · [腾讯云 CodeBuddy](https://copilot.tencent.com/) · [CodeBuddy IDE 内测报道](https://wap.eastmoney.com/a/202507223464491572.html) · [腾讯云 2026 AI IDE 选型指南](https://www.tencentcloud.com/techpedia/144279)
