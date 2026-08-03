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
/// 数据损坏时自动归档为 .bak 并回退空态（崩溃兜底，G3）。
pub fn load_sessions(path: &std::path::Path) -> Vec<SessionInfo> {
    match std::fs::read_to_string(path) {
        Ok(json) => match serde_json::from_str(&json) {
            Ok(sessions) => sessions,
            Err(_) => {
                let bak = path.with_extension("json.bak");
                let _ = std::fs::copy(path, &bak);
                tracing::warn!("sessions.json 解析失败，已归档到 {:?} 并回退空态", bak);
                vec![]
            }
        },
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
    app: tauri::AppHandle,
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

    crate::tray::refresh_recent_sessions(&app);
    Ok(info)
}

/// Delete a session and persist.
#[tauri::command]
pub async fn session_delete(
    id: String,
    state: tauri::State<'_, crate::state::AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.retain(|s| s.id != id);
    sort_sessions(&mut sessions);
    let path = state.sessions_path.lock().map_err(|e| e.to_string())?;
    save_sessions(&path, &sessions);
    crate::tray::refresh_recent_sessions(&app);
    tracing::info!("Session {} deleted", id);
    Ok(())
}

#[tauri::command]
pub async fn session_rename(
    id: String,
    title: String,
    state: tauri::State<'_, crate::state::AppState>,
    app: tauri::AppHandle,
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
    crate::tray::refresh_recent_sessions(&app);
    Ok(updated)
}

#[tauri::command]
pub async fn session_set_pinned(
    id: String,
    pinned: bool,
    state: tauri::State<'_, crate::state::AppState>,
    app: tauri::AppHandle,
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
    crate::tray::refresh_recent_sessions(&app);
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
/// 持久化会话消息内容（前端防抖 2s 调用），并同步 message_count。
/// 消息存储于 `<app_data>/session-messages/{id}.json`，支持异常退出后恢复。
#[tauri::command]
pub async fn session_save_messages(
    id: String,
    messages: Vec<serde_json::Value>,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let app_data = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dir = app_data.join("session-messages");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建消息目录失败：{e}"))?;
    let path = dir.join(format!("{id}.json"));
    let json = serde_json::to_string(&messages).map_err(|e| format!("序列化消息失败：{e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("保存消息失败：{e}"))?;

    // 同步更新会话元数据中的消息数
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(s) = sessions.iter_mut().find(|s| s.id == id) {
        s.message_count = messages.len() as u64;
        let path = state.sessions_path.lock().map_err(|e| e.to_string())?.clone();
        save_sessions(&path, &sessions);
    }
    Ok(())
}

/// 读取会话消息内容（启动/切换会话时恢复）。
#[tauri::command]
pub async fn session_load_messages(
    id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let app_data = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let path = app_data.join("session-messages").join(format!("{id}.json"));
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).map_err(|e| format!("读取消息失败：{e}")),
        Err(_) => Ok(vec![]),
    }
}
/// G4: 跨会话消息全文检索。搜索 `<app_data>/session-messages/*.json`，
/// 返回按命中排序的片段列表（同一会话可多条命中）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct MessageSearchHitDto {
    pub session_id: String,
    pub session_title: String,
    pub message_index: usize,
    pub role: String,
    pub snippet: String,
    pub timestamp: String,
}

#[tauri::command]
pub async fn session_search(
    query: String,
    limit: Option<usize>,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<MessageSearchHitDto>, String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(50).min(200);
    let app_data = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dir = app_data.join("session-messages");
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?.clone();
    let titles: std::collections::HashMap<String, String> = sessions
        .iter()
        .map(|s| (s.id.clone(), s.title.clone()))
        .collect();
    let title_of = move |sid: &str| -> String {
        titles
            .get(sid)
            .cloned()
            .unwrap_or_else(|| "未命名会话".into())
    };

    let dir_clone = dir.clone();
    let hits = tokio::task::spawn_blocking(move || {
        let mut out: Vec<MessageSearchHitDto> = Vec::new();
        let Ok(entries) = std::fs::read_dir(&dir_clone) else {
            return out;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let session_id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if session_id.is_empty() {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(&path) else { continue };
            let Ok(messages) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) else {
                continue;
            };
            for (idx, msg) in messages.iter().enumerate() {
                let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
                let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
                if !content.to_lowercase().contains(&query) {
                    continue;
                }
                let timestamp = msg
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                out.push(MessageSearchHitDto {
                    session_id: session_id.clone(),
                    session_title: title_of(&session_id),
                    message_index: idx,
                    role: role.to_string(),
                    snippet: content.chars().take(160).collect(),
                    timestamp,
                });
                if out.len() >= limit {
                    return out;
                }
            }
        }
        out
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(hits)
}