//! Config file loading for Wide Thought Host (WTH).
//!
//! Merge order (lowest → highest priority):
//! 1. `/etc/wth/managed_config.toml`
//! 2. `$WTH_HOME/managed_config.toml`
//! 3. `$WTH_HOME/config.toml`
//! 4. `$WTH_HOME/requirements.toml` (cloud cache; Ed25519-signed at rest once a
//!    key is embedded — see [`signed_policy`] — below the OS-protected layers)
//! 5. `/etc/wth/requirements.toml`
//! 6. macOS MDM managed preferences (`ai.x.grok`, admin-forced) — macOS only
//!
//! Each layer applies its own [`[[version_overrides]]`](version_overrides)
//! before merge. Requirements layers (#4–#6) may opt into fail-closed startup;
//! see [`validate_requirements`].

pub mod campaigns;
pub mod config_override;
mod fs_atomic;
mod loader;
mod macos_managed;
mod managed_cache;
mod paths;
pub mod shell;
pub mod signed_policy;
mod validation;
pub mod version_overrides;

// Only the cross-crate campaign surface is re-exported at the root; the rest stays
// reachable via the `pub mod` paths for in-crate use without widening the API.
pub use campaigns::{
    CampaignEntry, CampaignOverrides, filter_active_campaigns, ids_touching_paths,
};
pub use loader::{
    CampaignsState, ConfigLayers, MANAGED_CONFIG_FILENAME, ManagedConfigLayer,
    apply_version_overrides_with_registered, campaigns_application_disabled, campaigns_state_path,
    deep_merge_toml, expand_env_vars_in_string, expand_env_vars_in_toml, load_config_file,
    load_dismissed_ids_from_home, load_effective_config_disk_only, load_from_disk,
    load_managed_config, load_system_managed_config, load_toml_file, managed_config_layers,
    managed_config_layers_at, toml_error_detail,
};
pub use macos_managed::MDM_REQUIREMENTS_SOURCE;
pub use managed_cache::{
    ServingIdentity, SyncMarker, is_managed_config_hard_stale_for, is_managed_config_stale_for,
    managed_config_identity_changed, managed_deployment_id, managed_policy_compromised_for,
    mark_managed_config_synced,
};
pub use paths::{
    claude_managed_settings_path, claude_managed_settings_probe_path, decode_cwd_from_dirname,
    default_wth_home, encode_cwd_dirname, ensure_sessions_cwd_dir, wth_application, wth_home,
    sessions_cwd_dir, system_config_dir, user_wth_home,
};

// Backward-compatibility aliases for Grok/Gork Build migration.
// New code should use the wth_* variants directly.
#[deprecated(note = "use `default_wth_home` instead")]
pub use paths::default_wth_home as default_grok_home;
#[deprecated(note = "use `wth_home` instead")]
pub use paths::wth_home as grok_home;
#[deprecated(note = "use `user_wth_home` instead")]
pub use paths::user_wth_home as user_grok_home;
#[deprecated(note = "use `wth_application` instead")]
pub use paths::wth_application as grok_application;
pub use validation::{
    RequirementsError, RequirementsLayer, RequirementsSource, fail_closed_flag_from_str,
    load_merged_requirements, requirements_layers, validate_requirements,
};
pub use version_overrides::{VersionOverrideError, apply_version_overrides};

/// Parse an env var as a boolean. `None` if unset or unrecognized.
pub fn env_bool(name: &str) -> Option<bool> {
    let value = std::env::var(name).ok()?;
    match value.trim().to_ascii_lowercase().as_str() {
        "" => None,
        "1" | "true" | "yes" | "on" | "enabled" => Some(true),
        "0" | "false" | "no" | "off" | "disabled" => Some(false),
        _ => None,
    }
}
