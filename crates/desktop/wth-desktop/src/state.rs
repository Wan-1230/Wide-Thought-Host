//! Global application state shared across IPC handlers.
//!
//! Uses `Arc<Mutex<...>>` for interior mutability — Tauri commands
//! access this through `tauri::State<AppState>`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use crate::ipc::session::SessionInfo;

/// Active PTY terminal sessions keyed by ID.
#[derive(Default)]
pub struct TerminalSessions {
    pub sessions: HashMap<String, TerminalHandle>,
}

pub struct TerminalHandle {
    pub id: String,
    pub pid: u32,
    pub writer: Option<Box<dyn std::io::Write + Send>>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

/// Active agent sessions keyed by session ID.
#[derive(Default)]
pub struct AgentSessions {
    pub current: Option<String>,
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
pub struct AppState {
    pub terminals: Arc<Mutex<TerminalSessions>>,
    pub agents: Arc<Mutex<AgentSessions>>,
    /// Loaded from disk at startup; persisted on every mutation.
    pub sessions: Arc<Mutex<Vec<SessionInfo>>>,
    /// Path to sessions.json — set during app setup via `set_sessions_path`.
    pub sessions_path: Arc<Mutex<PathBuf>>,
    pub settings: Arc<RwLock<crate::settings::DesktopSettings>>,
    pub settings_path: Arc<RwLock<PathBuf>>,
    pub workspace_root: Arc<RwLock<PathBuf>>,
    pub github_auth: Arc<Mutex<Option<crate::auth::PendingDeviceFlow>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            terminals: Default::default(),
            agents: Default::default(),
            sessions: Default::default(),
            sessions_path: Arc::new(Mutex::new(PathBuf::new())),
            settings: Arc::new(RwLock::new(crate::settings::DesktopSettings::default())),
            settings_path: Arc::new(RwLock::new(PathBuf::new())),
            workspace_root: Arc::new(RwLock::new(
                dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            )),
            github_auth: Default::default(),
        }
    }
}
