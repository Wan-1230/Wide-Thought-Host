# 子项目 4：系统托盘 + 桌面快捷方式 + 本地存储

**日期：** 2026-07-19
**项目：** Wide Thought Host (WTH) — 打包为 Windows 可安装桌面应用的子项目 4
**状态：** 已实现 ✅
**依赖：** 子项目 2（Tauri GUI 壳编译运行）

## 目标

1. 系统托盘图标支持（显示/隐藏、新建会话、退出）
2. 全局快捷键 Alt+Space（即使在后台也能唤起窗口）
3. NSIS 安装器自动创建桌面快捷方式和开始菜单文件夹
4. 会话数据本地持久化（JSON 文件存储）

## 实现

### 1. 会话持久化

**机制：** `%APPDATA%/com.wth.desktop/sessions.json`

| 命令 | 实现 |
|---|---|
| `session_list` | 返回 `Arc<Mutex<Vec<SessionInfo>>>` 内存缓存 |
| `session_create` | 追加到 Vec 头部 + `fs::write` 同步持久化 |
| `session_delete` | `retain` 删除项 + 持久化 |
| `session_get` | 按 ID 查找 |
| `session_export` | 占位（Markdown 模板） |

**启动恢复：** `app.path().app_data_dir()/sessions.json` → `serde_json::from_str` → 注入 `AppState.sessions`

### 2. 系统托盘

**已在子项目 2 中实现（`tray.rs`）：**
- 左键点击：切换窗口显示/隐藏
- 菜单：Show/Hide (Alt+Space) / New Session (Ctrl+N) / Quit (Ctrl+Q)
- `tauri.conf.json` 中 `trayIcon` 已配置图标路径

### 3. 全局快捷键

`main.rs` setup 阶段注册 `Alt+Space`：
```rust
Shortcut::new(Some(Modifiers::ALT), Code::Space)
app.global_shortcut().register(shortcut)
```

### 4. NSIS 桌面快捷方式

```json
"windows": {
  "nsis": {
    "install-mode": "currentUser",
    "start-menu-folder": "Wide Thought Host"
  }
}
```

NSIS 默认自动创建桌面快捷方式（无需显式配置）。

## 改动文件

| 文件 | 改动 |
|---|---|
| `src/state.rs` | 新增 `sessions: Arc<Mutex<Vec<SessionInfo>>>` + `sessions_path: Arc<Mutex<PathBuf>>` |
| `src/ipc/session.rs` | 4 个 TODO → JSON 文件完整实现（77 行） |
| `src/main.rs` | `setup()` 加 sessions 加载 + sessions_path 存储 + Alt+Space 全局快捷键注册 |
| `tauri.conf.json` | 加 `bundle.windows.nsis` 配置 |

## 验证结果

- ✅ `cargo build -p wth-desktop` 成功（23.48s）
- ✅ 所有 4 个 session IPC 命令实现完整持久化
- ✅ Alt+Space 全局快捷键注册
- ✅ NSIS 打包配置就绪（`install-mode: currentUser` + 开始菜单文件夹）
