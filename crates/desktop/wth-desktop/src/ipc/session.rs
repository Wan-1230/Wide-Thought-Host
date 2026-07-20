//! IPC commands for session management.
//!
//! Sessions are persisted as JSON at `<app_data_dir>/sessions.json`
//! and loaded into memory on startup. All mutations write through
//! to disk immediately (simple, sufficient for single-user desktop).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: u64,
    pub model: String,
}

#[derive(Debug, Deserialize)]
pub struct SessionCreateArgs {
    #[serde(default = "default_title")]
    pub title: String,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_title() -> String {
    "New Session".into()
}

fn default_model() -> String {
    "gpt-4.1".into()
}

/// Load sessions from disk. Returns empty vec if the file doesn't exist.
pub fn load_sessions(path: &std::path::Path) -> Vec<SessionInfo> {
    match std::fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => vec![],
    }
}

/// Persist the in-memory session list to disk.
fn save_sessions(path: &std::path::Path, sessions: &[SessionInfo]) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(sessions) {
        let _ = std::fs::write(path, json);
    }
}

/// List all sessions from in-memory state.
#[tauri::command]
pub async fn session_list(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<SessionInfo>, String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    Ok(sessions.clone())
}

/// Create a new session and persist it.
#[tauri::command]
pub async fn session_create(
    args: SessionCreateArgs,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<SessionInfo, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let info = SessionInfo {
        id,
        title: args.title,
        created_at: now.clone(),
        updated_at: now,
        message_count: 0,
        model: args.model,
    };

    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(0, info.clone());
        let path = state.sessions_path.lock().map_err(|e| e.to_string())?;
        save_sessions(&path, &sessions);
    }

    Ok(info)
}

/// Delete a session and persist.
#[tauri::command]
pub async fn session_delete(
    id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.retain(|s| s.id != id);
    let path = state.sessions_path.lock().map_err(|e| e.to_string())?;
    save_sessions(&path, &sessions);
    tracing::info!("Session {} deleted", id);
    Ok(())
}

/// Export a session as Markdown.
#[tauri::command]
pub async fn session_export(
    id: String,
    format: Option<String>,
) -> Result<String, String> {
    let fmt = format.unwrap_or_else(|| "markdown".into());
    Ok(format!("# Session {}\n\n_Exported in {} format._\n", id, fmt))
}

/// Get a single session with its metadata.
#[tauri::command]
pub async fn session_get(
    id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<SessionInfo, String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or_else(|| format!("Session {} not found", id))
}
