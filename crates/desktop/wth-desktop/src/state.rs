//! Global application state shared across IPC handlers.
//!
//! Uses `Arc<Mutex<...>>` for interior mutability — Tauri commands
//! access this through `tauri::State<AppState>`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Active PTY terminal sessions keyed by ID.
#[derive(Default)]
pub struct TerminalSessions {
    pub sessions: HashMap<String, TerminalHandle>,
}

pub struct TerminalHandle {
    pub id: String,
    pub pid: u32,
    pub writer: Option<Box<dyn std::io::Write + Send>>,
}

/// Active agent sessions keyed by session ID.
#[derive(Default)]
pub struct AgentSessions {
    pub current: Option<String>,             // current active session
    pub sessions: HashMap<String, AgentHandle>,
}

pub struct AgentHandle {
    pub id: String,
    pub title: String,
    pub running: bool,
    /// Channel to abort a running agent
    pub abort_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

/// Application state injected into all Tauri commands.
#[derive(Default)]
pub struct AppState {
    pub terminals: Arc<Mutex<TerminalSessions>>,
    pub agents: Arc<Mutex<AgentSessions>>,
}
