# v2.0.1 — 产品闭环与 Setup 向导

> 发布日期：2026-09
> 对标 DeepSeek-Reasonix 完成产品闭环四件套与桌面 Setup 向导，安装包同步更新。

## ✨ 新增

- **`wth doctor`**：一键体检 version / paths / models / sandbox / terminal / update / MCP，支持 `--json` 与 `--only`
- **CLI `--copy`**：`--fork-session` 可见别名，resume 进入可写副本，原会话只读
- **Setup 向导（桌面）**：首次启动可检测 Ollama / vLLM、添加 OpenAI 兼容端点、测试连接并设为默认
- **压缩开关公开**：`--compaction-mode` / `--compaction-detail` 取消隐藏；设置页新增「压缩触发比例」

## 🔧 优化

- 桌面上下文压缩对齐内核策略：按窗口比例触发（默认 70%）、允许再次压缩、摘要走 `summary_model`、近尾约 16% 保留
- `provider_test` 支持本地模型免 API Key
- 清理仓库冗余：移除误跟踪 `node_modules`、宣传素材与构建日志

## 📦 安装

| 平台 | 方式 |
|------|------|
| Windows 10/11 x64 | 下载 NSIS 安装包（`Wide-Thought-Host-2.0.1-x64-setup.exe`）或 MSI |
| 免安装 | `Wide-Thought-Host-2.0.1-x64-portable.zip` 解压即用 |
| 从源码 | `cargo run -p wth-pager-bin`（CLI）/ `cd crates/desktop/wth-desktop && npm run tauri dev` |

依赖：Rust 1.92+、Node.js 20+、protoc、[WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

---

# v1.0.0 — 首个稳定版发布

> 发布日期：2026-08
> 这是 Wide Thought Host 的第一个稳定版本（从 v0.x 系列功能验证走向正式发布）。

## 🎉 亮点

- **首个稳定版**：核心功能与 API 冻结，CLI 与桌面端双形态正式可用。
- **双界面形态**：全屏 TUI（`wth` 二进制）+ Tauri 桌面 GUI（中英双语 Windows 安装包）。
- **多模型接入**：OpenAI 兼容端点开箱即用，支持 OpenAI / Claude / DeepSeek / Ollama / vLLM。
- **隐私优先**：无厂商遥测、无研究上传；所有数据只发往你配置的 LLM 端点。

## ✨ 新增（相对 v0.3）

- 桌面端技能系统：`~/.wth/skills/` 下的 `SKILL.md` 可作为斜杠命令动态加载并注入系统提示词
- 斜杠命令动态列表：内置命令（init/compact/clear/model/help/...）+ 用户技能统一展示
- 附件增强：支持按 `path` 读取文件内容、`utf-8` / `utf-16` 编码解码
- Headroom 侧车整合：token 压缩代理启动/停止/状态管理、一键安装
- 品牌统一：Logo 深色模式适配、文档与资源全面更名 wth

## 🐛 修复

- 文件读取 `encoding` 参数此前被忽略，现已生效
- 附件仅传 `path` 时内容为空，现自动读取文件
- Headroom 状态机补齐 `Starting` / `Error` 语义
- 清理 15+ 编译警告（unused imports、f32 字面量、dead code 等）
- README 图片链接断裂（`wth-build-tui-screenshot.jpg` 缺失）

## 🧹 优化

- 删除未使用的 `WorkflowRunDto`、`TRIGGERS` 常量
- 文档资源统一命名（`gork-*` → `wth-*`）
- README 全面重构：特性表格、安装部署教程、FAQ、GitHub 徽章

## 📦 安装

| 平台 | 方式 |
|------|------|
| Windows 10/11 x64 | 下载 NSIS 安装包（`Wide Thought Host_1.0.0_x64-setup.exe`）或 MSI |
| 从源码 | `cargo run -p wth-pager-bin`（CLI）/ `cd crates/desktop/wth-desktop && npm run tauri dev`（桌面端） |

依赖：Rust 1.92+、Node.js 20+、protoc、[WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

## ⚠️ 说明

- 安装包未签名，SmartScreen 可能提示"未知发布者"，选择"更多信息 → 仍要运行"。
- 升级前建议通过 设置 → 备份 生成 `.wthbackup` 备份。
