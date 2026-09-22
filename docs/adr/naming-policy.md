# ADR: 包名与目录命名策略

## 状态

已接受（2026-09）

## 背景

本项目 fork 自 xAI 的 grok-build。Cargo 包名迁移（B0–B6）已经把 62 个 crate 从
`xai-grok-*` 改成 `wth-*`，但**目录名与 `[lib]` name 仍是旧名**：`crates/` 下 81 个
成员中 57 个目录以 `xai-` 开头，68 个 `[lib]` 段中 64 个 lib name 仍是 `xai_*`，
源码里 `xai_grok_*::` 路径引用 6536 处。

全量改名能把命名彻底统一，但要付三笔代价：

1. 6536 处引用改动的 diff 无法人工 review，回归只能靠编译器和测试；
2. 与上游 grok-build 永久分裂，后续合并上游等于重新对拷；
3. 全量重编 + 所有下游脚本/文档同步。

## 决策

**冻结存量命名，只约束新增。**

- 目录名与 lib name 不再改。它们对使用者不可见（包名才是 `cargo -p` 的参数，
  已经全部是 `wth-*`）。
- `scripts/arch/check_arch.py` 的 `naming` 规则强制：**新建 crate 的包名必须以
  `wth-` 开头**。存量 81 个 crate 通过基线的 `known_crates` 豁免，这个豁免清单
  本身是只读的审计线索 —— 它精确记录了「哪些是历史包袱」。
- 7 个刻意保留 `xai-` 前缀的包（computer-hub 三件套、voice、announcements、
  mixpanel、proto-build）在 `docs/adr/upstream-sync-policy.md` 登记理由。
- 第三方 vendored 树（`third_party/`）与 `ptyctl`、`prod-mc-cli-chat-proxy-types`
  等独立命名的成员进 `naming.vendor_prefixes` 或基线豁免。

## 后果

- 贡献者会看到 `crates/codegen/xai-grok-shell/` 目录里的包叫 `wth-shell`。
  这是**已知且刻意**的状态，README 与 CONTRIBUTING 需要说明，否则每个新读者都会
  以为这是迁移事故（本次优化前确实发生过误判）。
- 若未来某个 crate 要发布到 crates.io 或被外部依赖，届时**单独**为它做完整改名
  （目录 + lib name + 引用），而不是等一次大爆炸。
- `cargo -p xai-grok-shell` 这类命令已失效，CI 曾因未同步而变红；
  `scripts/check_workflow_pkg_names.py` 现在常驻拦截。

## 参考

- `docs/Q01-包名迁移方案.md`（迁移本身的方案与执行记录）
- `scripts/arch/architecture-policy.toml` 的 `[naming]`
- `docs/adr/upstream-sync-policy.md`
