//! IPC commands for session management.
//!
//! Sessions are persisted via wth-memory (SQLite) for cross-restart history.

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

/// List all sessions.
#[tauri::command]
pub async fn session_list() -> Result<Vec<SessionInfo>, String> {
    // TODO: Query wth-memory SQLite store
    // Placeholder: return empty list
    Ok(vec![])
}

/// Create a new session.
#[tauri::command]
pub async fn session_create(args: SessionCreateArgs) -> Result<SessionInfo, String> {
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

    // TODO: Persist to wth-memory
    Ok(info)
}

/// Delete a session and all its messages.
#[tauri::command]
pub async fn session_delete(id: String) -> Result<(), String> {
    // TODO: Remove from wth-memory
    tracing::info!("Session {} deleted", id);
    Ok(())
}

/// Export a session as Markdown.
#[tauri::command]
pub async fn session_export(id: String, format: Option<String>) -> Result<String, String> {
    let fmt = format.unwrap_or_else(|| "markdown".into());
    // TODO: Export from wth-memory
    Ok(format!("# Session {}\n\n_Exported in {} format._\n", id, fmt))
}

/// Get a single session with its message history.
#[tauri::command]
pub async fn session_get(id: String) -> Result<SessionInfo, String> {
    // TODO: Query wth-memory
    Err(format!("Session {} not found (wth-memory integration pending)", id))
}
