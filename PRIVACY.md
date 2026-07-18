# Wide Thought Host (WTH) — privacy model

Wide Thought Host (WTH) is a community distribution derived from
[gork-build](https://github.com/thedavidweng/gork-build), which is itself a
privacy-first fork of [xAI Grok Build](https://github.com/xai-org/grok-build).
WTH inherits gork-build's privacy hard-offs and extends them.

**Same agent capabilities, no product tracking, no research data collection
on the client.**

Background (why the hard-offs exist):
[wire analysis of Grok Build 0.2.93](https://gist.github.com/cereblab/dc9a40bc26120f4540e4e09b75ffb547).

## Hard guarantees (this build)

These are compile-time / resolver-level hard-offs. Remote settings, env vars,
and config files **cannot** re-enable them.

1. **Research / trace uploads** — `resolve_trace_upload()` always returns
   `false`. Session traces are never uploaded.
2. **Data-collection flags** — `is_data_collection_disabled()` is always
   `true`; `allows_data_collection()` is always `false`.
3. **Product telemetry** — telemetry mode is always `Disabled`. Mixpanel
   clients are never constructed; any remaining calls are no-ops.
4. **Vendor auto-update** — hard-disabled. WTH never installs from vendor
   update channels. Update by rebuilding from source or community releases
   from this project.
5. **No vendor branding or tracking** — all vendor-specific analytics
   identifiers are removed; feature flags cannot re-enable them.

## What still leaves the machine

**Model inference traffic.** WTH must send prompts and tool results to the
LLM API you configure in order to function. That is inherent to any cloud
coding agent — the model needs to see your code to operate on it.

Unlike upstream Grok Build, WTH supports multiple backends (OpenAI,
Anthropic, xAI, local models), so you can choose where your data goes.

**Recommendations:**
- For sensitive work, use a local model via Ollama/vLLM or a self-hosted API
- Configure `WTH_API_KEY` for each backend individually
- Review `~/.wth/config.toml` to verify your backend settings

## What WTH does NOT add

- No extra research packaging or telemetry layers
- No third-party analytics (no Mixpanel, no Sentry unless you set `SENTRY_DSN`)
- No vendor auto-update channels
- No feature flags from remote servers that can change privacy behavior

## Verification

The gork-build privacy hard-offs are inherited intact. WTH adds:
- `WTH_API_KEY` / `WTH_API_BASE_URL` env vars for explicit backend control
- Multi-backend support so you're not locked into a single vendor's API
- `~/.wth/config.toml` for transparent configuration

Source code is fully open (Apache-2.0). You can audit every network call.
