# WTH 项目长期记忆

## 项目身份
- **Wide Thought Host (WTH)** — Rust 工作区，82 个 crate
- 来源：从 `xai-org/grok-build` + `thedavidweng/gork-build` 衍生
- 主二进制：`wth-pager-bin`（产物名 `wth`）
- 远程仓库：`https://github.com/Wan-1230/Wide-Thought-Host.git`

## Windows 构建配置（重要）
- 本机没装 Visual Studio Build Tools → 不能用默认的 MSVC 工具链
- 必须用 `cargo +stable-x86_64-pc-windows-gnu`
- 完整 MinGW 路径：`/c/Users/21085/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin`
- protoc 路径：`D:/gork/wth/.workbuddy/tmp/bin/protoc.exe`（项目自带的 `bin/protoc` dotslash 不支持 Windows）

## 已知缺陷（截至 2026-07-19）
1. **P0** `xai-grok-config` 重命名遗留：`paths.rs` 改名 `user_grok_home → user_wth_home` 但 3 处 import 没改 — **已修复（2026-07-19）**
2. **P0** `xai-proto-build/src/lib.rs:117-120` 硬编码 `/dev/stdout` / `/dev/null`，Windows 下 protoc 必失败 — **已修复（2026-07-19）**
3. **P2** `xai-sqlite-journal` 3 个测试在 Windows 下失败 — **已修复（2026-07-19）**（根因：`host_discriminator` 用 `is_ascii_alphanumeric` 把非 ASCII 主机名清空，改成 Unicode-aware `is_alphanumeric`）
4. **P2** `xai-grok-update` 的 reinstall_hint 测试期望与代码不一致 — **已修复（2026-07-19）**

## 子项目 1 完成（2026-07-19）

修复 4 个缺陷后，`wth-pager-bin` 能在 Windows GNU 工具链下 release 编译并运行：
- `cargo +stable-x86_64-pc-windows-gnu build -p wth-pager-bin --release` → 11m 23s → 275MB wth.exe
- `wth --version` / `wth --help` smoke test 通过
- Spec 文档：`docs/superpowers/specs/2026-07-19-fix-windows-compile-defects-design.md`

## 遗留问题（待清理）
- `xai-grok-update` crate 里还有大量 "gork" / "Gork Build" 文本未重命名为 "wth" / "Wide Thought Host"。不影响编译，但影响项目身份一致性。
- `wth --help` 输出里仍有 "gork" 字样（如示例 `gork "fix the bug"`），同上。

## 命名约定陷阱
- 目录名 `wth-*` ↔ 包名 `xai-grok-*` / `xai-tool-*` 经常不一致
- 写 cargo 命令前查 Cargo.toml 的 `name` 字段，不要凭目录名猜
- grok → wth 重命名只做了一半，到处有半成品

## CI 门禁
- `.github/workflows/ci.yml` 跑：fmt / clippy / 隐私测试 / cargo audit / 构建 / 隐私 egress
- CONTRIBUTING.md 额外列：`cargo test -p wth-agent --lib`、`cargo test -p wth-config --lib`
- CI 只在 Linux 跑，Windows 跨平台问题不会暴露
