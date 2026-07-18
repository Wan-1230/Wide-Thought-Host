//! IPC commands for embedded terminal (PTY).
//!
//! Spawns a platform-native shell and relays I/O between
//! the frontend's xterm.js and the PTY master.

use crate::state::{AppState, TerminalHandle, TerminalSessions};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub pid: u32,
}

#[derive(Debug, Deserialize)]
pub struct TerminalResizeArgs {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

/// Spawn a new terminal session.
#[tauri::command]
pub async fn terminal_spawn(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<TerminalInfo, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let pid = 0u32; // Placeholder — real PTY integration via portable-pty

    let handle = TerminalHandle {
        id: id.clone(),
        pid,
        writer: None,
    };

    {
        let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        terminals.sessions.insert(id.clone(), handle);
    }

    // Spawn the shell and set up I/O relay
    tokio::spawn({
        let terminals = state.terminals.clone();
        let win = window.clone();
        let tid = id.clone();
        async move {
            // TODO: Integrate portable-pty for real PTY
            // For now, emit a welcome message
            let welcome = format!(
                "\x1b[1;32mWide Thought Host Terminal\x1b[0m\r\n\
                 \x1b[90mSession: {}\x1b[0m\r\n\
                 \x1b[90mPTY integration pending...\x1b[0m\r\n\r\n",
                &tid[..8]
            );
            let _ = win.emit("terminal:data", serde_json::json!({
                "id": tid,
                "data": welcome,
            }));
        }
    });

    Ok(TerminalInfo { id, pid })
}

/// Write input to a terminal session.
#[tauri::command]
pub async fn terminal_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = terminals.sessions.get_mut(&id) {
        if let Some(ref mut writer) = handle.writer {
            use std::io::Write;
            writer.write_all(data.as_bytes())
                .map_err(|e| format!("Terminal write error: {}", e))?;
            writer.flush().map_err(|e| format!("Terminal flush error: {}", e))?;
        }
    }
    Ok(())
}

/// Resize a terminal session.
#[tauri::command]
pub async fn terminal_resize(
    _state: State<'_, AppState>,
    args: TerminalResizeArgs,
) -> Result<(), String> {
    tracing::debug!("Terminal {} resized to {}x{}", args.id, args.cols, args.rows);
    Ok(())
}

/// Kill a terminal session.
#[tauri::command]
pub async fn terminal_kill(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    terminals.sessions.remove(&id);
    Ok(())
}
