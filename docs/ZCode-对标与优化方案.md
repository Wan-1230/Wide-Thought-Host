# WTH × ZCode 对标：全方位工程化优化方案与执行结果

| 项目 | 内容 |
|---|---|
| 文档类型 | 对标分析 + 改造方案 + 落地记录 |
| 编写日期 | 2026-09-23 |
| 基线 | v2.1.0（commit `40ba6a72`） |
| 对标对象 | [zai-org/ZCode](https://github.com/zai-org/ZCode)（TS / Electron / pnpm monorepo） |
| 本文状态 | 批次 0–5 已落地 7 个 commit；未做项与原因见 §7 |

---

## 1. 核心判断

ZCode 是 TypeScript 项目，WTH 是 Rust 项目。**代码不可移植，治理机制可移植。**

逐条读完 ZCode 的根 `package.json`、`mise.toml` 与其 `scripts/architecture/` 后，
结论是：它真正值得抄的只有一件事——**它把架构约束写成了会红的门禁，而不是写在文档里**。

它的机制清单：`architecture:check`（规则来自 `architecture-policy.yaml`，存量违规存进
`.architecture-baseline.json`，**新增违规 exit 1**）、`--changed` 增量模式、
`architecture:report` / `architecture:context`、`knip` 死依赖检测、`dep:graph` 依赖可视化、
husky + lint-staged 提交门禁、`mise.toml` 工具链双锁、`release-it` 发布自动化、
`patchedDependencies` 受控补丁、`oxlint` / `oxfmt` 统一静态分析。

WTH 的问题不在于"没人发现问题"。`docs/` 里早就有《项目基线梳理报告》《优化 PRD》
《竞品对标报告》三份高质量诊断，把越层依赖、扇出失控、巨型文件写得很清楚——
**写下来之后它们仍然继续恶化了**。原因就是没有任何一条被机制化。

这个判断随后被实测证实：包名迁移（B0–B6，改了 62 个 crate）没同步 `ci.yml`，
里面 10 处 `cargo -p xai-grok-*` 指向已不存在的包名，**CI 的 clippy 与隐私测试 job
长期是红的**，于是"隐私优先"的门禁实际并没有在跑。

---

## 2. 差距诊断（全部经命令/源码核实）

| # | 问题 | 证据 | 处置 |
|---|---|---|---|
| G1 | CI 静默腐烂 | `ci.yml` 10 处失效包名；ubuntu job 里混入 PowerShell 语句；`privacy_egress_check.sh:15` 残留旧名 | ✅ 批次0 |
| G1b | **fmt 门禁本就是红的** | `cargo fmt --all --check` 267 处不合规、40 个文件 | ✅ 批次0 |
| G2 | 死依赖拖慢构建 | `wth-desktop` 声明 15 个内部 path 依赖、`src/` 只引用 2 个；删 13 个后内部闭包 **33 → 18**，另带出 27 个专属外部依赖（`sqlite-vec`/`pdf_oxide`/`rmcp`/`scraper`） | ✅ 批次0 |
| G3 | 零架构门禁 | 无 cargo-deny、无分层校验；实测 **13 条越层**（人工审计只报了 4 条），含 `wth-http`(L1) → `wth-workspace`(L3) 倒挂 | ✅ 批次1 |
| G4 | 巨型文件无上限 | >2000 行 152 个、>3000 行 70 个；`settings_modal.rs` 12471 行/258 fn | ✅ 棘轮冻结（未拆分，见 §7） |
| G5 | 扇出失控 | `wth-shell` 123、`wth-workspace` 81、`wth-pager` 71、`wth-tools` 64 | ✅ 棘轮冻结 + 上限 |
| G6 | 前端零门禁、零测试 | 无 eslint/prettier 配置；vitest 仅 1 文件 15 用例；单 chunk 1.47MB | ✅ 批次0/4 |
| G7 | 版本四处漂移 | `package-lock.json` 停在 1.0.0、`Cargo.lock` 停在 2.0.1 | ✅ 批次0 + 常驻检查 |
| G8 | 仓库卫生 | protoc **三份字节相同**的副本共 36MB 被跟踪，其中两份被注释误称为 dotslash 脚本；`.workbuddy/` 150MB 日志污染 `git status` | ✅ 批次0 |
| G9 | 三处真重复实现 | 桌面 `capabilities.rs`(2437) 自建 memory vs `wth-memory`(9717)；`build_workspace_index` vs `wth-codebase-graph`(8909)；`mcp.rs`(411) vs `wth-mcp`(7538) | ⬜ 见 §7 |
| G10 | 双内核漂移风险 | 自研循环 vs ACP 桥，`kernel_agent` 默认 false，无机制阻止只往桌面侧加工具 | ✅ 批次3 |
| G11 | 文档与贡献者体验 | crate README 0 个；`wth-shell/lib.rs` 顶部 `//!` 0 处；无跨平台 bootstrap | ✅ 批次1/5 |
| G12 | 供应链门禁缺口 | **4 条真实 RUSTSEC**（cargo-audit 与 cargo-deny 读同一库，说明该 job 也该红） | ✅ 批次2 |
| G13 | clippy 门禁形同虚设 | 5 条 lint 全 `allow`；桌面 crate 约 119 条告警无从管起 | ✅ 批次2/5 |

---

## 3. 移植的机制与 Rust 等价物

| ZCode（TS） | WTH（Rust） | 实测结果 |
|---|---|---|
| `architecture-check.mjs` + policy.yaml + baseline.json | `scripts/arch/check_arch.py` + `architecture-policy.toml` + `.architecture-baseline.json` | 243 条冻结，新增即红；全量 7.8s |
| `ts-morph` 解析 import | 直解 77 个 `Cargo.toml` + 源码标识符扫描 | 见下方两条硬约束 |
| `knip` 死依赖 | `dead_path_dep` 规则 | 抓到 7 条，抽查 3 条全为真阳性 |
| `dep:graph` / `dep:refs` | `scripts/arch/dep_graph.py`（DOT / Mermaid / 单 crate 入出边） | 283 条内部边 |
| husky + lint-staged | `scripts/git-hooks/pre-push` + `core.hooksPath` | 不进 CI 重复执行，只做本地快反馈 |
| `oxlint` / `oxfmt` | 已有 rustfmt/clippy；前端引入 **Biome** | 前端 0 error，118 warn 待办 |
| `mise.toml` + bootstrap | `scripts/bootstrap.{sh,ps1}` + `scripts/dev.sh` | 一条命令从 0 到可跑 |
| release-it | `cargo-deny` / `check_version_sync` 已就位；release-plz 未接 | 见 §7 |
| pnpm `overrides` | 根 `[workspace.dependencies]` 收敛 | 只做了安全子集 |

**两条硬约束，是这套机制能否活下来的前提：**

1. **零第三方依赖。** 策略文件用 TOML 而不是 YAML——Python 标准库有 `tomllib`，
   没有 YAML 解析器。要求贡献者 `pip install` 任何东西，门禁就会在部分机器上
   "跑不起来"，进而"没人跑"。
2. **完全离线。** 实测 `cargo metadata --offline --locked` **exit 101**
   （`aligned-vec` 未进本地缓存），所以依赖图从 `Cargo.toml` 文本直解，
   源码引用从正则提取。代价是解析器不够"权威"，收益是不依赖网络与工具链状态。

**棘轮而非清理**：基线冻结 243 条存量违规，PR 只对新违规 exit 1；
`baseline:update` 只允许在 main 上跑、单独成 commit——"基线变大"在 review 里
是一个刺眼的 diff，而不是能悄悄混过去的改动。

---

## 4. 已验证的收益（数字都是本机实测，不是估算）

| 维度 | 改前 | 改后 |
|---|---|---|
| CI `fmt` job | 红（267 处不合规 / 40 文件） | 绿 |
| CI clippy / 隐私测试 job | 红（10 处失效包名） | 绿（且新增防再犯门禁） |
| `wth-desktop` 内部编译闭包 | 33 crate | **18 crate**（−15，另 −27 外部依赖） |
| 前端入口 chunk | 1472.6 kB | **227.6 kB** |
| 前端 JS gzip | 465.5 kB | **267.6 kB（−43%）** |
| 前端构建耗时 | 26.9s | 16.2s |
| 前端测试 | 1 文件 / 15 用例 | **8 文件 / 194 用例** |
| 已知 RUSTSEC | 4 条 | **0 条，且零新增豁免** |
| HEAD 体积 | — | −24MB（去掉两份重复 protoc） |
| 架构违规可见性 | 0（靠文档） | 243 条冻结 + 新增即红 |

**关键取舍**：桌面 clippy 若按直觉加 `-D warnings`，会因约 119 条历史告警**立刻把
CI 长红**——而长红的门禁最终会被人删掉，结局和没有门禁一样。改成
`check_clippy_budget.py` 的每 crate 计数棘轮后，当天就能上线且债务单调递减。
这个模式在架构、clippy、前端三处重复使用。

---

## 5. 三个改变判断的实测发现

1. **`cargo deny` 裸跑是个陷阱。** 它只自动发现 `deny.toml`；不带 `--config` 时
   **静默回落内置默认配置**，而默认许可表白名单是空的——于是把整棵树 100+ crate
   全判违规。看起来像"门禁很严"，实际是门禁根本没配上。已写进配置文件头。

2. **`biome ci` ≠ `biome check`。** 前者隐含 `--error-on-warnings`，会把刻意保留的
   118 条 warn 级待办全部升级成阻断。用它等于把"有可见待办"伪装成"门禁失效"。

3. **jsdom 的 `localStorage` 存在但不可用。** 它定义的是一个在受限 origin 下返回
   `undefined` 的 accessor，所以"按属性是否存在探测"的替身守卫**永远不会装上替身**。
   必须按真实读写探测。

---

## 6. 四个岔路的决策与理由

| 岔路 | 决策 | 为什么 |
|---|---|---|
| 目录改名（57 目录 / 64 lib name / 6536 处引用） | **冻结存量，只约束新增** | 全量改的 diff 无法 review、与上游永久分裂、全量重编；而 `cargo -p` 用的是包名，早已全是 `wth-*`。由 `naming` 规则强制新 crate 必须 `wth-` 前缀，存量在基线 `known_crates` 里成为只读审计线索 |
| 双内核（删自研循环 vs 保留） | **对齐测试 + 灰度，不删代码** | 删 2892 行换来的收敛不可逆，而 `acp_bridge` 未覆盖全部现有 UI 语义（审批/Diff/离线降级）——这正是当初 `kernel_agent` 默认关闭的 ADR 理由。改为机制化防漂移 + 对新装用户灰度 |
| 前端工具链 | **Biome** | 1~2 人项目：一个二进制做格式化+import 排序+lint，配置面小 |
| dependabot 扩面 | **只加 npm，不加 cargo** | `Cargo.lock` 是与上游 re-sync 的头号冲突面；npm 面（ui、vscode）是 fork 自有，无冲突、纯收益。cargo 的安全半边由 `cargo-audit` 硬门禁替代 |

---

## 7. 明确未做（以及为什么不是偷懒）

| 项 | 状态 | 原因 |
|---|---|---|
| 拆分 `handle.rs`(9486) / `app_view.rs`(10353) | ⬜ 未做 | 纯可导航性收益，但对 0-mod 万行文件做机械拆分是**高回归风险、零行为收益**的改动；`file_size` + `giant_no_mod` 棘轮已保证它不再增长。建议单独立项、一次一个文件、`cargo check -p` 即验收 |
| `settings_modal.rs`(12471) 数据驱动重写 | ⬜ 未做 | 需要先有 UI 设计输入（1 个设置项 = 1 条声明的 schema 形状）。当前只冻结增长 |
| 三处重复实现合并（memory / workspace 索引 / MCP） | ⬜ 未做 | 依赖 §6 内核灰度的实测结果；灰度未达标前合并等于把桌面端绑上一条未验证路径 |
| `release-plz` 发布自动化 | ⬜ 未做 | 会引入新 CI job 与 tag 行为，属"需要真实发版演练"的变更；版本单一真源检查已先就位 |
| `cargo-about` / notices `--verify` 进 CI | ⬜ 未做 | 生成脚本已就绪，但实测无法逐字节复现现有 781KB 法律文本。**未擅自覆盖该文件**——这需要维护者确认 |
| 覆盖率（cargo-llvm-cov）、insta 快照扩面、criterion 新基线 | ⬜ 未做 | 优先级低于"先让已有门禁变绿" |
| 前端 a11y 59 处 + `useExhaustiveDependencies` 19 处 | ⬜ 降 warn 并记录 | 需逐处设计判断（键盘可达性、闭包过期）。数量与性质记在 `docs/adr/frontend-quality.md` |
| git 历史里那 36MB protoc | ⬜ 未做 | `filter-repo` 会让所有分支重建基线；已去重 HEAD，公开发布前再一次性处理 |

---

## 8. 提交记录

```
1c0de2c7  chore(ci): clippy 计数棘轮 + cargo-deny 上岗 + crate 文档偿还 5 条存量违规
efa370fd  test(ui): 组件冒烟测试 15 → 194 用例，IPC 收口到单一模块
3ac43617  test(desktop): 双内核对齐测试 + kernel_agent 按内核可定位性灰度
966efb69  build(deps): cargo-deny 供应链门禁 + 修掉 4 个 RUSTSEC（零豁免）
2622d842  perf(ui): Biome 门禁 + PrismLight 与分包，gzip 465→267KB
b252b6d0  style(rust): 全工作区 rustfmt —— 让 fmt 门禁重新有意义
20aaf1ea  fix(ci): 修好静默腐烂的 CI，并把架构约束变成棘轮门禁
```

## 9. 相关文档

- `docs/adr/architecture-governance.md` — 棘轮门禁本身
- `docs/adr/naming-policy.md` — 目录名冻结
- `docs/adr/version-policy.md` — 双版本线与 folder_trust 门控
- `docs/adr/frontend-quality.md` — Biome、体积预算、a11y 待办
- `docs/adr/kernel-parity.md` — 双内核已知差异表与灰度条件
- `docs/adr/upstream-sync-policy.md` — 刻意保留 `xai-` 前缀的合流考量
- `CONTRIBUTING.md` — 本地必跑的门禁清单与 Windows 环境陷阱
