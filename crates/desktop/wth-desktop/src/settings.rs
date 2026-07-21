//! 桌面设置、模型提供商和工作区管理。

use crate::{credentials, state::AppState};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use tauri::State;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

fn default_language() -> String {
    "zh-CN".into()
}
fn default_close_action() -> String {
    "tray".into()
}
fn default_theme() -> String {
    "light".into()
}
fn default_session_display() -> String {
    "standard".into()
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopSettings {
    pub schema_version: u32,
    pub language: String,
    pub close_action: String,
    pub sound_enabled: bool,
    pub theme: String,
    pub session_display: String,
    pub terminal_shell: Option<String>,
    pub active_workspace: Option<String>,
    pub recent_workspaces: Vec<String>,
    pub default_provider_id: Option<String>,
    pub providers: Vec<ProviderConfig>,
    pub feature_toggles: HashMap<String, bool>,
    pub legacy_migration_complete: bool,
    pub github_user: Option<GitHubProfile>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            language: default_language(),
            close_action: default_close_action(),
            sound_enabled: false,
            theme: default_theme(),
            session_display: default_session_display(),
            terminal_shell: None,
            active_workspace: None,
            recent_workspaces: Vec::new(),
            default_provider_id: None,
            providers: Vec::new(),
            feature_toggles: HashMap::new(),
            legacy_migration_complete: false,
            github_user: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubProfile {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub enabled: bool,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: "openai-compatible".into(),
            base_url: String::new(),
            model: String::new(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderSummary {
    #[serde(flatten)]
    pub config: ProviderConfig,
    pub has_api_key: bool,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct ProviderUpsertInput {
    #[serde(flatten)]
    pub config: ProviderConfig,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub active: bool,
}

pub fn load_settings(path: &Path) -> DesktopSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn validate(settings: &DesktopSettings) -> Result<(), String> {
    if !matches!(settings.language.as_str(), "zh-CN" | "en-US") {
        return Err("不支持的界面语言".into());
    }
    if !matches!(settings.close_action.as_str(), "tray" | "quit") {
        return Err("关闭行为必须是 tray 或 quit".into());
    }
    if !matches!(settings.theme.as_str(), "light" | "dark") {
        return Err("主题必须是 light 或 dark".into());
    }
    if !matches!(settings.session_display.as_str(), "standard" | "compact") {
        return Err("会话展示模式无效".into());
    }
    Ok(())
}

pub fn save_settings(path: &Path, settings: &DesktopSettings) -> Result<(), String> {
    validate(settings)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(settings).map_err(|e| format!("序列化设置失败：{e}"))?;
    std::fs::write(&tmp, json).map_err(|e| format!("写入临时设置失败：{e}"))?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("替换旧设置失败：{e}"))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("提交设置失败：{e}"))
}

pub fn persist_state_settings(state: &AppState) -> Result<(), String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let path = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    save_settings(&path, &settings)
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<DesktopSettings, String> {
    state
        .settings
        .read()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn settings_update(
    mut settings: DesktopSettings,
    state: State<'_, AppState>,
) -> Result<DesktopSettings, String> {
    settings.schema_version = SETTINGS_SCHEMA_VERSION;
    validate(&settings)?;
    {
        let mut guard = state.settings.write().map_err(|e| e.to_string())?;
        *guard = settings.clone();
    }
    persist_state_settings(&state)?;
    Ok(settings)
}

#[tauri::command]
pub async fn provider_list(state: State<'_, AppState>) -> Result<Vec<ProviderSummary>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    Ok(settings
        .providers
        .iter()
        .cloned()
        .map(|config| {
            let has_api_key = credentials::read_secret("provider", &config.id)
                .ok()
                .flatten()
                .is_some();
            let is_default = settings.default_provider_id.as_deref() == Some(config.id.as_str());
            ProviderSummary {
                config,
                has_api_key,
                is_default,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn provider_upsert(
    input: ProviderUpsertInput,
    state: State<'_, AppState>,
) -> Result<ProviderSummary, String> {
    let config = input.config;
    if config.id.trim().is_empty()
        || config.name.trim().is_empty()
        || config.base_url.trim().is_empty()
        || config.model.trim().is_empty()
    {
        return Err("提供商名称、地址和模型不能为空".into());
    }
    url::Url::parse(&config.base_url).map_err(|_| "API 地址不是有效 URL".to_string())?;
    if let Some(key) = input.api_key.as_deref().filter(|v| !v.trim().is_empty()) {
        credentials::write_secret("provider", &config.id, key.trim())?;
    }
    let is_default = {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        if let Some(existing) = settings.providers.iter_mut().find(|p| p.id == config.id) {
            *existing = config.clone();
        } else {
            settings.providers.push(config.clone());
        }
        if settings.default_provider_id.is_none() {
            settings.default_provider_id = Some(config.id.clone());
        }
        settings.default_provider_id.as_deref() == Some(config.id.as_str())
    };
    persist_state_settings(&state)?;
    Ok(ProviderSummary {
        has_api_key: credentials::read_secret("provider", &config.id)?.is_some(),
        config,
        is_default,
    })
}

#[tauri::command]
pub async fn provider_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.providers.retain(|provider| provider.id != id);
        if settings.default_provider_id.as_deref() == Some(id.as_str()) {
            settings.default_provider_id = settings.providers.first().map(|p| p.id.clone());
        }
    }
    credentials::delete_secret("provider", &id)?;
    persist_state_settings(&state)
}

#[tauri::command]
pub async fn provider_set_default(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        if !settings.providers.iter().any(|p| p.id == id && p.enabled) {
            return Err("提供商不存在或已停用".into());
        }
        settings.default_provider_id = Some(id);
    }
    persist_state_settings(&state)
}

#[tauri::command]
pub async fn provider_test(id: String, state: State<'_, AppState>) -> Result<String, String> {
    let provider = {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        settings
            .providers
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "提供商不存在".to_string())?
    };
    let key = credentials::read_secret("provider", &provider.id)?
        .ok_or_else(|| "尚未配置 API Key".to_string())?;
    let endpoint = format!("{}/models", provider.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let request = if provider.kind == "anthropic" {
        client
            .get(endpoint)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
    } else {
        client.get(endpoint).bearer_auth(key)
    };
    let response = request.send().await.map_err(|e| format!("连接失败：{e}"))?;
    if response.status().is_success() {
        Ok(format!("连接成功（HTTP {}）", response.status()))
    } else {
        Err(format!("服务返回 HTTP {}", response.status()))
    }
}

fn workspace_info(path: &Path, active: bool) -> WorkspaceInfo {
    WorkspaceInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("工作区")
            .to_string(),
        exists: path.is_dir(),
        active,
    }
}

#[tauri::command]
pub async fn workspace_get(state: State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    let root = state
        .workspace_root
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    Ok(workspace_info(&root, true))
}

#[tauri::command]
pub async fn workspace_recent(state: State<'_, AppState>) -> Result<Vec<WorkspaceInfo>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    let active = settings.active_workspace.as_deref();
    Ok(settings
        .recent_workspaces
        .iter()
        .map(PathBuf::from)
        .map(|path| {
            let is_active = active == Some(path.to_string_lossy().as_ref());
            workspace_info(&path, is_active)
        })
        .collect())
}

#[tauri::command]
pub async fn workspace_select(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceInfo, String> {
    let canonical = dunce::canonicalize(&path).map_err(|e| format!("工作区不存在：{e}"))?;
    if !canonical.is_dir() {
        return Err("所选路径不是目录".into());
    }
    let value = canonical.to_string_lossy().to_string();
    {
        *state.workspace_root.write().map_err(|e| e.to_string())? = canonical.clone();
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.active_workspace = Some(value.clone());
        settings.recent_workspaces.retain(|item| item != &value);
        settings.recent_workspaces.insert(0, value);
        settings.recent_workspaces.truncate(10);
    }
    persist_state_settings(&state)?;
    Ok(workspace_info(&canonical, true))
}

#[cfg(test)]
mod tests {
    use super::{DesktopSettings, load_settings, save_settings};

    #[test]
    fn settings_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = DesktopSettings::default();
        settings.theme = "dark".into();
        save_settings(&path, &settings).unwrap();
        assert_eq!(load_settings(&path).theme, "dark");
    }
}
