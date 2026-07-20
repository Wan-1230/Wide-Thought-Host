//! Wide Thought Host — Desktop Application Entry Point
//!
//! Tauri v2 based desktop agent with:
//! - Multi-session chat with LLM backends
//! - File system integration (read/write/edit)
//! - Embedded terminal (PTY)
//! - Monaco code editor with diff review
//! - System tray & global shortcuts

mod ipc;
mod state;
mod tray;

use state::AppState;
use tauri::Manager;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(fmt::layer().with_target(false))
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,wth_desktop=debug")),
        )
        .init();

    let app_state = AppState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        .setup(|app| {
            // Resolve app data directory for session persistence
            let sessions_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("sessions.json");

            // Load persisted sessions and store the path
            {
                let state = app.state::<AppState>();
                let mut sessions = state.sessions.lock().unwrap();
                *sessions = ipc::session::load_sessions(&sessions_path);
                tracing::info!(
                    "Loaded {} sessions from {:?}",
                    sessions.len(),
                    sessions_path
                );
                // Store path for future persists
                let mut path_guard = state.sessions_path.lock().unwrap();
                *path_guard = sessions_path;
            }

            // Initialize workspace root from WTH_HOME or home dir
            let ws_root = std::env::var("WTH_HOME")
                .ok()
                .map(std::path::PathBuf::from)
                .or_else(|| dirs::home_dir())
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            if let Err(e) = std::fs::create_dir_all(&ws_root) {
                tracing::warn!(
                    "Failed to create workspace root {:?}: {}",
                    ws_root,
                    e
                );
            }
            ipc::filesystem::set_workspace_root(&ws_root);

            // Build system tray
            let _tray = tray::build_tray(app.handle())?;

            // Register global shortcut (Alt+W — toggle window visibility)
            // Note: Alt+Space conflicts with WorkBuddy and other desktop apps,
            // so we use Alt+W as a non-colliding alternative.
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyW);
            match app.global_shortcut().register(shortcut) {
                Ok(_) => tracing::info!("Global shortcut Alt+W registered"),
                Err(e) => tracing::warn!("Failed to register Alt+W: {}", e),
            }

            tracing::info!("Wide Thought Host desktop started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::agent::agent_send,
            ipc::agent::agent_abort,
            ipc::filesystem::file_read,
            ipc::filesystem::file_write,
            ipc::filesystem::file_delete,
            ipc::filesystem::file_list,
            ipc::terminal::terminal_spawn,
            ipc::terminal::terminal_write,
            ipc::terminal::terminal_resize,
            ipc::terminal::terminal_kill,
            ipc::session::session_list,
            ipc::session::session_create,
            ipc::session::session_delete,
            ipc::session::session_export,
            ipc::session::session_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WTH desktop");
}

fn main() {
    run();
}
