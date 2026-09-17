# WTH Agent — VS Code 扩展（骨架）

通过本地 `wth agent stdio` 接入 Wide Thought Host 内核（ACP over stdio）。

## 状态

- **M4 骨架**：进程生命周期、JSON-RPC 行透传、Output 调试通道
- **未完成**：完整 ACP UI、工具审批界面、Diff 预览（后续接入官方 ACP 库或自绘 Chat）

## 前置

1. 已安装 `wth` CLI，且 `wth agent stdio` 可运行
2. VS Code ≥ 1.85

## 开发

```powershell
cd editors/vscode
npm install
npm run compile
# F5 启动 Extension Development Host，或：
code --extensionDevelopmentPath=.
```

## 命令

| 命令 | 作用 |
|------|------|
| `WTH: Start Agent Session` | 启动 `wth agent stdio` |
| `WTH: Send Prompt to Agent` | 发送 prompt（可用编辑器选区预填） |
| `WTH: Stop Agent Session` | 结束子进程 |

## 设置

- `wth.cliPath`：CLI 路径，默认 `wth`
- `wth.extraArgs`：附加参数数组

## 协议说明

当前发送最小 ACP 轮廓：`initialize` → `session/new` → `session/prompt`。  
请以 `docs/ACP.md` / `xai-acp-lib` 实际方法名为准做联调。
