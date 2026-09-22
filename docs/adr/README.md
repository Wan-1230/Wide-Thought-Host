# ADR 索引

架构决策记录（Architecture Decision Records）。

| 文档 | 决策 |
|------|------|
| [architecture-governance.md](architecture-governance.md) | 架构约束用棘轮门禁（策略 + 基线 + CI），不用文档约定 |
| [naming-policy.md](naming-policy.md) | 目录/lib 名冻结，只强制新 crate 用 `wth-` 前缀 |
| [version-policy.md](version-policy.md) | 桌面端四处版本必须一致；CLI 与桌面保持两条版本线 |
| [windows-sandbox-design.md](windows-sandbox-design.md) | Windows 沙箱：Job → Restricted Token → AppContainer 分阶段 |
| [unified-kernel-policy.md](unified-kernel-policy.md) | kernel_agent 默认关闭，失败回退自研循环 |
