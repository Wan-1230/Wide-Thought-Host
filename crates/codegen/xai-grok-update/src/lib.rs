//! Self-update and the `cli.minimum_version` floor: channel resolution,
//! version-pointer fetches, installer dispatch, restart handoff. Layer L2, but
//! it reaches into `wth-shell` for config paths — a frozen layer violation, so
//! do not treat that edge as a template for new code. Consumers: `wth-pager`
//! and the `wth` binary.
//!
//! The part to get right is the policy flag. `vendor_auto_update_forbidden()`
//! is the single chokepoint every install entry point checks, and it is
//! compile-time true: the only relaxation is building with the
//! `updater-integration-tests` feature *and* setting `GORK_TEST_ALLOW_UPDATE`.
//! No config key or env var can enable vendor updates in a product build, and
//! adding one would let a `https://x.ai/cli` download overwrite this fork.

pub mod auto_update;
mod minimum_version;
pub mod version;

pub use auto_update::UpdateStatus;
pub use minimum_version::enforce_minimum_version_or_exit;
pub use version::{UpdateConfig, channel_label, channel_name, write_version_cache};
