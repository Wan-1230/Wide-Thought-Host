# WTH Desktop 功能测试报告

**日期：** 2026-07-20
**范围：** `wth-desktop` 二进制 + 前端 + 安装包

## 测试结果汇总

| # | 测试项 | 结果 | 严重程度 |
|---|---|---|---|
| 1 | 二进制启动 | ✅ 通过 | — |
| 2 | 前端构建 | ✅ 通过 | — |
| 3 | 会话持久化 | ✅ 通过 | — |
| 4 | WebView2Loader.dll 缺失 | ❌ 失败 | **P0** |
| 5 | Alt+Space 快捷键冲突 | ⚠️ 警告 | P2 |
| 6 | wth-desktop Rust 测试 | ⏳ 编译中 | — |

## 详细发现

### ❌ P0：WebView2Loader.dll 未打包

**现象：** 安装后打开软件提示 "由于找不到Webview2Loader.dll，无法继续执行代码"。

**根因：** GNU 工具链编译时，`webview2-com-sys` 生成的 `WebView2Loader.dll`（x64, 160KB）在 `target/release/build/webview2-com-sys-*/out/x64/` 目录中，但 Tauri build 没有自动复制到 release 输出目录，导致 NSIS 打包时缺失。

**修复：** 已修改 `build.rs`（自动检测并复制 dll）。下次 `tauri build` 会自动包含此 DLL。

**手动修复（用户端）：** 运行下载的 `MicrosoftEdgeWebview2Setup.exe` 安装 WebView2 Runtime。

> 注意：本机 **已安装** WebView2 v150.0.4078.83，问题不是缺少系统 WebView2，而是 Tauri 打包时未包含 `WebView2Loader.dll` 这一运行时组件。

### ⚠️ P2：Alt+Space 全局快捷键冲突

**现象：** 启动日志显示 `WARN Failed to register Alt+Space: HotKey already registered`。

**根因：** WorkBuddy 也注册了 Alt+Space 作为快捷键。

**影响：** WTH 的 Alt+Space 功能不可用。WTH 窗口本身可通过托盘图标切换，功能不受影响。

**建议：** 将默认快捷键改为 `Alt+W` 或其他未占用的组合。

### ✅ 二进制启动测试

```
$ wth-desktop --help
INFO Loaded 0 sessions from ".../com.wth.desktop/sessions.json"
INFO Wide Thought Host desktop started
退出码: 0
```

- 二进制正常启动，无异常退出
- 会话文件路径正确（`%APPDATA%/com.wth.desktop/sessions.json`）
- 启动加载逻辑正确（0 sessions 是因为未保存过）

### ✅ 会话持久化测试

| 场景 | 结果 |
|---|---|
| 正常会话数据 | ✅ |
| 特殊字符标题（`& < > "`） | ✅ |
| 长标题（120 汉字） | ✅ |
| 大量消息计数（999） | ✅ |
| 空列表 | ✅ |
| 损坏 JSON（回退到 `[]`） | ✅ |

### ✅ 前端构建

TypeScript + Vite 编译通过（2797 模块），0 错误。

## 结论

- **P0 缺陷已定位并修复**：`build.rs` 自动复制 `WebView2Loader.dll`
- 核心功能（启动、会话管理、前端渲染）正常
- 需要重新打包（`tauri build`）以生成包含 DLL 的安装包
- Rust 测试编译完成后需验证通过

## 待完成

- [ ] 等待 `cargo test -p wth-desktop` 编译完成
- [ ] 修复 Alt+Space 快捷键冲突（改为 Alt+W 或可配置）
- [ ] 重新运行 `tauri build` 生成包含 WebView2Loader.dll 的安装包
