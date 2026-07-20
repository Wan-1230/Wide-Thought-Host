# 设计文档：补全 wth-desktop 前端 React 组件（子项目 2）

**日期：** 2026-07-19
**项目：** Wide Thought Host (WTH) — 打包为 Windows 可安装桌面应用的子项目 2
**状态：** 已实现 ✅
**依赖：** 子项目 1（已完成 — WTH 主二进制能在 Windows 上编译）

## 背景

项目里已经有完整的 `wth-desktop` Tauri v2 桌面应用骨架（Rust 后端 564 行 IPC + 前端 IPC/Store/Tailwind 配色齐全），但 `App.tsx` 引用了 3 个不存在的 React 组件：
- `./components/sidebar/Sidebar`
- `./components/chat/ChatView`
- `./components/filetree/FileTree`

导致 `npm run build` 失败。本子项目补全这 3 个组件，让 wth-desktop 能编译启动。

## 目标

1. 实现 3 个 React 组件，让 `npm run build` + `cargo build -p wth-desktop` 成功
2. 启动应用后窗口能显示完整 UI（不白屏）
3. 走通 UI → IPC → Rust 链路结构（端到端真正调通 wth 二进制留给子项目 3+）

## 范围

**做：**
- `Sidebar.tsx` — 会话列表
- `ChatView.tsx` — 聊天主区（消息流 + 输入框 + markdown 渲染）
- `FileTree.tsx` — 文件树
- `npm run build` + `cargo build` 验证

**不做（留给子项目 3）：**
- WorkBuddy 像素级 UI 复刻
- 设置面板、终端面板、主题切换、拖拽 resize
- 端到端调通 wth 二进制（依赖子项目 2 之后的 IPC 调试）

## 组件设计

### 1. Sidebar.tsx

**Props**（App.tsx 已定义）：
```ts
{ sessions: SessionInfo[]; activeId: string | null;
  onSelect: (id: string) => void; onNew: () => void; }
```

**UI 元素：**
- "+ 新建会话" 按钮（accent-blue）
- 会话列表项：标题 + 相对时间 + 消息数 badge
- active 高亮（bg-surface-2 + 左边框 accent-blue）
- hover 显示删除按钮（调 `sessionDelete`）
- 空状态："还没有会话，点击新建开始"

### 2. ChatView.tsx

**职责：** 显示当前 active session 的消息流 + 输入区。

**UI 元素：**
- 空状态（activeSessionId 为 null）：WTH logo + "新建会话开始对话"
- 消息流（滚动）：
  - user: 右对齐气泡（bg-accent-blue/20）
  - assistant: 左对齐 + markdown 渲染（react-markdown）+ 代码高亮（react-syntax-highlighter）
  - system: 居中灰色提示
  - tool_calls: 折叠卡片（工具名 + 参数 + 结果）
- 流式光标（streaming=true 时显示跳动 ▋）
- 输入区：textarea 自适应 + 发送按钮
  - Enter 发送 / Shift+Enter 换行
  - streaming 时禁用

### 3. FileTree.tsx

**职责：** 显示 workspace 根目录的文件树。

**UI 元素：**
- 调 `fileList(workspace_root)` 加载根目录
- 文件夹点击展开/折叠（递归加载）
- 文件点击 → console.log（预览留给子项目 3）
- 图标：Folder / FileText / FileCode（按扩展名着色）

## 配色

沿用现有 Tailwind 配置：
- `bg-surface-0/1/2/3/4` 分层背景
- `border-surface-4` 边框
- `text-accent-blue/green/orange/red/purple` 强调色
- `text-gray-300/500` 中性文字

## 验证标准

1. ✅ `cd ui && npm install && npm run build` 成功
2. ✅ `cargo +stable-x86_64-pc-windows-gnu build -p wth-desktop` 成功
3. ✅ `cargo run -p wth-desktop` 启动后窗口显示完整 UI
4. ✅ 会话/文件 tab 切换正常
5. ✅ 聊天/终端切换正常
6. ✅ 新建会话按钮可点击

## 后续

子项目 2 完成后，重新 brainstorm 子项目 3（WorkBuddy 风格 UI 细节复刻）。

## 实现中遇到的问题与解决

### 问题 1：Tauri 在 Windows 上构建需要 `icons/icon.ico`

**症状：** `cargo build -p wth-desktop` 报错 `icons/icon.ico not found; required for generating a Windows Resource file during tauri-build`

**根因：** Tauri 在 Windows 平台构建时，build script 会生成一个 Windows 资源文件（.rc）嵌入到 exe 里，需要 .ico 图标。但项目里没有 `icons/` 目录。

**解决：** 写了 `.workbuddy/tmp/gen_icons.py` 脚本，用 Python Pillow 库从 `docs/assets/gork-build-symbol-white.png`（1254x1254 RGBA）生成所有需要的图标：
- `32x32.png` / `128x128.png` / `128x128@2x.png` (256) / `icon.png` (512)
- `icon.ico` — Windows 多尺寸 ICO（16/32/48/64/128/256）
- `icon.icns` — macOS ICNS（占位，本机不构建 macOS）

### 问题 2：`tauri-runtime` 与 `tauri-runtime-wry` 版本不匹配

**症状：** `cargo build` 报 2 个错误：
```
error[E0046]: not all trait items implemented, missing: `eval_script_with_callback`
error[E0277]: `dyn Fn(Url, NewWindowFeatures) -> NewWindowResponse + Send` cannot be shared between threads safely
```

**根因：** Cargo.lock 锁定了不匹配的版本组合：
- `tauri` 2.10.3 → 依赖 `tauri-runtime = "2.10.1"`（要求 2.10.x）
- `tauri-runtime-wry` 2.10.1 → 也依赖 `tauri-runtime = "2.10.1"`（要求 2.10.x）
- 但 Cargo semver 把 `tauri-runtime` 升级到了 2.11.3（因为 `version = "2.10.1"` 在 semver 下接受 2.x >= 2.10.1）

2.11.x 在 `WebviewDispatch` trait 里加了新方法 `eval_script_with_callback`，但 `tauri-runtime-wry 2.10.1` 的 impl 没跟上。

**解决：** 把 `tauri-runtime` 降回 2.10.1，跟 `tauri-runtime-wry 2.10.1` 匹配：
```bash
cargo +stable-x86_64-pc-windows-gnu update -p tauri-runtime --precise 2.10.1
```

Cargo.lock 已更新。后续如果升级 `tauri` 到 2.11+，需要同步升级 `tauri-runtime-wry` 到对应版本。

### 问题 3：Rust 后端代码跟不上 Tauri v2 API 变化

**症状：** 编译报 6 个错误：
- `no method named emit found for struct tauri::Window` (3 处：agent.rs / terminal.rs / tray.rs)
- `cannot find function init in crate tauri_plugin_global_shortcut`
- `cannot find value result in this scope` (agent.rs:184)

**根因：** 项目原作者写的代码没跟上 Tauri v2 的 API 变化：
1. Tauri v2 把 `emit` 从 `Window`/`WebviewWindow` 上移到了 `Emitter` trait，需要 `use tauri::Emitter;` 才能调用
2. `tauri_plugin_global_shortcut::init()` 在新版改成 `Builder::new().build()`
3. agent.rs:184 是 `tokio::select!` 宏里漏写了 `result =`：`_ = async { ... }` 应该是 `result = async { ... }`，否则 `} => { result }` 里的 `result` 没定义

**解决：** 4 处代码修复：
- `src/ipc/agent.rs`: 加 `Emitter` 到 use 列表；把 `_ = async {` 改成 `result = async {`
- `src/ipc/terminal.rs`: 加 `Emitter` 到 use 列表
- `src/tray.rs`: 加 `Emitter` 到 use 列表
- `src/main.rs:35`: `tauri_plugin_global_shortcut::init()` → `Builder::new().build()`

### 问题 4：tauri.conf.json 的 plugins 配置字段不被新版接受

**症状：** 启动时 panic：`PluginInitialization("shell", "unknown field scope, expected open")` / `PluginInitialization("dialog", "invalid type: map, expected unit")`

**根因：** 新版 Tauri v2 plugin 配置不接受 `scope`/`all`/`shortcuts` 等字段。权限现在通过 `capabilities/*.json` 配置，不在 tauri.conf.json 里。

**解决：** 简化 `tauri.conf.json` 的 `plugins` 块，只保留有效的 `shell.open: true`，删掉其他 plugin 配置（permissions 已在 `capabilities/default.json` 里配好）。

### 问题 5：frontendDist 路径不对

**症状：** 应用启动后白屏（虽然子项目 2 验证时没真测，但路径明显不对）

**根因：** `tauri.conf.json` 里 `"frontendDist": "../ui/dist"` 指向 `crates/desktop/ui/dist`，但实际产物在 `crates/desktop/wth-desktop/ui/dist`。

**解决：** 改成 `"frontendDist": "ui/dist"`（相对 wth-desktop crate 根目录）。

## 验收结果

- ✅ `cd ui && npm install && npm run build` 成功（2797 个模块编译，dist/ 生成）
- ✅ `cargo +stable-x86_64-pc-windows-gnu build -p wth-desktop` 成功（14.54s，120MB wth-desktop.exe）
- ✅ `./target/debug/wth-desktop.exe` 启动成功，日志输出 `INFO Wide Thought Host desktop started`
- ✅ GUI 窗口正常创建（被 timeout 5 杀掉时退出）
- ✅ 所有 3 个 React 组件已实现（Sidebar / ChatView / FileTree）

## 后续

子项目 2 完成后，重新 brainstorm 子项目 3（WorkBuddy 风格 UI 细节复刻）。
