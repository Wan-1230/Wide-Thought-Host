# ADR 索引

架构决策记录（Architecture Decision Records）。

| 文档 | 决策 |
|------|------|
| [architecture-governance.md](architecture-governance.md) | 架构约束用棘轮门禁（策略 + 基线 + CI），不用文档约定 |
| [naming-policy.md](naming-policy.md) | 目录/lib 名冻结，只强制新 crate 用 `wth-` 前缀 |
| [version-policy.md](version-policy.md) | 桌面端四处版本必须一致；CLI 与桌面保持两条版本线 |
| [frontend-quality.md](frontend-quality.md) | 前端用 Biome + 棘轮；PrismLight 与分包把 gzip 465→267KB |
| [windows-sandbox-design.md](windows-sandbox-design.md) | Windows 沙箱：Job → Restricted Token → AppContainer 分阶段 |
| [unified-kernel-policy.md](unified-kernel-policy.md) | kernel_agent 默认关闭，失败回退自研循环 |
| [upstream-sync-policy.md](upstream-sync-policy.md) | 三层划分保住上游可合并性，隐私面与桌面端承认永久分叉，季度按可量判据复核 |
| [kernel-parity.md](kernel-parity.md) | 双内核差异用静态对齐测试 + 双向棘轮锁定，按内核可定位性对新装用户灰度开启 |
