//! IPC commands for session management.
//!
//! Sessions are persisted as JSON at `<app_data_dir>/sessions.json`
//! and loaded into memory on startup. All mutations write through
//! to disk immediately (simple, sufficient for single-user desktop).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: u64,
    pub model: String,
    pub pinned: bool,
}

impl Default for SessionInfo {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            message_count: 0,
            model: String::new(),
            pinned: false,
        }
    }
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
pub(crate) fn save_sessions(path: &std::path::Path, sessions: &[SessionInfo]) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(sessions) {
        let _ = std::fs::write(path, json);
    }
}

fn sort_sessions(sessions: &mut [SessionInfo]) {
    sessions.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
}

/// List all sessions from in-memory state.
#[tauri::command]
pub async fn session_list(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<SessionInfo>, String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let mut sessions = sessions.clone();
    sort_sessions(&mut sessions);
    Ok(sessions)
}

/// Create a new session and persist it.
#[tauri::command]
pub async fn session_create(
    args: SessionCreateArgs,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<SessionInfo, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // 模型名：显式传入则使用；为空时回退到默认 provider 的模型；
    // 未配置任何 provider 时为空字符串（界面显示"默认模型"）。
    let model = if args.model.trim().is_empty() {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        settings
            .default_provider_id
            .as_ref()
            .and_then(|pid| settings.providers.iter().find(|p| &p.id == pid))
            // 内置默认模型在界面显示"默认"，不展示具体模型名
            .filter(|p| !p.builtin)
            .map(|p| p.model.clone())
            .unwrap_or_default()
    } else {
        args.model
    };

    let info = SessionInfo {
        id,
        title: args.title,
        created_at: now.clone(),
        updated_at: now,
        message_count: 0,
        model,
        pinned: false,
    };

    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(0, info.clone());
        sort_sessions(&mut sessions);
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
    sort_sessions(&mut sessions);
    let path = state.sessions_path.lock().map_err(|e| e.to_string())?;
    save_sessions(&path, &sessions);
    tracing::info!("Session {} deleted", id);
    Ok(())
}

#[tauri::command]
pub async fn session_rename(
    id: String,
    title: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<SessionInfo, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Session {} not found", id))?;
    session.title = title.trim().to_string();
    session.updated_at = chrono::Utc::now().to_rfc3339();
    let updated = session.clone();
    sort_sessions(&mut sessions);
    let path = state.sessions_path.lock().map_err(|e| e.to_string())?;
    save_sessions(&path, &sessions);
    Ok(updated)
}

#[tauri::command]
pub async fn session_set_pinned(
    id: String,
    pinned: bool,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<SessionInfo, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Session {} not found", id))?;
    session.pinned = pinned;
    session.updated_at = chrono::Utc::now().to_rfc3339();
    let updated = session.clone();
    sort_sessions(&mut sessions);
    let path = state.sessions_path.lock().map_err(|e| e.to_string())?;
    save_sessions(&path, &sessions);
    Ok(updated)
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

#[cfg(test)]
mod tests {
    use super::{SessionInfo, load_sessions, save_sessions, sort_sessions};

    fn sample(id: &str, updated: &str, pinned: bool) -> SessionInfo {
        SessionInfo {
            id: id.into(),
            title: format!("会话 {id}"),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: updated.into(),
            message_count: 3,
            model: "test-model".into(),
            pinned,
        }
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let sessions = vec![sample("a", "2026-01-02T00:00:00Z", false)];
        save_sessions(&path, &sessions);
        let loaded = load_sessions(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "a");
        assert_eq!(loaded[0].message_count, 3);
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load_sessions(&dir.path().join("nope.json"));
        assert!(loaded.is_empty());
    }

    #[test]
    fn load_corrupt_json_falls_back_to_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        std::fs::write(&path, "[[[broken").unwrap();
        let loaded = load_sessions(&path);
        assert!(loaded.is_empty());
    }

    #[test]
    fn sort_pinned_first_then_updated_desc() {
        let mut sessions = vec![
            sample("old", "2026-01-01T00:00:00Z", false),
            sample("new", "2026-01-03T00:00:00Z", false),
            sample("pin", "2026-01-02T00:00:00Z", true),
        ];
        sort_sessions(&mut sessions);
        assert_eq!(sessions[0].id, "pin");
        assert_eq!(sessions[1].id, "new");
        assert_eq!(sessions[2].id, "old");
    }

    #[test]
    fn special_characters_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let mut s = sample("x", "2026-01-01T00:00:00Z", false);
        s.title = "特殊字符 & < > \" 测试".into();
        save_sessions(&path, &[s.clone()]);
        let loaded = load_sessions(&path);
        assert_eq!(loaded[0].title, s.title);
    }
}