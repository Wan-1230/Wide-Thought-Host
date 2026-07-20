# 子项目 5：exe 安装包打包

**日期：** 2026-07-19
**项目：** Wide Thought Host (WTH) — 打包为 Windows 可安装桌面应用的子项目 5
**状态：** 已实现 ✅
**依赖：** 子项目 1-4（全部完成）

## 目标

运行 `tauri build` 生成完整的 Windows 安装包（NSIS + MSI）。

## 实现

### 打包命令

```bash
RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu \
PROTOC=/path/to/protoc.exe \
npx tauri build
```

关键：必须设置 `RUSTUP_TOOLCHAIN` 为 GNU 工具链，因为本机没有 Visual Studio Build Tools（MSVC 不可用）。

### 遇到的坑

| 问题 | 解决 |
|---|---|
| `npx tauri` 找不到命令 | 用完整路径 `ui/node_modules/.bin/tauri` |
| `beforeBuildCommand` 在 Windows cmd 下 bash 语法不兼容 | 从 `"cd ui && npm run build"` → `"npm run build"`（tauri CLI 自动切目录） |
| MSVC 工具链 `link.exe` 不可用 | 设置 `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu` |
| `@tauri-apps/api` 2.11.1 与 `tauri` Rust crate 2.10.3 不匹配 | 降级 NPM 到 `~2.10.0` |
| NSIS 配置字段 `create_desktop_shortcut` 不存在 | 移除，NSIS 默认自动创建桌面快捷方式 |

## 产物

| 文件 | 大小 | 说明 |
|---|---|---|
| `target/release/wth-desktop.exe` | 32 MB | 裸二进制（含 WebView2） |
| `target/release/bundle/nsis/Wide Thought Host_0.1.0_x64-setup.exe` | 6 MB | NSIS 安装包 |
| `target/release/bundle/msi/Wide Thought Host_0.1.0_x64_en-US.msi` | 9 MB | MSI 安装包 |

## 安装特性

- 当前用户安装（不需要管理员权限）
- 桌面快捷方式自动创建
- 开始菜单文件夹 "Wide Thought Host"
- 系统托盘图标 + Alt+Space 全局快捷键
- 会话数据持久化到 `%APPDATA%/com.wth.desktop/sessions.json`

## 验证

- ✅ `tauri build` 成功，生成 NSIS (6MB) + MSI (9MB) 安装包
