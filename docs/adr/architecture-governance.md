# ADR: 架构约束用棘轮门禁，不用文档约定

## 状态

已接受（2026-09）

## 背景

`docs/` 里已经有三份高质量诊断（基线梳理报告、优化 PRD、竞品对标）把问题写清楚了：
4 类越层依赖、5 个 crate 扇出超限、152 个 >2000 行文件、13 个只声明不引用的依赖。
**写下来之后它们仍然继续恶化了** —— 包名迁移完成后 `ci.yml` 里 10 处 `cargo -p`
指向已不存在的包名，CI 静默变红很久没人发现，因为没有任何机制检查「CI 引用的名字」。

对标项目 ZCode（TS/Electron pnpm monorepo）的关键差异不在分层，而在治理：它把规则
写成可执行门禁（`architecture:check` + 策略文件 + 基线快照 + pre-push + CI），
所以债务只会减少不会增加。

## 决策

移植该机制，按 Rust 生态改写：

| ZCode（TS） | 本项目（Rust） |
|---|---|
| `scripts/architecture/architecture-check.mjs` | `scripts/arch/check_arch.py` |
| `architecture-policy.yaml` | `architecture-policy.toml` |
| `.architecture-baseline.json` | `scripts/arch/.architecture-baseline.json` |
| `ts-morph` 解析 import | 直解 77 个 `Cargo.toml` + 源码标识符扫描 |
| `knip` 死依赖 | `dead_path_dep` 规则（+ `cargo-machete` 可选） |
| `dep:graph` / `dep:refs` | `scripts/arch/dep_graph.py` |
| husky + lint-staged | `scripts/git-hooks/pre-push` + `core.hooksPath` |
| `pnpm architecture:check --changed` | `check_arch.py --changed` |

**三条硬约束，是这次移植能不能活下来的前提：**

1. **零第三方依赖**。策略文件用 TOML 而不是 YAML：Python 标准库有 `tomllib`，
   没有 YAML 解析器。要求贡献者 `pip install` 任何东西都会让门禁在部分机器上
   变成「跑不起来」，进而变成「不跑」。
2. **完全离线**。`cargo metadata` 在本仓库**不可用**（离线时 exit 101，
   `aligned-vec` 未进本地缓存），所以依赖图从 `Cargo.toml` 文本直解，源码引用从
   正则提取。代价是解析器不够「权威」，收益是不依赖网络与工具链状态。
3. **棘轮而非清理**。基线冻结 248 条存量违规，PR 只对新违规 exit 1。
   `baseline:update` 只允许在 main 上跑、单独成 commit —— 这样「基线变大」在
   review 里是一个刺眼的 diff，而不是一个可以悄悄混过去的改动。

## 规则清单（首跑实测）

| 规则 | 存量 | 判据 |
|---|---|---|
| `file_size` | 152 | `.rs` > 2000 行 |
| `giant_no_mod` | 70 | > 3000 行且 0 个 `mod` 声明（无法导航也无法 review） |
| `layer_violation` | 13 | 低层依赖高层。首跑就抓到人工漏报的 9 条，含 `wth-http`(L1) → `wth-workspace`(L3) 这种严重倒挂 |
| `dead_path_dep` | 7 | 声明了但源码零引用（桌面端那 13 个已在本次清掉，见下） |
| `crate_doc` | 5 | > 5000 行的 lib crate 无 `//!` 角色说明 |
| `denied_edge` | 1 | `[[deny]]` 点名的同层错误边：`wth-memory -> wth-tools` |
| `naming` | 0 | 新 crate 必须 `wth-` 前缀（见 `naming-policy.md`） |
| `cycle` | 0 | 内部依赖强连通分量 |

首跑之后已核实并落地的最大一条：`wth-desktop` 声明 15 个内部 path 依赖、源码只引用
2 个（`xai_grok_config`、`xai_grok_shell`），删掉 13 个后内部编译闭包 33 → 18，
另带出 27 个专属外部依赖；`cargo check -p wth-desktop` 通过（10m33s，GNU 工具链）。

## 后果

- 正面：4 类「写在文档里没人执行」的约束变成会红的 job；新增 crate / 新增依赖 /
  新增大文件都会被机制挡住；`--crate X` 让「删这个会炸什么」变成可查事实。
- 成本：全量检查约 8 秒（优化前 90 秒 —— `dead_path_dep` 从「每个依赖跑一遍正则」
  改成「每个文件跑一遍标识符提取」）。可接受进 CI，也可接受进 pre-push。
- 已知不足：标识符提取是文本级的，`build.rs` 里用宏或字符串拼接的引用可能误判。
  首跑抽查 3 条 `dead_path_dep` 均为真阳性；后续出现误报时应把该边写进
  `architecture-policy.toml` 的豁免而不是关掉整条规则。
- `cargo metadata` 修复（vendor `aligned-vec` 或允许联网）后可以换成权威解析，
  但**不要**因此引入网络依赖。

## 参考

- `docs/ZCode-对标与优化方案.md`（完整对标与批次计划）
- `docs/adr/naming-policy.md`、`docs/adr/version-policy.md`
- `docs/adr/unified-kernel-policy.md`（内核灰度，与本机制的 `dead_path_dep`/工具集规则相关）
