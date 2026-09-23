# Contributing to Wide Thought Host (WTH)

Thanks for helping improve **Wide Thought Host (WTH)** — an optimized coding
agent harness built on [Grok Build](https://github.com/xai-org/grok-build) /
[wth-build](https://github.com/thedavidweng/wth-build).

This project accepts external contributions. By submitting a pull request or
other contribution, you agree that your work is licensed under the same terms
as the project: the **Apache License, Version 2.0** (see [`LICENSE`](LICENSE)
and [`NOTICE`](NOTICE)).

## Before you start

1. Read [`PRIVACY.md`](PRIVACY.md). WTH follows the wth-build privacy-first
   stance; changes that re-enable vendor telemetry without explicit opt-in
   will be rejected.
2. Search [existing issues](https://github.com/Wan-1230/Wide-Thought-Host/issues)
   and PRs to avoid duplicates.
3. For large design changes, open an issue first so we can align on direction.

## Development setup

Requirements:

- Rust toolchain from [`rust-toolchain.toml`](rust-toolchain.toml) (`rustup`
  installs it automatically)
- Rust: on Windows use the GNU toolchain (`rustup toolchain install
  stable-x86_64-pc-windows-gnu`); `scripts/dev.ps1` and
  `scripts/cargo-gnu.cmd` select it for you. The default MSVC host fails on
  build scripts unless the C++ workload is installed.
- `protoc` — vendored at [`bin/protoc-win64`](bin/protoc-win64) (Windows), or
  install a system `protoc` / set `$PROTOC`. `crates/build/xai-proto-build`
  needs the `include/` directory to sit next to `bin/`, so a lone `protoc.exe`
  dropped in `bin/` is not enough.
- Python 3.11+ — the repository-governance scripts under `scripts/` (no third
  party packages; stdlib `tomllib` only).
- Node.js 20+ — desktop UI only.

```sh
git clone https://github.com/Wan-1230/Wide-Thought-Host.git
cd Wide-Thought-Host
cargo check -p wth-pager-bin
cargo run -p wth-pager-bin          # launches the TUI binary `wth`
```

Useful checks (same gates as GitHub Actions CI):

```sh
# Fast, no compilation -- worth wiring into a hook via `scripts/bootstrap.sh --hooks`
python scripts/check_workflow_pkg_names.py   # CI must name packages that exist
python scripts/check_version_sync.py         # the four desktop version surfaces
python scripts/arch/check_arch.py            # architecture ratchet (see docs/adr/architecture-governance.md)
python scripts/check_clippy_budget.py --crate wth-desktop

cargo fmt --all -- --check
cargo clippy --no-deps \
  -p wth-agent -p wth-pager-bin \
  --lib -- -D warnings
cargo clippy --no-deps -p wth-pager-bin --bins -- -D warnings
cargo test -p wth-agent --lib
cargo test -p wth-config --lib
```

On Windows, set the toolchain and protoc first -- the default MSVC host fails on
build scripts unless the VS C++ workload is installed, and `bin/protoc` is no
longer vendored as a bare file:

```powershell
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
$env:PROTOC = "$PWD\bin\protoc-win64\bin\protoc.exe"
```

`cargo deny` needs its config passed explicitly (`cargo deny --config
cargo-deny.toml check`); a bare `cargo deny check` reads no config, gets an empty
license allow-list, and rejects every crate in the tree.

Prefer focused tests for the crate you touch over a full workspace run unless
you are changing shared infrastructure.

## Branching and commits

- Branch from `main`: `git checkout -b fix/short-description`
- Keep commits focused; one logical change per commit when practical
- Prefer **imperative, present-tense** subjects (Conventional Commits style
  welcome):

  ```
  feat(agent): add multi-backend support for gpt-4.1
  fix(config): update default paths to ~/.wth
  chore: refresh NOTICE attribution
  ```

- Do not force-push shared branches other people are using
- Do not commit secrets, `.env` files, or large generated artifacts

## Pull requests

1. **Fork** (if you are not a maintainer) and open a PR against `main`.
2. Fill in a clear description:
   - What problem does this solve?
   - How did you verify it (commands, tests, manual steps)?
   - Any privacy or security impact?
3. Keep the PR reviewable: small diffs beat mega-patches. Split mechanical
   renames from behavioral changes when possible.
4. Update docs (`README.md`, `PRIVACY.md`, user-guide) when behavior changes.
5. Ensure CI and local checks relevant to your change pass.
6. Expect review feedback; please respond or push follow-up commits rather than
   opening a parallel PR.

### Review bar

- Correctness and safety first
- Privacy hard-offs remain hard-offs (no vendor telemetry)
- No silent reintroduction of vendor branding or tracking
- Match existing Rust style and module boundaries; avoid drive-by refactors

## Issues

- Use clear titles and reproduction steps for bugs
- Feature requests should explain the use case, not only the solution
- Security issues: see [`SECURITY.md`](SECURITY.md) — do not file public issues
  that include exploit details or secrets

## Code of conduct expectations

Be respectful. No harassment, spam, or bad-faith contributions. Maintainers may
close or lock discussions that derail the project.

## Upstream relationship

WTH is derived from:

- [`xai-org/grok-build`](https://github.com/xai-org/grok-build) (Apache-2.0)
- [`thedavidweng/wth-build`](https://github.com/thedavidweng/wth-build) (Apache-2.0)

When porting an upstream fix:

- Prefer a clean cherry-pick or minimal reimplementation
- Preserve Apache-2.0 attribution (do not strip upstream copyright headers)
- Re-apply WTH branding deltas if upstream reintroduces tracking

## Questions

Open a GitHub Discussion or issue with the `question` label if unsure how to
proceed. For license questions, start from [`LICENSE`](LICENSE) and
[`NOTICE`](NOTICE). After changing dependencies, `THIRD-PARTY-NOTICES` is
regenerated and checked by `scripts/gen_third_party_notices.py` (see
[`docs/third-party-notices.md`](docs/third-party-notices.md)).

## Windows 中文用户名环境（已知问题）

Windows 用户目录含非 ASCII 字符（如 `C:\Users\刘克凡\`）时，GNU 工具链的
`ld`/`dlltool`/`ar` 无法处理其中的路径，MSVC 路径则可能被 Git Bash 自带的
GNU `link` 工具遮蔽。本地搭建 windows-gnu 构建环境（与 CI
`build-wth-windows` 一致）的可行做法：

1. 安装 rustup 后设置 `RUSTUP_HOME` 与 `CARGO_HOME` 指向**纯 ASCII 路径**
   （如 `D:\rustup-home`、`D:\cargo-home`），并安装
   `stable-x86_64-pc-windows-gnu` 工具链；
2. 安装完整 MinGW binutils 与 `cmake`/`nasm`（MSYS2:
   `pacman -S mingw-w64-x86_64-toolchain mingw-w64-x86_64-nasm mingw-w64-x86_64-cmake`），
   并把 `mingw64\bin` 置于 PATH 前部；
3. 同时设置 `TMP`/`TEMP` 指向 ASCII 路径（cc/dlltool 临时文件需要）；
4. 每次构建前导出上述环境变量
   （`RUSTUP_HOME` / `RUSTUP_TOOLCHAIN` / `CARGO_HOME` / `PATH` / `TMP` / `TEMP`）。
