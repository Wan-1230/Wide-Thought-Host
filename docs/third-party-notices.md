# THIRD-PARTY-NOTICES 的生成与核验

| 项目 | 内容 |
|---|---|
| 文档日期 | 2026-09-23 |
| 相关脚本 | `scripts/gen_third_party_notices.py`（零第三方依赖，Python 3.11+ 标准库） |
| 相关决策 | `docs/adr/upstream-sync-policy.md`、`docs/adr/architecture-governance.md` |
| 状态 | 脚本已可用；**入库的 `THIRD-PARTY-NOTICES` 仍是手写文本，未被覆盖** |

## 1. 为什么要动它

仓库根目录的 `THIRD-PARTY-NOTICES` 有 781KB / 18898 行，被 `NOTICE`、
`third_party/README.md`、`third_party/NOTICE`、
`crates/codegen/xai-ratatui-textarea/NOTICE`、
`crates/codegen/xai-ratatui-inline/{NOTICE,README.md}` 引用，
并且 `.gitattributes` 给它单独设了 `-text`（不做换行转换）。

问题是它没有任何生成路径，也没有任何 CI job 校验它。这意味着：加一个依赖，
这个文件不会变；它是否还准确，只能靠人记。Apache-2.0 §4 和 MIT 的归属义务是
按分发计的，文件过期不是「文档不新」，是合规问题。

`scripts/gen_third_party_notices.py` 解决的是**可复现性**这一半。

## 2. 怎么用

```sh
# 看生成结果（不动任何文件）
python scripts/gen_third_party_notices.py --stdout | less

# 跟入库文件比对；不一致 exit 1
python scripts/gen_third_party_notices.py --verify

# 不一致但先不阻断 CI（入库文件仍是手写的，现阶段只能用这个）
python scripts/gen_third_party_notices.py --verify --report-only

# 生成到别处，人工比对后再决定要不要覆盖
python scripts/gen_third_party_notices.py --write /tmp/notices.md

# 确认覆盖（这一步是法律文本变更，需要维护者明确同意）
python scripts/gen_third_party_notices.py --write THIRD-PARTY-NOTICES
```

输入源：`Cargo.lock`（`tomllib` 直解）+ `$CARGO_HOME/registry/src/<index>/<pkg>-<ver>/`
里 cargo 已经解包的清单与 license 文本 + `third_party/*/Cargo.toml` + `bin/` +
`bundled-skills/`。完全离线，不联网，不调 cargo。

**输出里没有日期。** 这是刻意的：同样的输入必须在任何机器上产出逐字节相同的文件，
否则 `--verify` 就只是在报噪声。

本地缓存不完整时脚本会 exit 2 并提示先 `cargo fetch`（离线即可），而不是悄悄生成
一个短一点的文件 —— 后者会让 `--verify` 在一台干净机器上永远失败，而失败原因看不出来。

分区：

| 分区 | 内容 |
|---|---|
| I | 一方 workspace 成员（77 个） |
| II | crates.io 包（1359 个），逐条：源 / license 表达式 / 版权行 |
| III | git 或其他源的包（2 个） |
| IV | `third_party/` vendored（4 个），指回各自 `Cargo.toml` 的 VENDORING NOTES |
| V | 不出现在 `Cargo.lock` 里的打包物：`bin/protoc-win64`、`bundled-skills/`、`editors/` |
| VI | 手工维护的归属补充（`docs/third-party-notices-addenda.md`，原样拼接；文件不存在时明确说明「此时本文件不足以替代手写版」） |
| VII | 按字节去重后的 license 全文（617 段） |

## 3. 实测：现在还不能直接覆盖（2026-09-23）

```
FAIL: THIRD-PARTY-NOTICES does not match the generated output
  checked-in : 18907 lines / 781418 bytes
  generated  : 56769 lines / 2835814 bytes
  lines only in checked-in : 11111
  lines only in generated  : 48973
```

只有约 7800 行重合。差异规模接近整篇重写，原因是结构性的，不是格式没对齐：

**（1）生成器造不出手写的判断。** 入库文件里有大量 Cargo.lock 不存在的信息：

- 每个包「上游声明 `Apache-2.0 OR MIT`，本分发按 MIT 履行义务」这种**择一结论**；
- 「PART I (continued) — BUNDLED UI / SYNTAX THEMES」整节：TUI 主题配色的上游谱系
  （Tokyo Night 的 nvim 端口 Apache-2.0 与原 VS Code 主题 MIT 两条线谁为主、
  Rosé Pine Moon、Oscura Midnight 从哪个 JSON 移植）；
- 「PART I (continued) — IN-TREE SOURCE PORTS」整节：
  `crates/codegen/xai-grok-tools/src/implementations/codex/`（openai/codex）与
  `.../opencode/`（sst/opencode）的移植声明，这是 Apache-2.0 **§4(b) 要求「显著说明
  已修改」** 的正式声明；
- vendored 条目里的逐条本地改动清单（如 dagre_rust 把无锁 `static mut` 计数器改成
  `AtomicUsize`）与对应的 §4 变更声明。

**（2）体量差是设计差，不是 bug。** 入库版按 SPDX 号只嵌标准文本（约十几篇）；
生成版把每条**不同的字节**都嵌一次（617 篇）。后者在合规上更完整（自定义/一次性
license 的全文是真要求，不是可选），代价是文件从 781KB 变成 2.8MB。

**（3）生成器能发现、入库文件目前缺的。**

- `bin/protoc-win64/bin/protoc.exe` 是第三方预编译二进制（© 2008 Google Inc.，
  protocolbuffers/protobuf，BSD-3-Clause），入库文件里**没有它的条目** ——
  只有 Rust 的 `protobuf` crate 的条目。而且 `bin/protoc-win64/` 目录下除
  `readme.txt` 外没有任何 license 文本。这是实打实的缺口。
- `bundled-skills/` 没有任何段落（它是一方 Apache-2.0，不是义务缺失，但分发物
  应当可枚举）。
- 149 个包在自己打包的源码里找不到 license 文本文件（生成器如实标
  `not embedded`，而不是猜一个）。

## 4. 建议：保留现状，把 `--verify` 设为非阻断

**推荐：不覆盖。** 具体做法：

1. 手写版继续作为唯一入库产物；
2. CI 里跑 `--verify --report-only`（exit 0，但把漂移规模打在 job log 里），
   至少「文件跟依赖表脱节」这件事从不可见变成每次 PR 都可见；
3. 新建 `docs/third-party-notices-addenda.md`，把手写版里的第（1）类内容
   （择一结论、配色谱系、§4(b) 移植声明、vendored 改动清单）搬进去；
4. 同时补上 `bin/protoc-win64` 的 BSD-3-Clause 文本（放进 `bin/protoc-win64/`
   或 addenda）；
5. addenda 补齐并核对之后，再用 `--write THIRD-PARTY-NOTICES` 覆盖，并把
   `--report-only` 从 CI 里去掉。

理由：覆盖会连带删掉 §4(b) 变更声明和配色谱系，那是已经付过研究成本的合规资产；
而覆盖换来的收益（可复现）在 addenda 机制补齐后同样能拿到，且不用赌
「机器生成能不能覆盖到人手写的所有判断」。

**不推荐的替代方案**：长期只做报告、不建 addenda。那等于承认这个文件不可验证，
跟现在的状况没有区别，只是多了一个不会变绿的检查。

## 5. 边界

- 本脚本不做 license **合规判定**（某 license 是否允许本项目的使用方式）。它只
  如实登记声明与全文。判定要人做，或者用 `cargo deny`（那会引入第三方依赖，
  与 `docs/adr/architecture-governance.md` 的零依赖约束冲突，需单独立 ADR）。
- 本脚本不联网，不校验 crates.io checksum 与实际字节的对应关系。要那层保证，
  需要 `cargo vendor`，那是另一件事。
- 不要在 feature 分支上跑 `--write THIRD-PARTY-NOTICES`。这个文件的改动应当
  单独成 commit，并且 review 时看得懂少了什么。
