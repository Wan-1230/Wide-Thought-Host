# ADR: kernel_agent 默认策略

## 状态

已接受（2026-09，产品决策）

## 背景

桌面端可走两条执行路径：

1. **自研循环**（默认）：`ipc/agent.rs` 内 chat/completions + tools
2. **内核 ACP**（`kernel_agent=true`）：连接本机 `wth` leader，与 TUI 同源

对齐 Reasonix「统一内核」方向时，是否默认开启内核曾有争议。

## 决策

**保持 `kernel_agent` 默认关闭。**

理由：

- 用户可能未安装 `wth` CLI，默认开启会导致首次体验失败
- 自研循环在 Windows 桌面路径上已验证（审批/Diff/MCP）
- 内核连接失败虽有回退，但增加启动延迟与日志噪音

## 后果

- 设置页提供开关与说明（已实现）
- 回退路径必须保留并打日志
- 后续若 CLI 与安装包捆绑分发，可再评估默认开启（需灰度指标）

## 参考

- PRD F-01
- `docs/PRD-mature-agent-roadmap.md`
