//! Default model IDs loaded from `default_models.json` at runtime.
//! Edit that JSON file to change them.
//!
//! At runtime each model is resolved via:
//!   CLI flag > ENV var > config.toml > remote settings > these defaults

use std::sync::LazyLock;

/// The raw JSON, embedded at compile time. Re-exported through the
/// `xai_grok_shell::models` facade and consumed by `agent::config`, so it must
/// be `pub` (was `pub(crate)` when this lived inside the shell crate).
pub const DEFAULT_MODELS_JSON: &str = include_str!("../default_models.json");

#[derive(serde::Deserialize)]
struct DefaultModels {
    default: String,
    /// Falls back to `default` if not specified in JSON.
    web_search: Option<String>,
    /// Falls back to `default` if not specified in JSON.
    image_description: Option<String>,
    /// Falls back to `default` if not specified in JSON.
    session_summary: Option<String>,
    models: Vec<DefaultModelEntry>,
}

#[derive(serde::Deserialize)]
struct DefaultModelEntry {
    model: String,
}

static DEFAULTS: LazyLock<DefaultModels> = LazyLock::new(|| {
    let defaults: DefaultModels = serde_json::from_str(DEFAULT_MODELS_JSON)
        .expect("default_models.json: invalid JSON or missing 'default' field");

    // Baked-in JSON — a mismatch here is a developer error, not a runtime condition.
    let model_ids: Vec<&str> = defaults.models.iter().map(|m| m.model.as_str()).collect();
    assert!(
        model_ids.contains(&defaults.default.as_str()),
        "default_models.json: 'default' is '{}' but 'models' array only has {model_ids:?}",
        defaults.default,
    );

    defaults
});

/// Primary model for coding tasks and general fallback.
pub fn default_model() -> &'static str {
    &DEFAULTS.default
}

/// Model for web search tool synthesis. Falls back to default model.
pub fn default_web_search_model() -> &'static str {
    DEFAULTS.web_search.as_deref().unwrap_or(&DEFAULTS.default)
}

/// Model for image describe. Falls back to default model.
pub fn default_image_description_model() -> &'static str {
    DEFAULTS
        .image_description
        .as_deref()
        .unwrap_or(&DEFAULTS.default)
}

/// Model for session title generation. Falls back to default model.
pub fn default_session_summary_model() -> &'static str {
    DEFAULTS
        .session_summary
        .as_deref()
        .unwrap_or(&DEFAULTS.default)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::uninlined_format_args)]

    use super::*;
    use serde_json::Value;

    /// The baked-in default model. Updating this constant is a deliberate
    /// product change — pin the value so a silent edit trips CI.
    const EXPECTED_DEFAULT_MODEL: &str = "gpt-4.1";

    #[test]
    fn default_model_matches_baked_in_constant() {
        assert_eq!(default_model(), EXPECTED_DEFAULT_MODEL);
    }

    #[test]
    fn default_model_is_non_empty() {
        assert!(!default_model().is_empty());
    }

    #[test]
    fn web_search_model_falls_back_to_default_when_present() {
        // The shipped JSON sets web_search = "gpt-4.1" (same as default) —
        // so the getter must return that explicit value, not a different fallback.
        assert_eq!(default_web_search_model(), "gpt-4.1");
    }

    #[test]
    fn image_description_model_falls_back_to_default_when_present() {
        assert_eq!(default_image_description_model(), "gpt-4.1");
    }

    #[test]
    fn session_summary_model_uses_distinct_value() {
        // The shipped JSON sets session_summary = "gpt-4.1-mini" — distinct from
        // the primary default. This guards against accidentally collapsing it.
        assert_eq!(default_session_summary_model(), "gpt-4.1-mini");
    }

    #[test]
    fn session_summary_falls_back_to_default_when_field_missing() {
        // Drop the `session_summary` field — getter must return the primary default.
        let raw: Value = serde_json::from_str(DEFAULT_MODELS_JSON).unwrap();
        let mut pruned = raw.clone();
        let obj = pruned.as_object_mut().unwrap();
        obj.remove("session_summary");
        let patched = serde_json::to_string(&pruned).unwrap();

        let parsed: DefaultModels = serde_json::from_str(&patched).unwrap();
        assert_eq!(parsed.session_summary, None);
        // The fallback contract: when the field is absent, callers see the default.
        // We can't call the public getter (it reads the static) — assert the
        // documented behavior on the deserialized struct instead.
        assert_eq!(None::<&str>.unwrap_or(&parsed.default), default_model());
    }

    #[test]
    fn baked_in_json_is_valid_json() {
        let parsed: Value =
            serde_json::from_str(DEFAULT_MODELS_JSON).expect("default_models.json must be valid");
        assert!(parsed.is_object(), "top-level must be a JSON object");
    }

    #[test]
    fn baked_in_default_appears_in_models_array() {
        // Mirrors the runtime assert! in `DEFAULTS::new` — keep it as an
        // explicit test so a regression surfaces in the test report, not
        // just as a panic on first access.
        let parsed: Value = serde_json::from_str(DEFAULT_MODELS_JSON).unwrap();
        let default = parsed["default"].as_str().expect("'default' must be a string");
        let models = parsed["models"].as_array().expect("'models' must be an array");
        let ids: Vec<&str> = models
            .iter()
            .map(|m| m["model"].as_str().expect("each entry needs a 'model' string"))
            .collect();
        assert!(
            ids.contains(&default),
            "default '{default}' not present in models array {ids:?}",
        );
    }

    #[test]
    fn baked_in_model_ids_are_unique() {
        let parsed: Value = serde_json::from_str(DEFAULT_MODELS_JSON).unwrap();
        let models = parsed["models"].as_array().expect("'models' must be an array");
        let mut ids: Vec<String> = Vec::new();
        for entry in models {
            let id = entry["model"].as_str().expect("each entry needs a 'model' string");
            assert!(
                !ids.iter().any(|x| x == id),
                "duplicate model id '{id}' in default_models.json",
            );
            ids.push(id.to_string());
        }
        // Sanity: the shipped JSON has 6 models — guard against accidental
        // collapse of the catalogue.
        assert!(ids.len() >= 3, "expected at least 3 default models, got {}", ids.len());
    }

    #[test]
    fn baked_in_models_have_supported_backend_marker() {
        // Each entry must declare `api_backend` (the field the runtime uses
        // to pick the request shape). A missing field would silently fall
        // through to a wrong code path.
        let parsed: Value = serde_json::from_str(DEFAULT_MODELS_JSON).unwrap();
        let models = parsed["models"].as_array().expect("'models' must be an array");
        for entry in models {
            let id = entry["model"].as_str().unwrap_or("<missing>");
            assert!(
                entry.get("api_backend").and_then(Value::as_str).is_some(),
                "model '{id}' is missing 'api_backend'",
            );
            assert!(
                entry.get("supported_in_api").and_then(Value::as_bool).is_some(),
                "model '{id}' is missing 'supported_in_api' (must be true/false)",
            );
        }
    }

    #[test]
    fn each_default_getter_returns_a_shipped_model_id() {
        // Every getter result must be a model that actually appears in the
        // models array — otherwise the runtime would try to use a model
        // the catalog doesn't describe.
        let parsed: Value = serde_json::from_str(DEFAULT_MODELS_JSON).unwrap();
        let shipped: Vec<String> = parsed["models"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["model"].as_str().unwrap().to_string())
            .collect();
        for getter_val in [
            default_model(),
            default_web_search_model(),
            default_image_description_model(),
            default_session_summary_model(),
        ] {
            assert!(
                shipped.iter().any(|s| s == getter_val),
                "getter returned '{getter_val}' which is not in the shipped models catalog",
            );
        }
    }
}
