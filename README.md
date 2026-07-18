<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wth-symbol-white.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/wth-symbol-black.png">
    <img alt="Wide Thought Host logo" src="docs/assets/wth-symbol-black.png" width="96">
  </picture>
  <br>
  Wide Thought Host — <code>wth</code>
</h1>

**An optimized, community-driven coding agent harness. Multi-backend, extensible, privacy-first.**

A from-source customization of the [Grok Build](https://github.com/xai-org/grok-build) /
[gork-build](https://github.com/thedavidweng/gork-build) agent runtime, re-engineered
for multi-model support, enhanced TUI experience, and deep extensibility.

[Building from source](#build-from-source) ·
[Features](#features) ·
[Configuration](#configuration) ·
[Contributing](#contributing) ·
[License](#license)

![WTH TUI](docs/assets/gork-build-tui-screenshot.jpg)

**Wide Thought Host (WTH) is a coding agent harness** — a fullscreen TUI for
interacting with LLMs to write, refactor, and understand code, plus a headless
agent runtime for automation. It supports multiple LLM backends, a rich plugin
ecosystem, and deep shell/tool integration.

</div>

---

## Features

- **Multi-backend LLM support:** OpenAI-compatible APIs, Anthropic Claude,
  local models (Ollama / vLLM), and Grok — pluggable and auto-detected.
- **Fullscreen TUI:** ratatui-based terminal interface with mouse support,
  syntax-highlighted diffs, multi-panel layout, and customizable themes.
- **Rich tool ecosystem:** bash/shell, file operations, LSP integration, git,
  MCP protocol, web search — all with fine-grained permission control.
- **Agent optimization:** intelligent context-window management, prompt
  caching, multi-step plan-execute-verify loops, sub-agent delegation.
- **Plugin system:** hook-based extensibility, slash commands, custom tool
  registration.
- **Privacy-first:** no vendor telemetry, no research uploads, no auto-update
  channels — you control every byte that leaves your machine.

## Build from source

Requirements: Rust (see `rust-toolchain.toml`), `protoc` (see `bin/protoc`).

```sh
cargo run -p wth-pager-bin              # build + launch TUI (binary: wth)
cargo build -p wth-pager-bin --release  # target/release/wth
cargo check -p wth-pager-bin
```

Install the release binary somewhere on your `PATH` as `wth`.

## Quick start

```sh
# Launch the TUI
wth

# Headless mode — run a one-shot prompt
wth --headless --prompt "Explain the architecture of this project"

# Use a specific backend
wth --backend anthropic --model claude-sonnet-4-20250514
```

## Configuration

```toml
# ~/.wth/config.toml
[backends.openai]
api_base = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
default_model = "gpt-4.1"

[backends.anthropic]
api_key_env = "ANTHROPIC_API_KEY"
default_model = "claude-sonnet-4-20250514"

[ui]
theme = "dark"          # dark | light | solarized
default_panels = ["chat", "diff", "terminal"]

[agent]
max_context_tokens = 128000
cache_prompts = true
subagent_delegation = true
```

## Project structure

```
crates/
├── codegen/          # Core agent & TUI crates (wth-agent, wth-pager, wth-tools, ...)
├── common/           # Shared libraries (tool protocol, runtime, tracing, ...)
├── build/            # Build support (proto generation)
third_party/          # Vendored dependencies
docs/                 # User & developer documentation
```

## Documentation

User guide: [`crates/codegen/wth-pager/docs/user-guide/`](crates/codegen/wth-pager/docs/user-guide/)

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup,
commit conventions, and PR expectations. Security reports: [`SECURITY.md`](SECURITY.md).

## Relationship to upstream

This project is a customized distribution derived from:

- [`xai-org/grok-build`](https://github.com/xai-org/grok-build) — the original
  SpaceXAI coding agent harness (Apache-2.0)
- [`thedavidweng/gork-build`](https://github.com/thedavidweng/gork-build) — a
  community fork with vendor telemetry removed

Wide Thought Host (WTH) extends this foundation with multi-backend support,
enhanced agent reasoning, and an improved TUI experience.

**Credit:** original Grok Build is developed and published by SpaceXAI under
Apache-2.0. Gork Build is a community distribution. WTH is an independent
project and is **not** affiliated with, endorsed by, or sponsored by SpaceXAI,
xAI, or the Gork Build contributors. Grok, Grok Build, xAI, and SpaceXAI are
trademarks of their respective owners.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) and attribution in [`NOTICE`](NOTICE).

Upstream copyright (SpaceXAI) is retained as required by Apache-2.0. Community
modifications are copyright the Wide Thought Host contributors.

## Security

Please do **not** open public issues for security reports that include secrets.
See [`SECURITY.md`](SECURITY.md).
