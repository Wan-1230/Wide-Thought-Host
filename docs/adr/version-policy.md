# ADR: 版本单一真源与双版本线

## 状态

已接受（2026-09）

## 背景

仓库里存在多个版本表述，此前已出现漂移（`scripts/check_version_sync.py` 首次运行
即抓到 `ui/package-lock.json` 停在 1.0.0，而其余桌面端表面是 2.1.0；`Cargo.lock`
里 `wth-desktop` 也曾停在 2.0.1 未随发版刷新）。

关键事实：桌面端与 CLI **不是一次发版**。

| 表面 | 当前值 | 用途 |
|---|---|---|
| `crates/desktop/wth-desktop/Cargo.toml` | 2.1.0 | 桌面包版本 |
| `tauri.conf.json` | 2.1.0 | 安装包与「关于」面板显示、更新比较 |
| `ui/package.json` + `package-lock.json` | 2.1.0 | 前端构建产物 |
| `crates/codegen/wth-pager/Cargo.toml` | 0.1.220-alpha.4 | CLI 版本线 |
| `GROK_VERSION` 环境变量（构建时注入） | 发版时给定 | `xai-grok-version::VERSION` 的真值来源 |
| 根 `[workspace.package].version` | 2.1.0 | 无 crate 继承，仅作产品锚点 |

## 决策

1. **桌面端四处必须一致**，由 `scripts/check_version_sync.py` 强制，挂在 CI 的
   `hygiene` job 上。四处指向上表前三行 + lockfile。
2. **不合并 CLI 与桌面的版本线**。`xai-grok-shell/src/agent/folder_trust.rs` 与
   `xai-grok-workspace/src/folder_trust.rs` 有**按版本号门控**的行为（判断二进制是否
   是「已发布版本」以决定是否自动信任目录）。把 `wth-pager` 从 0.1.220 强行抬到
   2.1.0 会改变这些分支的语义，属于行为变更，不是清单整理。
3. **CLI 的版本真值是构建期的 `GROK_VERSION`**，`CARGO_PKG_VERSION` 只是 dev 构建的
   兜底。因此 CI/打包必须显式注入 `GROK_VERSION`；`--version` 输出同时带 git short
   sha（`VERSION_WITH_COMMIT`），便于定位。
4. 根 `[workspace.package].version` 保留为产品锚点并加注释说明「无人继承」，
   避免下一个人以为改它就能改版本。

## 后果

- 一个 release tag（`v2.1.0`）驱动桌面端四处；CLI 的 `0.1.220-alpha.4` 在
  `--version` 里与桌面版本不同，属预期。README 若声称「同版本」需按此修正。
- `release` 自动化接入后（见 `docs/ZCode-对标与优化方案.md` 批次 5），四处由流程
  一次性 bump，人工不再手改；届时本 ADR 补充实际操作步骤。
- folder_trust 的版本门控是**未来合并版本线的唯一阻塞点**，要合并必须先审这些门控。

## 参考

- `scripts/check_version_sync.py`
- `crates/codegen/xai-grok-version/{build.rs,src/lib.rs}`
- `docs/adr/naming-policy.md`
