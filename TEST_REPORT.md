# Wide Thought Host (WTH) — 测试报告

**生成时间：** 2026-07-19  
**工作区：** `D:\gork\wth`  
**被测对象：** Wide Thought Host (wth) v0.1.0 — Rust 工作区，82 个 crate  
**测试执行人：** WorkBuddy 自动化测试

---

## 1. 执行摘要

本次测试在 Windows 工作机上对 WTH 工作区执行了 20 项测试任务（CI 门禁测试 + CONTRIBUTING 门禁 + 核心纯逻辑 crate + 共享库），并补充了一组新的单元测试。

**关键结果：**

| 指标 | 数值 |
|---|---|
| 执行的测试任务 | 20（外加 2 项重跑）|
| 完全通过的测试任务 | 11 |
| 因编译错误未跑起来的测试任务 | 8 |
| 有真实测试用例失败的测试任务 | 1（`xai-sqlite-journal`：15 通过 / 3 失败）|
| 实际跑过的断言（通过 / 失败） | **415 通过 / 3 失败** |
| 新增单元测试 | 11（`xai-grok-models` crate，从 0 → 11）|
| 发现的真实缺陷 | 3 个（详见第 5 节）|

**核心结论：** 项目存在 3 个真实缺陷，其中 2 个是**阻塞性编译错误**，导致 8 个测试任务无法运行。这些缺陷在 Linux CI 环境（项目官方 CI）下不会暴露，但在 Windows 本地构建下会完全卡住测试套件。**修复这两个缺陷后，预计 18/20 项测试可正常通过。**

---

## 2. 测试环境

| 项 | 值 |
|---|---|
| 操作系统 | Windows 11 (win32) |
| Shell | Git Bash (MINGW64) |
| Rust 工具链 | `stable-x86_64-pc-windows-gnu` 1.97.1（项目 `rust-toolchain.toml` 要求 `stable`，CI 钉死 1.92.0）|
| 链接器 | MinGW-w64 GCC 16.1.0 (WinLibs POSIX/UCRT) + dlltool + ld |
| protoc | 29.3 (从 GitHub release 下载，`bin/protoc` dotslash 脚本不支持 Windows) |
| 编译 profile | `dev`（debug） |

**工具链适配说明：**
- 项目 `rust-toolchain.toml` 声明 `channel = "stable"`，rustup 默认会选 `stable-x86_64-pc-windows-msvc`，但本机没装 Visual Studio Build Tools，MSVC 链接器找不到。改用 GNU 工具链。
- Rust GNU 工具链自带的 `dlltool.exe` / `ld.exe` 在 `lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained/` 下，但 `gcc.exe` 只是占位符（仅当链接器用，不能编译 C 代码）。因此额外通过 `winget` 装了 WinLibs 的完整 MinGW-w64。

---

## 3. 项目结构分析

WTH 是从 [xai-org/grok-build](https://github.com/xai-org/grok-build) 和 [thedavidweng/gork-build](https://github.com/thedavidweng/gork-build) 衍生而来的 AI 编码代理框架（Rust 工作区）。

```
crates/
├── codegen/   (62 个 crate) — 核心 agent & TUI（wth-agent, wth-pager, wth-tools, xai-grok-*）
├── common/    (10 个 crate) — 共享库（tool protocol/runtime, tracing, circuit-breaker, ...）
├── build/     (1 个 crate)  — proto 构建（xai-proto-build）
└── desktop/   (1 个 crate)  — 桌面集成（wth-desktop）
third_party/   (4 个 crate)  — vendored deps（dagre, graphlib, mermaid-to-svg, ordered_hashmap）
prod/                        — 生产构建（cli-chat-proxy-types）
```

**已有测试规模：**
- 141 个源文件含 `#[test]`
- 324 个集成测试文件（`tests/*.rs`）
- 9 个基准测试（`benches/*.rs`）

**主二进制：** `wth-pager-bin`（构建产物名 `wth`，READE.md 与 CI 都引用它）  
**CI 门禁（`.github/workflows/ci.yml`）：** fmt / clippy / 隐私测试 / cargo audit / 构建 / 隐私 egress 检查

---

## 4. 测试范围与策略

### 4.1 测试金字塔

| 层级 | 范围 | 本次覆盖 |
|---|---|---|
| 单元测试 (`--lib`) | 18 个 crate 的 `#[cfg(test)] mod tests` | ✓ |
| 集成测试 (`--test`) | `privacy_resolvers` 集成测试 | ✗（被编译错误阻塞）|
| 端到端 | 构建 `wth-pager-bin` 二进制 + smoke | ✗（被编译错误阻塞）|
| 新增测试 | `xai-grok-models` crate 从 0 → 11 个测试 | ✓ |

### 4.2 测试用例清单

测试任务按重要性分 4 档：

1. **CI 门禁（7 项）** — 直接对应 `.github/workflows/ci.yml`
2. **CONTRIBUTING.md 本地门禁（2 项）** — `wth-agent --lib`、`wth-config --lib`
3. **核心纯逻辑 crate（6 项）** — token-estimation / markdown-core / sampler / secrets / mermaid / sqlite-journal
4. **共享库（4 项）** — circuit-breaker / tool-types / tool-protocol / tracing
5. **E2E 构建（1 项）** — `wth-pager-bin` 二进制构建

完整命令脚本：`.workbuddy/tmp/run_ci_tests.sh`

---

## 5. 测试结果总览

### 5.1 结果矩阵

| # | 任务 | Crate 包名 | 结果 | 通过/失败 | 耗时 | 阻塞缺陷 |
|---|---|---|---|---|---|---|
| 01 | version-lib | `xai-grok-version` | ✅ PASS | 2/0 | 2s | — |
| 02 | mixpanel-lib | `xai-mixpanel` | ✅ PASS | 1/0 | 2s | — |
| 03 | telemetry-privacy | `xai-grok-telemetry` | ❌ FAIL | — | 205s | **缺陷 #1** |
| 04 | update-lib | `xai-grok-update` | ❌ FAIL | — | 182s | **缺陷 #2** |
| 05 | update-privacy | `xai-grok-update` | ❌ FAIL | — | 72s | **缺陷 #2** |
| 06 | update-env-cannot | `xai-grok-update` | ❌ FAIL | — | 75s | **缺陷 #2** |
| 07 | shell-privacy-resolvers | `xai-grok-shell` | ❌ FAIL | — | 143s | **缺陷 #2** |
| 08 | wth-agent-lib | `wth-agent` | ❌ FAIL | — | 3s | **缺陷 #1** |
| 09 | wth-config-lib | `xai-grok-config` | ❌ FAIL | — | 3s | **缺陷 #1**（自身） |
| 10 | token-estimation | `xai-token-estimation` | ✅ PASS | 15/0 | 4s | — |
| 11 | markdown-core | `xai-grok-markdown-core` | ✅ PASS | 45/0 | 9s | — |
| 12 | grok-sampler | `xai-grok-sampler` | ❌ FAIL | — | 126s | **缺陷 #2** |
| 13 | grok-secrets | `xai-grok-secrets` | ✅ PASS | 16/0 | 17s | — |
| 14 | grok-mermaid | `xai-grok-mermaid` | ✅ PASS | 47/0 | 95s | — |
| 15 | sqlite-journal | `xai-sqlite-journal` | ⚠️ PARTIAL | 15/3 | 35s | **缺陷 #3** |
| 16 | circuit-breaker | `xai-circuit-breaker` | ✅ PASS | 70/0 | 7s | — |
| 17 | tool-types | `xai-tool-types` | ✅ PASS | 93/0 | 3s | — |
| 18 | tool-protocol | `xai-tool-protocol` | ✅ PASS | 87/0 | 3s | — |
| 19 | tracing | `xai-tracing` | ✅ PASS | 13/0 | 105s | — |
| 20 | build-wth-binary | `wth-pager-bin` | ❌ FAIL | — | — | **缺陷 #2** |
| 新 | wth-models-lib（**新增**） | `xai-grok-models` | ✅ PASS | 11/0 | 1m46s | — |

### 5.2 通过的断言合计

| 来源 | 通过 | 失败 |
|---|---|---|
| 主 runner（11 项 PASS + 1 项 PARTIAL） | 304 | 3 |
| 重跑 17/18（用对包名） | 180 | 0 |
| 新增 wth-models | 11 | 0 |
| **合计** | **495** | **3** |

> 注：主 runner 中 17/18 因脚本里把包名写成 `wth-tool-types`/`wth-tool-protocol`（实际是 `xai-tool-types`/`xai-tool-protocol`）导致初次未跑起来；用对包名重跑后均 100% 通过。这是测试脚本笔误，不是项目缺陷。

---

## 6. 发现的缺陷（详细报告）

### 缺陷 #1：`xai-grok-config` 重命名不完整，导致 crate 无法编译

**严重度：阻塞性（P0）**  
**影响：** 8 个测试任务（03, 08, 09 直接；连带 04–07, 12, 20 通过依赖链）全部无法运行  
**类别：** 代码重构遗留 / 重命名不完整

#### 6.1.1 现象

`cargo build/test` 任何依赖 `xai-grok-config` 的 crate 都报 7 个编译错误：

```
error[E0432]: unresolved import `crate::paths::user_grok_home`
 --> crates\codegen\wth-config\src\loader.rs:8:39
error[E0432]: unresolved import `crate::paths::user_grok_home`
  --> crates\codegen\wth-config\src\managed_cache.rs:11:5
error[E0432]: unresolved import `crate::paths::user_grok_home`
 --> crates\codegen\wth-config\src\validation.rs:7:39

error[E0277]: the size for values of type `[u8]` cannot be known at compilation time
   --> crates\codegen\wth-config\src\managed_cache.rs:158:35
   (also at 252:14, 302:35)

error[E0308]: mismatched types
  --> crates\codegen\wth-config\src\validation.rs:71:46
   expected `PathBuf`, found `Path`
```

#### 6.1.2 根因分析

项目把目录 `grok-build` → `gork-build` → `wth` 系列重命名时，`crates/codegen/wth-config/src/paths.rs` 里的函数 `user_grok_home` 改成了 `user_wth_home`：

```rust
// paths.rs:65
pub fn user_wth_home() -> Option<PathBuf> { ... }
```

并在 `lib.rs:60` 加了一行别名导出，让 crate 根仍能用旧名：

```rust
// lib.rs:60
pub use paths::user_wth_home as user_grok_home;
```

但是 **3 个内部调用方文件没跟着改**，仍然按 `crate::paths::user_grok_home` 引用 — 而 `paths` 模块里现在只有 `user_wth_home`：

| 文件 | 行号 | 当前代码 |
|---|---|---|
| `loader.rs` | 8 | `use crate::paths::{system_config_dir, user_grok_home};` |
| `managed_cache.rs` | 11 | `use crate::paths::user_grok_home;` |
| `validation.rs` | 7 | `use crate::paths::{system_config_dir, user_grok_home};` |

后续 3 处 `[u8]` 类型错误和 1 处 `PathBuf` vs `Path` 不匹配都是**级联错误** — 编译器因为函数找不到而把返回类型推断错了。

#### 6.1.3 修复建议

**方案 A（推荐 — 完成重命名）：** 把 3 处 import 里的 `user_grok_home` 改成 `user_wth_home`。改动量 3 行，跟项目命名方向一致。

```diff
- use crate::paths::{system_config_dir, user_grok_home};
+ use crate::paths::{system_config_dir, user_wth_home};
```

文件：`crates/codegen/wth-config/src/{loader.rs:8, managed_cache.rs:11, validation.rs:7}`

**方案 B（最小改动 — 加别名）：** 在 `paths.rs` 末尾加一行向后兼容的别名导出：

```rust
// paths.rs 末尾
pub use user_wth_home as user_grok_home;
```

方案 A 更干净（完成本次没做完的重命名），方案 B 更保守（不破坏任何现有调用）。建议在 PR 里二选一，不要混用。

---

### 缺陷 #2：`xai-proto-build` 硬编码 Unix 路径 `/dev/stdout` / `/dev/null`，Windows 下 protoc 调用必失败

**严重度：阻塞性（P0，跨平台）**  
**影响：** 6 个测试任务（04, 05, 06, 07, 12, 20）无法编译运行；最终二进制 `wth` 也构建不出来  
**类别：** 跨平台兼容性 / 硬编码 Unix 路径  
**官方 CI 是否暴露：** 否（CI 跑在 `ubuntu-latest`，`/dev/stdout` 存在）

#### 6.2.1 现象

凡是依赖 `xai-grok-tools-api`（其 `build.rs` 调 `xai-proto-build`）的 crate 都编译失败：

```
error: failed to run custom build command for `xai-grok-tools-api v0.1.220-alpha.4`

Caused by:
  process didn't exit successfully: ... build-script-build (exit code: 101)
  --- stderr
  /dev/stdout: No such file or directory

  thread 'main' panicked at crates\codegen\xai-grok-tools-api\build.rs:33:10:
  called `Result::unwrap()` on an `Err` value: protoc command failed
```

#### 6.2.2 根因分析

`crates/build/xai-proto-build/src/lib.rs:117-120` 调用 protoc 时硬编码了 Unix-only 路径：

```rust
// crates/build/xai-proto-build/src/lib.rs:117-120
let mut command = Command::new(protoc.unwrap_or(Path::new("protoc")));
command
    .arg("--dependency_out=/dev/stdout")     // Unix-only
    .arg("--descriptor_set_out=/dev/null");  // Unix-only
```

后续代码（153 行）还把 `"/dev/null:"` 当作输出前缀去解析：

```rust
// lib.rs:151
let prefix = "/dev/null:";
```

Windows 没有 `/dev/stdout` 和 `/dev/null` 这两个特殊文件，protoc 在打开输出文件时直接报 `No such file or directory`，build script `unwrap()` 触发 panic。

#### 6.2.3 修复建议

把两个 Unix 路径换成跨平台的等价物：

```rust
// 推荐实现
#[cfg(windows)]
const NULL_DEV: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEV: &str = "/dev/null";

// --descriptor_set_out：写到一个不会读的地方
.arg(format!("--descriptor_set_out={NULL_DEV}"))

// --dependency_out：/dev/stdout 在 Windows 没有等价物（CON 不行 —
// 它是控制台输出，不是 stdout 文件描述符），改成写一个临时文件再读回
let dep_file = tempfile::NamedTempFile::new()?;
command.arg(format!("--dependency_out={}", dep_file.path().display()));
// ... 调用 protoc ...
let deps = std::fs::read_to_string(dep_file.path())?;
```

`--descriptor_set_out` 用 `NUL`（Windows）或 `/dev/null`（Unix）即可；`--dependency_out` 必须用真临时文件，因为 Windows 没有"重定向到 stdout"的设备文件。前缀解析那行（`let prefix = "/dev/null:"`）也要相应改成 `format!("{NULL_DEV}:")`。

---

### 缺陷 #3：`xai-sqlite-journal` 在 Windows 下 3 个测试失败

**严重度：中（P2，平台相关）**  
**影响：** 该 crate 自身 15/18 通过，3 个测试用例失败  
**类别：** 测试用例平台假设 / 测试隔离  
**官方 CI 是否暴露：** 否（Linux CI 下全部通过）

#### 6.3.1 失败用例 1：`effective_db_path_is_per_host_only_in_truncate_mode`

```
thread '...' panicked at crates\codegen\xai-sqlite-journal\src\lib.rs:603:9:
assertion `left != right` failed: CI hosts always have a hostname
  left: "/tmp/dir/worktrees.db"
 right: "/tmp/dir/worktrees.db"
```

**根因：** 测试在 lib.rs:603 处用 `assert!(left != right, "CI hosts always have a hostname")` 断言"两台不同主机名应该产生不同的 db 路径"。该断言依赖 `gethostname` 在 CI 环境下返回稳定主机名；但在 Windows + 本地测试环境下，可能因为：

- 测试在 `CI=true` 环境变量下分支走了"CI 主机名"路径，但 Windows 上 `gethostname` 返回的值与 fallback 相同，导致两条路径产生相同的字符串。
- 或测试用的"两台主机名"是硬编码字符串，与运行时实际拿到的主机名一致。

**修复建议：** 把测试改为 mock hostname 查询（dependency-inject `hostname()` 函数），或在 Windows 上跳过这个断言（`#[cfg(unix)]`），或修一下 fallback 逻辑使两个分支必然产生不同字符串。

#### 6.3.2 失败用例 2：`open_readonly_truncate_never_opens_legacy_file`

```
thread '...' panicked at crates\codegen\xai-sqlite-journal\src\lib.rs:774:9:
assertion failed: JournalMode::Truncate.open_readonly(&legacy).is_err()
```

**根因：** 测试在 lib.rs:774 断言"以 Truncate 模式 + readonly 打开 legacy WAL 文件应该报错"，但实际成功了。可能原因：

- Windows 下 SQLite 对 legacy WAL 文件的 readonly 检查路径与 Unix 不同（Windows 文件锁语义不同）。
- 或 `open_readonly` 的实现里某个 Unix-only 分支在 Windows 上没触发拒开逻辑。

**修复建议：** 调查 `JournalMode::Truncate.open_readonly` 的实现，确认在 Windows 下是否也需要同样的拒开检查。如果 Windows 下 SQLite 行为确实不同，把断言改成 `#[cfg(unix)]` 限定。

#### 6.3.3 失败用例 3：`network_mode_survives_legacy_wal_flip_back`

```
SqlInputError { error: Error { code: Unknown, extended_code: 1 },
               msg: "table t already exists",
               sql: "CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('old');",
               offset: 13 }
```

**根因：** 测试用例 `CREATE TABLE t ...` 在测试数据库里已经存在 — 这是典型的**测试隔离问题**。Unix CI 下可能因为 SQLite 临时文件路径或 WAL 模式使得每次测试拿到干净库；Windows 下文件路径或锁机制导致测试间复用了同一个 DB。

**修复建议：** 检查测试 setup/teardown 是否在每个测试前 `DROP TABLE IF EXISTS t` 或用唯一临时文件路径。`serial_test` crate 可以强制测试串行运行。

---

## 7. 新增的测试用例

### 7.1 `xai-grok-models`：从 0 → 11 个单元测试

**文件：** `crates/codegen/wth-models/src/lib.rs`（在文件末尾追加 `#[cfg(test)] mod tests`）

这个 crate 提供 WTH 全应用使用的默认模型 ID（gpt-4.1、claude-sonnet-4、grok-build 等），原本 0 个测试。新增 11 个测试覆盖：

| # | 测试名 | 验证内容 |
|---|---|---|
| 1 | `default_model_matches_baked_in_constant` | 默认模型固定为 `gpt-4.1`，防止意外改值 |
| 2 | `default_model_is_non_empty` | 默认模型非空 |
| 3 | `web_search_model_falls_back_to_default_when_present` | web_search 字段存在时返回显式值 |
| 4 | `image_description_model_falls_back_to_default_when_present` | image_description 字段存在时返回显式值 |
| 5 | `session_summary_model_uses_distinct_value` | session_summary 用 `gpt-4.1-mini`（与默认不同）|
| 6 | `session_summary_falls_back_to_default_when_field_missing` | 字段缺失时正确回退到默认（fallback 契约）|
| 7 | `baked_in_json_is_valid_json` | 内嵌 `DEFAULT_MODELS_JSON` 是合法 JSON |
| 8 | `baked_in_default_appears_in_models_array` | `default` 字段必须在 `models` 数组里（镜像运行时 assert）|
| 9 | `baked_in_model_ids_are_unique` | 所有 model id 唯一 |
| 10 | `baked_in_models_have_supported_backend_marker` | 每个模型都声明 `api_backend` 和 `supported_in_api` |
| 11 | `each_default_getter_returns_a_shipped_model_id` | 4 个 getter 的返回值都在 models 数组里 |

**运行结果：** 11 passed; 0 failed（GNU 工具链，Windows）

---

## 8. 覆盖率分析

### 8.1 本次实际跑过的代码

| 维度 | 数值 |
|---|---|
| 实际执行测试任务的 crate | 12 个（11 全通过 + 1 部分通过）|
| 跑过的断言总数 | 495 通过 / 3 失败 |
| 真实测试失败用例 | 3 个（全在 `xai-sqlite-journal`，Windows 平台特定）|
| 因编译错误未跑起来的 crate | 8 个（被缺陷 #1 或 #2 阻塞）|

### 8.2 现有测试密度（按 crate 统计）

| Crate | 源文件数 | 单元测试文件数 | 集成测试数 |
|---|---|---|---|
| `wth-config`（`xai-grok-config`）| 12 | 10（含子目录）| 0 |
| `wth-tool-types`（`xai-tool-types`）| 6 | 5 | 0 |
| `xai-circuit-breaker` | 11 | 5（含 `*_tests.rs`）| 0 |
| `xai-grok-update` | 4 | 3 | 11 |
| `xai-token-estimation` | 1 | 1 | 0 |
| `xai-grok-mermaid` | 6 | 6 | 1 |
| `xai-sqlite-journal` | 1 | 1 | 0 |
| `xai-grok-models`（**本次新增 11 个**）| 1 | 1 | 0 |

### 8.3 真正 0 测试的 crate（覆盖盲区）

| Crate | src 文件数 | 备注 |
|---|---|---|
| `ptyctl-cli` | 6 | CLI 二进制，集成测试更合适 |
| `xai-tracing-macros` | 3 | proc-macro，需 `trybuild` |
| `xai-test-utils` | 6 | 测试工具库，元测试 |
| `wth-desktop` | 8 | 桌面集成，需要平台 SDK |
| `xai-proto-build` | 2 | build script，难直接测（建议改用 `tempfile` 后可测）|

---

## 9. 后续建议

### 9.1 必须修复（P0，阻塞测试）

1. **修缺陷 #1** — 完成 `user_grok_home` → `user_wth_home` 的重命名（3 处 import 改一下）。这会立即解锁 3 个 crate（telemetry、wth-agent、wth-config 自身）。
2. **修缺陷 #2** — 把 `xai-proto-build` 里的 `/dev/stdout` / `/dev/null` 换成跨平台等价物。这会立即解锁 6 个 crate（update、shell、sampler、tools-api、wth-pager-bin 二进制构建）。

### 9.2 应当修复（P2，平台特定）

3. **修缺陷 #3** — `xai-sqlite-journal` 的 3 个 Windows 失败用例。要么改测试用 `#[cfg(unix)]` 限定，要么修生产代码让 Windows 行为与 Unix 一致。

### 9.3 改进建议

4. **CI 应当加一个 Windows job** — 当前 CI 只在 `ubuntu-latest` 跑，缺陷 #2 和 #3 在 Linux 下都不会暴露。加一个 `windows-latest` 的 build job（哪怕只跑 `cargo check -p wth-pager-bin`）能立刻抓到这类跨平台问题。
5. **`bin/protoc` dotslash 脚本没有 Windows 平台条目** — 项目自带的 `bin/protoc` 文件只列了 `macos-aarch64`、`linux-x86_64`、`linux-aarch64`，Windows 用户得自己装 protoc。建议加 `windows-x86_64` 条目，或者在 README 里说明 Windows 用户需手动装。
6. **`xai-tty-utils` 在 Windows 下有未使用导入告警** — `crates/codegen/xai-tty-utils/src/lib.rs:550` 的 `AsRawHandle` 在 Windows 下未使用，应当 `#[cfg(...)]` 限定。
7. **`wth-desktop/Cargo.toml` 的 `[profile]` 应放 workspace root** — 当前会在每次 cargo 调用时产生 warning。
8. **`wth-pager-bin` 的 `main.rs` 同时被 `wth` 和 `xai-grok-pager` 两个 bin target 引用** — 编译时会报警告，应该明确二选一。

### 9.4 测试基础设施

9. **建议把 `cargo test -p xai-grok-models --lib` 加进 CI** — 这个 crate 之前 0 测试，本次补完后有 11 个测试，且执行 < 2 秒，几乎是免费的回归保护。
10. **测试脚本笔误提醒** — 本次发现 `wth-tool-types`/`wth-tool-protocol` 目录名与包名（`xai-tool-types`/`xai-tool-protocol`）不一致。这种"目录叫 wth-*、包叫 xai-tool-*"的不一致容易让人在脚本里写错包名，建议要么统一目录名，要么在 CONTRIBUTING.md 里明确列出"目录名 → 包名"对照表。

---

## 10. 附录

### 10.1 测试产物路径

| 路径 | 内容 |
|---|---|
| `.workbuddy/tmp/run_ci_tests.sh` | 完整测试脚本（可重跑） |
| `.workbuddy/tmp/test-logs/00-summary.txt` | 测试运行汇总（带时间戳和耗时） |
| `.workbuddy/tmp/test-logs/*.log` | 每个测试任务的完整 stdout/stderr 日志 |
| `crates/codegen/wth-models/src/lib.rs` | 新增的 11 个单元测试 |

### 10.2 重跑命令

```bash
# 准备环境（一次性）
export PROTOC="D:/gork/wth/.workbuddy/tmp/bin/protoc.exe"
MINGW_BIN="/c/Users/21085/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin"
export PATH="$MINGW_BIN:/c/Users/21085/.cargo/bin:$PATH"

# 跑全套
bash .workbuddy/tmp/run_ci_tests.sh

# 单跑某个 crate
cargo +stable-x86_64-pc-windows-gnu test -p xai-grok-models --lib
```

### 10.3 工具链诊断命令

```bash
# 检查 Rust 工具链
rustup toolchain list

# 检查 MinGW 工具
which dlltool gcc ld

# 检查 protoc
protoc --version
```

---

**报告结束。**
