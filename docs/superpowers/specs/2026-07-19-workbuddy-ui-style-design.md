# 子项目 3：WorkBuddy 风格 UI 改造

**日期：** 2026-07-19
**项目：** Wide Thought Host (WTH) — 打包为 Windows 可安装桌面应用的子项目 3
**状态：** 已实现 ✅
**依赖：** 子项目 2（已完成 — Tauri GUI 壳能编译运行）

## 目标

将 wth-desktop 前端 UI 从 GitHub Dark 单一风格改造为双主题（深色/浅色）+ 侧边栏分组导航的 WorkBuddy 风格。

## 设计决策

### 总体

| 决策 | 选择 |
|---|---|
| 主题模式 | 双主题（深色/浅色切换），默认深色 |
| 深色色板 | 保留 GitHub Dark（蓝黑 + #58a6ff 强调） |
| 浅色色板 | 清爽白紫（白底灰层级 + #6c5ce7 紫色强调） |
| 侧边栏 | 重组为分组垂直导航（会话/文件/设置，替换 tab 切换） |
| 消息气泡 | 圆角气泡，角色区分（用户右上圆角、AI 左上圆角） |
| 强调色 | 纯色（不用渐变） |
| 输入区 | 圆角输入框 + 纯色发送按钮 |

### 范围外（留给后续子项目）

- 终端面板功能实现
- 设置面板具体内容
- 专家面板
- 拖拽调整面板大小
- 动画/过渡效果
- 文件预览

## 实现清单

| 文件 | 改动 |
|---|---|
| `tailwind.config.js` | 新增浅色色板（surface-light / accent-light），保留深色 |
| `index.css` | 加 `:root` CSS 变量 + `.light` 选择器，双主题样式层 |
| `App.tsx` | 侧边栏 tab → 垂直导航菜单 + 顶部主题切换按钮 |
| `Sidebar.tsx` | 移除 tab，接收 `navSection` prop |
| `ChatView.tsx` | 气泡圆角（用户 `rounded-tr-sm` / AI `rounded-tl-sm`）、间距加大 |
| `FileTree.tsx` | 适配浅色主题颜色变量 |

## 配色表

### 深色（保持）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-0` | `#0d1117` | 主背景 |
| `--bg-1` | `#161b22` | 侧边栏 |
| `--bg-2` | `#1c2129` | 卡片/hover |
| `--bg-3` | `#21262d` | 次级表面 |
| `--border` | `#30363d` | 分割线 |
| `--accent` | `#58a6ff` | 主强调色 |
| `--text` | `#e6edf3` | 正文 |
| `--text-muted` | `#8b949e` | 辅助文字 |

### 浅色（新增）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-0` | `#ffffff` | 主背景 |
| `--bg-1` | `#f7f8fa` | 侧边栏 |
| `--bg-2` | `#eef0f4` | 卡片/hover |
| `--bg-3` | `#e4e6eb` | 次级表面 |
| `--border` | `#e0e0e0` | 分割线 |
| `--accent` | `#6c5ce7` | 主强调色 |
| `--text` | `#1a1a2e` | 正文 |
| `--text-muted` | `#8e8e93` | 辅助文字 |

## 主题切换机制

- `html` 元素加 `class="dark"`（默认）或 `class="light"`
- CSS 变量通过 `.light` / `.dark` 选择器切换
- Tailwind `darkMode: "class"` 保持不变
- App.tsx 顶部加 theme toggle 按钮（Sun/Moon 图标），写 localStorage + 更新 `<html>` class

## 验证标准

1. `npm run build` 成功
2. `cargo build -p wth-desktop` 成功
3. 启动后默认为深色主题（无闪烁）
4. 点击主题切换按钮，浅色/深色即时切换
5. 侧边栏显示分组导航（会话/文件/设置），图标+文字垂直排列
6. 消息气泡使用角色区分圆角
7. 主题切换后刷新页面仍保持选择（localStorage 持久化）

## 验证结果

- ✅ `npm run build` 成功（2797 模块，0 TypeScript 错误）
- ✅ `cargo build -p wth-desktop` 成功（4.58s 增量编译）
- ✅ 双主题 CSS 变量 + Tailwind 色板扩展完成
- ✅ 侧边栏分组导航（会话/文件/设置）+ 主题切换按钮实现
- ✅ 消息气泡圆角角色区分（用户 `rounded-tr-sm`、AI `rounded-tl-sm`）
- ✅ 文件树、输入区、ToolCallCard 全部适配 CSS 变量
- ✅ 主题切换 localStorage 持久化 + 无闪烁（`<html class="dark">` 默认）
