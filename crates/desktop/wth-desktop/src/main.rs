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
        .plugin(tauri_plugin_global_shortcut::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        .setup(|app| {
            // Build system tray
            let _tray = tray::build_tray(app.handle())?;

            // Register global shortcuts
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                app.handle()
                    .plugin(
                        tauri_plugin_global_shortcut::Builder::new().build(),
                    )?;
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
