//! Session host: owns the agent turn loop, the on-disk session store, config
//! and auth resolution, and the ACP surface every frontend talks to. Layer L3
//! in `scripts/arch/architecture-policy.toml` — it may use capabilities
//! (`wth-tools`, `wth-agent`, `wth-mcp`) but must not import a frontend.
//! Dependents: `wth-pager*`, `wth-desktop`, `wth-update`.
//!
//! Two things bite. The lib target is still `xai_grok_shell`, so source paths
//! read `xai_grok_shell::…` while `cargo -p` wants `wth-shell`. And `leader/`
//! runs one host process per machine over a Unix socket — anything you attach
//! to a session is shared by every client on it, not private to the one that
//! started the turn.

// TEMPORARY: allow block removed to measure which lints still fire.
pub(crate) use xai_grok_telemetry::unified_log;
pub use xai_tracing_macros::{teprintln, timed, tprintln};
pub mod active_sessions;
pub mod agent;
pub mod auth;
pub mod builtin;
pub mod bundle;
pub mod claude_import;
pub mod claude_import_state;
pub mod cli_models;
pub mod config;
pub use xai_grok_shell_base::cpu_profile;
pub use xai_grok_shell_base::env;
pub mod extensions;
pub use xai_grok_workspace::foreign_sessions;
pub mod heap_profile;
pub use xai_grok_http as http;
pub mod inspect;
pub mod instrumentation;
pub mod leader;
pub mod managed_config;
pub mod mcp_doctor;
pub use xai_grok_models as models;
pub mod plugin;
pub mod relay;
pub mod remote;
pub mod sampling;
pub mod session;
pub mod terminal;
#[cfg(test)]
pub(crate) mod test_support;
pub mod tier;
pub mod tools;
pub mod trace_classifier;
pub mod upload;
pub mod util;
