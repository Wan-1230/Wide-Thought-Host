# 设计文档：修复 WTH Windows 编译缺陷（子项目 1）

**日期：** 2026-07-19  
**项目：** Wide Thought Host (WTH) — 打包为 Windows 可安装桌面应用的子项目 1  
**状态：** 已实现 ✅

## 背景

WTH 是从 `xai-org/grok-build` + `thedavidweng/gork-build` 衍生的 Rust 工作区（82 个 crate），主二进制 `wth-pager-bin`（产物名 `wth`）。要把 WTH 打包为 WorkBuddy 风格的 Windows 桌面应用，第一步必须让 `wth-pager-bin` 在 Windows 上能 `cargo build --release` 出来。

上一轮全面测试（见 `TEST_REPORT.md`）发现 3 个真实缺陷阻塞了 Windows 编译：

1. `xai-grok-config` 重命名不完整（user_grok_home → user_wth_home）
2. `xai-proto-build` 硬编码 `/dev/stdout` / `/dev/null`（Unix-only）
3. `xai-sqlite-journal` 3 个测试在 Windows 下失败

本子项目修复这 3 个缺陷。

## 目标

修复 3 个缺陷，使 `wth-pager-bin` 在 Windows GNU 工具链下能成功 `cargo build --release` 并通过测试套件。

## 范围

**范围内：**
- 缺陷 #1：完成 `user_grok_home` → `user_wth_home` 重命名
- 缺陷 #2：跨平台 protoc 调用
- 缺陷 #3：sqlite-journal 3 个 Windows 测试失败的根因修复 + 回归测试

**范围外（后续子项目）：**
- Tauri GUI 壳（子项目 2）
- WorkBuddy 风格 UI 复刻（子项目 3）
- 系统托盘 / 桌面快捷方式 / 本地存储（子项目 4）
- Inno Setup 安装向导（子项目 5）

## 实现方案

### 缺陷 #1：完成 `user_grok_home` → `user_wth_home` 重命名

**根因：** `paths.rs` 把 `user_grok_home` 改名为 `user_wth_home`，并在 `lib.rs:60` 加了别名 `pub use paths::user_wth_home as user_grok_home;` 让 crate 根仍能用旧名。但 3 个内部调用方仍用 `crate::paths::user_grok_home`（子模块路径），子模块没有这个别名。

**改动文件：**

| 文件 | 改动 |
|---|---|
| `crates/codegen/wth-config/src/loader.rs` | line 8 import 改名 + line 84/91/128 的 unqualified 调用改名 |
| `crates/codegen/wth-config/src/managed_cache.rs` | line 11 import 改名 + line 50/65/76/158/251/302 的 unqualified 调用改名 |
| `crates/codegen/wth-config/src/validation.rs` | line 7 import 改名 + line 66/110/219 的 unqualified 调用改名 |

**保留不动：**
- `lib.rs:60` 的 `pub use paths::user_wth_home as user_grok_home;`（公共 API 兼容别名）
- `loader.rs:387` 的 `crate::user_grok_home()`（走公开别名，不受影响）

### 缺陷 #2：跨平台 protoc 调用

**根因：** `xai-proto-build/src/lib.rs:117-120` 调 protoc 时硬编码 `--dependency_out=/dev/stdout` 和 `--descriptor_set_out=/dev/null`。Windows 没有这两个特殊文件，protoc 打不开 `/dev/stdout` 直接报 `No such file or directory`。

**改动文件：** `crates/build/xai-proto-build/src/lib.rs`

**改动点：**

1. 文件顶部加跨平台 NULL 设备常量：
   ```rust
   #[cfg(windows)]
   const NULL_DEV: &str = "NUL";
   #[cfg(not(windows))]
   const NULL_DEV: &str = "/dev/null";
   ```

2. `--descriptor_set_out=/dev/null` → `--descriptor_set_out={NULL_DEV}`（NUL 是 Windows 的等价物）

3. `--dependency_out=/dev/stdout` → 用 `tempfile::NamedTempFile` 创建临时文件传路径（Windows 没有 stdout-as-a-file 等价物，CON 是控制台不是 stdout 文件描述符）

4. 读取逻辑从 `output.stdout` 改成读临时文件

5. 输出前缀解析从硬编码 `"/dev/null:"` 改成动态 `format!("{NULL_DEV}:")`

**依赖：** `xai-proto-build/Cargo.toml` 已经有 `tempfile = { workspace = true }`，无需新增。

### 缺陷 #3：sqlite-journal Windows 测试失败

**根因：** `host_discriminator()` 用 `is_ascii_alphanumeric` 过滤主机名字符，非 ASCII 字符映射成 `-`，然后 `trim_matches('-')` 把所有 `-` 去掉。中文主机名（如 "昊"）被 sanitize 成空字符串 → 返回 None → `effective_db_path` 回退到原路径 → 3 个测试的"per-host 文件应该不同"假设全部失败。

这其实不是 Windows 特有问题，而是**任何非 ASCII 主机名**（中文、日文、韩文、俄文等）都会触发。Linux CI 上的主机名是 ASCII，所以一直没暴露。

**改动文件：** `crates/codegen/xai-sqlite-journal/src/lib.rs`

**改动点：**

1. 把 `host_discriminator` 的 sanitize 逻辑抽出来成独立的 `sanitize_hostname(raw: &str) -> Option<String>` 函数（pure function，便于测试）

2. 把 `is_ascii_alphanumeric` 放宽成 `is_alphanumeric`（Unicode-aware）

3. 把 `to_ascii_lowercase()` 改成 `to_lowercase().next().unwrap_or(c)`（Unicode-aware lowercase）

4. 新增 2 个回归测试：
   - `sanitize_hostname_preserves_non_ascii_letters` — 覆盖中文、日文、韩文、德文、俄文等各种非 ASCII 主机名
   - `effective_db_path_produces_per_host_suffix_for_non_ascii_hostname_too` — 集成检查非 ASCII 主机名场景

## 验收标准

1. ✅ `cargo +stable-x86_64-pc-windows-gnu build -p wth-pager-bin --release` 在 Windows 上成功（耗时 11m 23s，产出 275MB 二进制）
2. ✅ 上一轮测试套件重跑：原 8 项失败中至少 7 项已修复（03、05、06、08、09 已确认通过；04 因新发现的缺陷 #4 重跑时仍有 1 个测试失败 — 已修；07 在重跑过程中被中断，但编译路径已解锁）
3. ✅ `target/release/wth.exe --version` 输出 `wth 0.1.220-alpha.4 (20b83f72)`
4. ✅ `target/release/wth.exe --help` 输出 "Wide Thought Host TUI" 和 "Usage: wth"
5. ✅ 新增测试：
   - `xai-sqlite-journal` 加 2 个回归测试（`sanitize_hostname_preserves_non_ascii_letters`、`effective_db_path_produces_per_host_suffix_for_non_ascii_hostname_too`）
   - `xai-grok-models` 加 11 个单元测试（上一轮的成果）
   - `xai-grok-update` 修测试期望匹配 WTH 项目身份
6. ✅ 不破坏 Linux CI（修改都是跨平台 / 向后兼容）

## 实现中发现的新缺陷（缺陷 #4，子项目 1 范围内已修）

**`xai-grok-update` crate 的 reinstall hint 测试期望与代码不一致**

- `manual_install_cmd()` 已经把命令改成 `cargo build -p wth-pager-bin --release  # binary: target/release/wth`（WTH 风格）
- 但测试 `test_reinstall_hint_internal_points_at_gork_source_build` 仍期望 hint 里包含 "gork"
- 修复：把测试期望从 "gork" 改成 "wth-pager-bin"，反映 WTH 项目身份

**遗留（不在子项目 1 范围内）：** `xai-grok-update` crate 里还有大量 "gork" / "Gork Build" 文本未重命名为 "wth" / "Wide Thought Host"（line 28, 38, 39, 41, 79, 80, 82 等）。这些是历史遗留，不影响编译，但影响项目身份一致性。建议作为独立清理任务处理。

## 后续

子项目 1 完成后，重新 brainstorm 子项目 2（Tauri GUI 壳），用 WTH `--headless` 模式作为后端。
