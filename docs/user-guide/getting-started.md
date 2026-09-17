# Wide Thought Host 用户指南（v2.0.1+）

面向日常使用。安装包见 GitHub Releases。

## 1. 安装

| 形态 | 文件 | 说明 |
|------|------|------|
| 推荐 | `*-x64-setup.exe` | NSIS 向导安装 |
| 企业 | `*-x64.msi` | 组策略 / 批量部署 |
| 免安装 | `*-x64-portable.zip` | 解压后双击 `wth-desktop.exe` |

**要求**：Windows 10/11 x64 + WebView2 Runtime（Win11 自带）。

首次启动进入 **Setup 向导**：

1. 选择工作区文件夹（Agent 只在此目录内读写）
2. 配置模型：内置免费模型 / 检测本机 Ollama·vLLM / 添加 OpenAI 兼容端点
3. 测试连接 → 设为默认 → 开始使用

## 2. 日常用法

- **新建会话**：侧栏 +；`Alt+W` 显示/隐藏窗口
- **编辑模式**（设置 → 通用）：
  - `plan` / `review`：写操作需确认
  - `auto`：普通文件编辑自动执行
  - `yolo`：尽量自动；**危险命令与敏感路径仍强制确认**
- **斜杠命令**：`/init` `/compact` `/model` `/help` 等；`~/.wth/skills` 下技能也会出现
- **`@` 引用**：输入 `@` 选择文件或子任务

## 3. 安全与预算

| 设置 | 作用 |
|------|------|
| 预算上限 | 累计费用达上限后拒绝新请求 |
| 单会话预算 | 本轮费用超限提示并停止 |
| 网络出口白名单 | 仅允许 Agent 访问列出的域名（空 = 不限） |
| 工具超时 | shell/git 最长执行秒数，超时杀进程树 |
| 子进程沙箱 | `job`（默认）或 `restricted`（受限 Token 降权） |
| 子代理并行数 | 同时运行的子智能体上限（1–4，默认 2） |
| 内核 Agent | 默认关；开启后优先走本机 `wth` ACP 内核 |

审批记录写入应用数据目录 `audit.jsonl`；运行事件在 `events.jsonl`；任务摘要在 `tasks/`。

## 4. 用量与诊断

- **设置 → 用量**：Token、费用、工具成功率、按模型归因、当前权限策略
- **设置 → 诊断**：健康摘要、最近任务、实时日志
- **CLI**：`wth doctor` 一键体检（version/paths/models/sandbox/terminal/env/update/mcp）

### 编辑器集成（预览）

`editors/vscode` 提供 VS Code 扩展骨架：Webview 对话、`wth agent stdio` ACP、工具审批 Allow/Deny。详见该目录 README。

## 5. 故障排查

| 现象 | 处理 |
|------|------|
| 打不开 / 缺 DLL | 安装 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) |
| SmartScreen 拦截 | 更多信息 → 仍要运行（当前未签名） |
| 模型 401 | 设置 → 模型 检查 API Key |
| 模型 429 | 稍后重试或换端点/本地模型 |
| 连接失败 | 检查 base_url、代理、网络白名单 |
| 命令超时 | 设置增大「工具超时」 |
| 上下文过长 | 开自动压缩，调低「压缩触发比例」 |
| 会话打不开 | 看 `sessions.json.bak`；删除损坏文件后重启 |

日志与数据目录：`%APPDATA%\com.wth.desktop\`

## 6. 从源码运行

```powershell
git clone <repo>
cd crates/desktop/wth-desktop
npm install
npm run tauri dev
```

CLI：`cargo run -p wth-pager-bin`
