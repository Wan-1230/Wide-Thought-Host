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
mod mcp;
mod auth;
mod headroom;
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 当第二个实例启动时，聚焦已有窗口而不是创建新托盘图标
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
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
                let mut loaded_settings = desktop_settings;

                // 内置默认模型（Agnes AI）的 API Key 由应用自带并写入凭据管理器，
                // 不在设置界面展示该模型，但保留为开箱即用的默认后端。
                let builtin_key = "sk-49YlKg3HCKEPZpu2aI2XlSPhRGZdDYaEIOxXf6a3hfCISRwF";
                if credentials::read_secret("provider", "agnes-default").ok().flatten().is_none() {
                    let _ = credentials::write_secret("provider", "agnes-default", builtin_key);
                    tracing::info!("Built-in Agnes AI provider key seeded into credential store");
                }

                // 首次启动（或旧版本升级）预置默认子智能体；用户删除后不再自动恢复
                let subagents_seeded = loaded_settings
                    .feature_toggles
                    .get("subagents_seeded")
                    .copied()
                    .unwrap_or(false);
                if !subagents_seeded {
                    loaded_settings.subagents = settings::default_subagents();
                    loaded_settings
                        .feature_toggles
                        .insert("subagents_seeded".to_string(), true);
                }

                *state.settings.write().map_err(|e| e.to_string())? = loaded_settings.clone();
                *state.settings_path.write().map_err(|e| e.to_string())? = settings_path.clone();
                *state.workspace_root.write().map_err(|e| e.to_string())? = ws_root;

                // 预置默认子智能体后立即落盘，避免下次启动重复预置
                if !subagents_seeded {
                    let _ = settings::save_settings(&settings_path, &loaded_settings);
                    tracing::info!("Seeded default subagents");
                }
            }

            // Build system tray
            let _tray = tray::build_tray(app.handle())?;

            // Auto-start headroom proxy if enabled in settings
            let state = app.state::<AppState>();
            let headroom = state.headroom.clone();
            let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
            if settings.headroom_enabled {
                let port = settings.headroom_port;
                tauri::async_runtime::spawn(async move {
                    match headroom.start(port).await {
                        Ok(()) => tracing::info!("Headroom proxy started on port {port}"),
                        Err(e) => tracing::warn!("Headroom auto-start failed: {e}"),
                    }
                });
            }

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
            ipc::agent::agent_approve_tool,
            ipc::agent::agent_deny_tool,
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
            settings::set_service_api_key,
            settings::clear_service_api_key,
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
            // MCP CRUD
            ipc::capabilities::mcp_list_servers,
            ipc::capabilities::mcp_add_server,
            ipc::capabilities::mcp_remove_server,
            ipc::capabilities::mcp_test_server,
            // Hooks CRUD
            ipc::capabilities::hook_list,
            ipc::capabilities::hook_add,
            ipc::capabilities::hook_remove,
            ipc::capabilities::hook_toggle,
            // Memory CRUD
            ipc::capabilities::memory_list,
            ipc::capabilities::memory_write,
            ipc::capabilities::memory_delete,
            ipc::capabilities::list_slash_commands,
            ipc::capabilities::resolve_skill,
            // Sub-agents CRUD
            ipc::subagents::subagent_list,
            ipc::subagents::subagent_add,
            ipc::subagents::subagent_remove,
            ipc::subagents::subagent_toggle,
            ipc::subagents::subagent_run,
            // Headroom proxy
            ipc::headroom::headroom_status,
            ipc::headroom::headroom_is_installed,
            ipc::headroom::headroom_start,
            ipc::headroom::headroom_stop,
            ipc::headroom::headroom_install,
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
            // 关闭所有 MCP 服务器连接
            let mcp = state.mcp.clone();
            tauri::async_runtime::block_on(async move {
                let mut guard = mcp.lock().await;
                guard.shutdown_all();
            });
        }
    });
}

fn main() {
    run();
}
