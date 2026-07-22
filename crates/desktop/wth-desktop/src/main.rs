//! Wide Thought Host — Desktop Application Entry Point
//!
//! Tauri v2 based desktop agent with:
//! - Multi-session chat with LLM backends
//! - File system integration (read/write/edit)
//! - Embedded terminal (PTY)
//! - Monaco code editor with diff review
//! - System tray & global shortcuts

#![windows_subsystem = "windows"]

mod credentials;
mod auth;
mod ipc;
mod settings;
mod state;
mod tray;

use state::AppState;
use tauri::Manager;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

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

    let app = tauri::Builder::default()
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

            // 桌面偏好与 Agent 的 WTH_HOME 分离；工作区可在运行时切换。
            let settings_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("settings.json");
            let desktop_settings = settings::load_settings(&settings_path);
            let ws_root = desktop_settings
                .active_workspace
                .as_deref()
                .and_then(|path| dunce::canonicalize(path).ok())
                .filter(|path| path.is_dir())
                .or_else(|| std::env::current_dir().ok())
                .or_else(dirs::home_dir)
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            {
                let state = app.state::<AppState>();
                *state.settings.write().map_err(|e| e.to_string())? = desktop_settings;
                *state.settings_path.write().map_err(|e| e.to_string())? = settings_path;
                *state.workspace_root.write().map_err(|e| e.to_string())? = ws_root;
            }

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
            ipc::filesystem::open_in_explorer,
            ipc::filesystem::open_path_in_explorer,
            ipc::terminal::terminal_spawn,
            ipc::terminal::terminal_write,
            ipc::terminal::terminal_resize,
            ipc::terminal::terminal_kill,
            ipc::session::session_list,
            ipc::session::session_create,
            ipc::session::session_delete,
            ipc::session::session_rename,
            ipc::session::session_set_pinned,
            ipc::session::session_export,
            ipc::session::session_get,
            settings::settings_get,
            settings::settings_update,
            ipc::capabilities::capability_view,
            settings::provider_list,
            settings::provider_upsert,
            settings::provider_delete,
            settings::provider_set_default,
            settings::provider_test,
            settings::workspace_get,
            settings::workspace_recent,
            settings::workspace_select,
            settings::workspace_clear,
            settings::workspace_git_branch,
            auth::github_auth_status,
            auth::github_auth_start,
            auth::github_auth_poll,
            auth::github_auth_cancel,
            auth::github_auth_logout,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let close_to_tray = state
                    .settings
                    .read()
                    .map(|settings| settings.close_action == "tray")
                    .unwrap_or(false);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building WTH desktop");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            let state = app_handle.state::<AppState>();
            ipc::terminal::kill_all(&state);
        }
    });
}

fn main() {
    run();
}
