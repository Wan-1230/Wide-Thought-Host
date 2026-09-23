# ADR: 上游合流策略

## 状态

已接受（2026-09-23）。上一次记录的上游位置是 2026-07-17（见下），本 ADR 需要在
2026-Q4 复核一次。

## 背景

WTH fork 自 `xai-org/grok-build`。这个决策的代价不是一次性的，而是持续的：只要还
想吸收上游的修复，就要一直知道「我们改了什么、改了多少、哪些改动跟上游是冲突的」。
这类数字靠印象来记一定会失真，所以先把它变成可跑出来的事实。

`scripts/upstream-delta.sh` 就是干这个的。它在 2026-09-23 跑出来的基线：

| 事实 | 值 |
|---|---|
| 导入提交 | `c1b5909e`（2026-07-15，"Publish harness and TUI open-source"），2715 个文件 |
| 最后一次有记录的上游同步 | `origin/sync/upstream-0.2.101-8adf901`，`Upstream: 8adf9013a09…`，`Version: 0.2.101`，2026-07-17 |
| `upstream` remote | **未配置**。只有 `origin`，所以现在算不出「相对上游当前状态」的 diff |
| 导入后新增文件 | 1041 |
| 导入后删除文件 | 833（其中 784 在 `crates/codegen/`） |
| 两边都在、但内容已改的文件 | 1215 |
| 目录被改名的成员 | 9 个（`xai-grok-pager` → `wth-pager` 等）；另有 57 个成员目录名 ≠ 包名 |
| 保留 `xai-` 包名前缀的成员 | 7 个 |
| `third_party/` vendored | 4 个 crate，合计约 26000 行 Rust |
| 提交尾注 `Gork-Patch-Id` | 全库 42 个提交带，**main 上 0 个** |

最后一条是这份 ADR 存在的真正原因。2026-07 那批同步做过一个像样的补丁队列约定：
12 个具名补丁流（`telemetry-hard-off`、`vendor-updater-hard-off`、`research-upload-hard-off`、
`egress-guard`、`privacy-core`、`privacy-contract-tests`、`retention-opt-out`、
`supply-chain-policy`、`product-identity`、`branding-docs`、`control-metadata`、
`package-publishing`），配 `Gork-Invariant` 和 `Gork-Risk` 尾注。之后 200 多个提交
一个都没带。约定没被否定，只是没人用了 —— 结果是「这一处改动是不是上游带来的」
在 main 上已经查不出来了。

## 决策

### 1. 三层划分：不动 / 已永久分叉 / 待定

**A. 刻意不动，保留合流能力**（改这些要写理由）：

- 7 个保留 `xai-` 包名的成员：`xai-proto-build`、`xai-grok-announcements`、
  `xai-grok-voice`、`xai-mixpanel`、`xai-computer-hub-core`、
  `xai-computer-hub-mcp-adapter`、`xai-computer-hub-sdk`。包名跟上游一致，意味着
  上游动这些目录时 `[package] name` 那一行不需要重新解冲突。这 7 个也是隐私面最
  集中的地方（mixpanel、announcements、voice），改它们的行为要过
  `scripts/privacy_egress_check.sh`。
- 上游原有的模块划分与文件路径，除了已经发生的 9 个目录改名之外不再动。
  `docs/adr/naming-policy.md` 说的「冻结」是这个意思：不是从没改过，是**从现在起不再改**。
- `Cargo.lock` 的版本选择：只按依赖需要升，不为了跟上游对齐而锁旧版本。
  锁旧版本换来的可合并性，抵不过它带来的审计成本。

**B. 已永久分叉，不再考虑合流**：

- `crates/desktop/`（导入时 0 个文件，现在 92 个）、`bundled-skills/`、`docs/`、
  `editors/`、`scripts/`。上游没有这些目录，永远不会冲突。
- 包名本身。62 个 `xai-grok-*` → `wth-*` 的改名已经落地并生效在 `cargo -p` 上，
  回不去，也不该回去。
- 所有隐私硬关闭点：遥测、研究上传、自动更新通道、`scripts/privacy_egress_*`。
  这些是产品主张，不是可协商的合并冲突。上游若重新引入，按冲突处理，不按建议处理。
- 已经改名的 9 个 crate 目录。`xai-grok-pager` → `wth-pager` 之类已经发生，
  合并时按 rename 处理，不改回来。

**C. 待定**：其余 52 个成员。默认不主动重排结构；要做架构调整（拆巨型文件、
消越层依赖）时照做，不以「上游可能会动这块」为理由推迟 —— 那个理由已经在
`architecture-governance.md` 里被证伪过一次了。

### 2. 恢复补丁尾注，但只对新改动

新增或恢复一个跟上游有实质重叠的改动时，提交信息带：

```
Gork-Patch-Id: <stream>
Gork-Invariant: <改坏了会怎样>
Gork-Risk: low | medium | high
```

不回填历史。200 多个提交没有尾注，回填出来的是一堆猜的标签，比没有更糟。
从这次之后带上就够了 —— 需要的是「下次同步时哪些改动必须保住」，而那是从今往后的问题。

`upstream-delta.sh` 的第 0 节会报当前覆盖率，所以这条要么在被执行，要么在被看见没执行。

### 3. 把上游 remote 配上，或者明确放弃合流

现在最尴尬的状态是：既没有真的在跟上游合并，也没有正式宣布不再合并，于是每个
「这个要不要跟上游保持一致」的讨论都要从零重新判断。季度复核第一个动作就是二选一。

### 4. 季度复核判据（具体到怎么量）

每季度一次（下一次：2026-Q4）。按顺序判，判到第一个成立的结论就停：

| 判据 | 怎么量 | 结论 |
|---|---|---|
| 上游是否还活着 | `git fetch upstream && git log --oneline --since=3.month upstream/main \| wc -l`（remote 未配置时先去配，或者确认放弃） | 90 天内 0 个提交 → 放弃合流，删掉 7 个 `xai-` 前缀的豁免理由，`naming-policy.md` 随之更新 |
| 安全修复是否只能从上游拿 | `cargo audit` 的 advisory 列表 vs 上游同期是否已修（`prod/audit.toml` 记录豁免） | 若上游是唯一路径 → 维持可合并性，优先级高于代码整洁 |
| 冲突面是否在扩大 | `upstream-delta.sh --section churn` 的 `crates/codegen/*` 排名，与上季度比 | 有 `crates/codegen/` 行进入前 5 → 说明我们在重写上核心，要么缩小改动面，要么承认分叉 |
| 补丁尾注覆盖率 | `upstream-delta.sh --summary` 的 `patch_ids_head` / 本季度提交总数 | 覆盖率 0 且本季度动过 A 类目录 → 约定已死，正式废除并改本 ADR |
| vendored 树是否还能跟上游 | `third_party/*/Cargo.toml` 里 pin 的 rev 与上游 tag 的差距 | 差距 > 2 个月且上游有安全修复 → 升级并重新过一遍 VENDORING NOTES |

### 5. `--verify` 类检查一律非阻断，除非产物是生成的

本 ADR 不要求给 notices 或 delta 加强制门禁。`upstream-delta.sh` 是人查的，
`gen_third_party_notices.py --verify` 在 notices 文件换成生成产物之前只能
`--report-only`（见 `docs/third-party-notices.md`）。

## 后果

- 合流能力是**局部**的：7 个包名、上游目录结构、模块划分保住了；`crates/desktop/`、
  桌面端 UI、文档、脚本、隐私硬关闭面放弃了。这是一次有意的不对称交易 —— 我们用
  边缘的不可合并，换核心的可合并。
- 好处：`upstream-delta.sh` 30 秒内给出一份可核对的事实，季度复核从「大家印象里
  上游改了不少」变成「churn 前 5 名是哪 5 个」。
- 代价：`Gork-Patch-Id` 会被人忘记。所以覆盖率要打印出来，而不是写在文档里指望自觉。
- 已知风险：本 ADR 里的上游位置（`8adf901`，v0.2.101）是 2026-07-17 的记录，
  已经 2 个月没有更新过。如果这期间上游有大改，上面的「冲突面」估计全部偏乐观。
- 与 `naming-policy.md` 的关系：那份 ADR 说的「在 B3/B5 执行前按上游活跃度再决策」
  由本文件接手，结论是保留 7 个 `xai-` 前缀，理由是它是**目前最便宜的**可合并性
  保法（只保包名，不动 6536 处引用）。

## 参考

- `scripts/upstream-delta.sh`（本文数字的来源）
- `docs/adr/naming-policy.md`（前缀豁免的出处）
- `docs/adr/architecture-governance.md`（棘轮门禁；本 ADR 的判据用它跑出来的分层事实）
- `NOTICE`、`THIRD-PARTY-NOTICES`（Apache-2.0 §4 归属）
- `scripts/privacy_egress_check.sh`（B 类里最不可让的一部分）
