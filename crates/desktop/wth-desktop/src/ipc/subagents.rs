//! 子智能体 CRUD 命令。

use crate::{settings::SubagentConfig, state::AppState};
use tauri::State;

#[tauri::command]
pub async fn subagent_list(state: State<'_, AppState>) -> Result<Vec<SubagentConfig>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    Ok(settings.subagents.clone())
}

#[tauri::command]
pub async fn subagent_add(
    mut config: SubagentConfig,
    state: State<'_, AppState>,
) -> Result<SubagentConfig, String> {
    if config.name.trim().is_empty() {
        return Err("子智能体名称不能为空".into());
    }
    if config.id.trim().is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
    }
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        if let Some(existing) = settings.subagents.iter_mut().find(|s| s.id == config.id) {
            *existing = config.clone();
        } else {
            settings.subagents.push(config.clone());
        }
    }
    crate::settings::persist_state_settings(&state)?;
    Ok(config)
}

#[tauri::command]
pub async fn subagent_remove(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.subagents.retain(|s| s.id != id);
    }
    crate::settings::persist_state_settings(&state)
}

#[tauri::command]
pub async fn subagent_toggle(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        let agent = settings
            .subagents
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| "子智能体不存在".to_string())?;
        agent.enabled = enabled;
    }
    crate::settings::persist_state_settings(&state)
}
