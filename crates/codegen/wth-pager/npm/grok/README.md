# Wide Thought Host (`@wth-build/wth`)

Optimized coding agent harness — multi-backend LLM support, enhanced TUI, deep extensibility.
Derived from [gork-build](https://github.com/thedavidweng/gork-build) /
[xai-org/grok-build](https://github.com/xai-org/grok-build) (Apache-2.0).

**[Repository](https://github.com/Wan-1230/Wide-Thought-Host)**

## Install

Prefer building from source:

```bash
git clone https://github.com/Wan-1230/Wide-Thought-Host.git
cd Wide-Thought-Host
cargo build -p wth-pager-bin --release
```

Binary: `target/release/wth`

Or install via npm (when published):

```bash
npm install -g @wth-build/wth
```

## Configuration

```toml
# ~/.wth/config.toml
[backends.openai]
api_base = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
default_model = "gpt-4.1"
```

## License

Apache-2.0. Not affiliated with SpaceXAI / xAI.
