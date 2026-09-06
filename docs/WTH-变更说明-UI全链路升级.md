# WTH 变更说明 — 前端 UI 全链路升级

> 日期:2026-09-06 · 范围:`crates/desktop/wth-desktop/ui`(纯前端,Rust 侧零改动)

## 目标与参照

参照成熟 AI 桌面客户端的视觉范式(ZCode 桌面版实机截图逐屏学习,辅以 Codex / Claude / Linear 的公开界面模式),对 WTH 桌面前端做设计系统级重构,消除"线框图感",达到商业产品完成度。

从参照产品提炼并落地的核心范式:

| 范式 | 参照来源 | WTH 落地 |
| --- | --- | --- |
| 单一品牌色 + 冷调中性面 | Linear / ZCode | 紫罗兰品牌色 `--accent-brand`(呼应 "Wide Thought"),深浅两套冷灰面板 |
| 助手消息不用气泡,正文直接排版 | ZCode / Claude | 助手消息去边框盒,品牌渐变头像 + `.md-body` 排版 |
| 消息列限宽居中 | ChatGPT / Codex | `max-w-3xl mx-auto` 阅读列 |
| 工具调用 = 紧凑活动行 | ZCode 时间线 | 状态图标 + 工具名 + 参数摘要单行卡片 |
| 输入区统一圆角容器 + 聚焦光环 | Codex / ZCode | `.composer` focus-within 品牌色光环 + 渐变发送钮 |
| 玻璃浮层 | macOS / Linear | `.glass-panel`(blur + 半透明)统一下拉/命令面板 |
| 尊重系统减少动效偏好 | 系统规范 | `prefers-reduced-motion` 全局降级 |

## 一、设计令牌(index.css 全量重写)

- **色板**:深色主题改冷调灰(#0B0C0E → #2D2F3A 五级面);浅色主题配套微调。修复 `--accent-yellow` 从未定义导致的工具卡状态点透明问题(隐性 bug)。
- **品牌色**:`--accent-brand` / `-strong` / `-soft` / `-border` / `--accent-gradient` 五令牌,深浅主题各自校准对比度;`input[type=checkbox|radio]` 的 `accent-color` 同步。
- **海拔**:`--shadow-xs/sm/md/lg` 四级阴影(深色加深),`--glass-bg/-border` 玻璃浮层令牌;`--radius-sm→2xl` 圆角令牌。
- **动效**:统一 `--ease-out/--ease-in-out/--ease-spring` 与三档时长;新增 `fadeUp / scaleIn / popIn / slideDown / caretBlink / shimmer / glowPulse` 关键帧;工具类 `.anim-fade-up / .anim-scale-in / .anim-pop / .anim-slide-down / .press / .shimmer-text / .stream-caret`;`prefers-reduced-motion` 一票降级。
- **Markdown 排版修复**:项目未安装 `@tailwindcss/typography`,原 `prose prose-sm` 是无效类——列表/标题/表格/引用全部裸奔。新增完整 `.md-body` 样式(有序/无序列表缩放与间距、标题层级、表格斑马纹、引用块品牌化、行内代码 pill)。
- **滚动条**:悬停渐现式细滚动条(透明 → 悬停着色),替代常显灰条。

## 二、核心组件

### ChatView(聊天主区)
- 消息列限宽 `max-w-3xl` 居中;消息入场 `anim-fade-up`。
- 用户消息:品牌微染色气泡(去边框);助手消息:去气泡盒,品牌渐变头像,流式时正文末尾品牌色 `.stream-caret` 光标(原先光标游离在气泡下方)。
- 思考中占位:品牌色 spinner + `shimmer-text` 流光文本。
- ToolCallCard:改为 ZCode 式单行活动卡——状态图标(旋转/勾/叉)+ 工具名 + 参数摘要内联;审批区黄色警示底 + 实心确认/幽灵拒绝按钮。
- StepProgressCard:品牌色 spinner、统一圆角卡片。
- CodeBlock:圆角 + 语言栏 + 复制反馈,字号 12.5px。
- 空状态(无会话):环境光晕(品牌色径向渐变)+ 层次化问候语 + 4 个可点击示例问题(点击自动建会话并发送)+ 交错入场编排;会话内空状态同步升级。
- 输入区:`.composer` 容器(聚焦品牌光环)、渐变发送按钮(禁用态降饱和)、玻璃质感 @/模板弹层、委派横幅品牌化、附件 chip 入场动画。
- 搜索跳转高亮:黄色块 → 品牌软色底。

### Sidebar / App 骨架
- 「新建会话」:品牌渐变主按钮 + 悬停提亮 + 按压反馈。
- 会话行 `.session-row`:激活态品牌微染色 + 左侧 3px 品牌指示条;hover 操作(重命名/复制/删除)收进浮动小面板(带底/描边/阴影),不再与文本硬重叠。
- 搜索框 `.search-box`(聚焦光环);「标题/消息内容」「会话/文件」双组切换改分段控件 `.segmented`。
- 工具条按钮:激活态品牌软色;状态栏全面板化(去描边 chip,流式状态改脉冲圆点,数字 `tabular-nums` 防跳动)。
- TitleBar:样式收敛至 CSS 类,会话标题胶囊底。

### 弹层体系
- 六处弹窗/遮罩(GitHub 登录、Diff、Workflow、Onboarding、QuickAsk、命令面板)统一 `modal-mask`(暗化 + blur)+ `modal-card`(统一圆角阴影 + scaleIn 入场)。
- CommandPalette 升级玻璃面板 + 搜索图标。
- Settings 侧栏激活项品牌化(自动继承新令牌);`.settings-*` 全套间距/字重微调。

## 三、附带交付:浏览器预览通道

新增 `src/lib/tauri-mock.ts`(在 main.tsx 最先导入):非 Tauri 环境自动安装 `__TAURI_INTERNALS__` 垫片并返回演示数据(示例会话/消息/文件树/Provider)。真实 Tauri 环境零副作用。此后 `npm run dev` 可直接在浏览器里开发与走查 UI,不必启动桌面壳。

## 四、验证

- `tsc --noEmit` 零错误;vitest 15/15 通过;`vite build` 成功(CSS 42.5KB,gzip 9.8KB;chunk 体积告警为 monaco/语法高亮既有问题)。
- 浏览器逐屏截图走查(浅色/深色 × 空状态/会话消息/设置面板):品牌色系一致、Markdown 列表正常渲染、动效符合令牌节奏、双主题无对比度问题。
- Rust 侧零改动,`wth.exe` 行为不受影响。

## 五、后续可选

- Toast 通知体系(目前 `wth:toast` 事件散落,无统一 UI)。
- 骨架屏(会话切换加载期)与滚动到底部浮动按钮。
- Monaco/xterm 面板的令牌化主题接线(当前自带主题)。
