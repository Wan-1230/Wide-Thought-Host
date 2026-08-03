//! System tray builder for WTH desktop.
//!
//! Provides a tray icon with:
//! - Show/Hide window
//! - New session
//! - Check for updates (G6)
//! - Recent sessions (dynamic, top 5, G6)
//! - Quick ask (G6)
//! - Quit
//!
//! Notifications via tauri-plugin-notification.

use crate::{ipc, state::AppState};
use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    menu::{IsMenuItem, MenuBuilder, MenuItem, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const TRAY_ID: &str = "main-tray";

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_tray_menu(app, &[])?;
    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Wide Thought Host");

    // 使用与主窗口、安装包相同的品牌图标，避免 Windows 使用 Tauri 默认图标。
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    let _tray = tray_builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => toggle_main_window(app),
            "new_session" => {
                show_main_window(app);
                let _ = app.emit("menu:new-session", ());
            }
            "quick_ask" => {
                show_main_window(app);
                let _ = app.emit("menu:quick-ask", ());
            }
            "check_update" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    match ipc::capabilities::update_check().await {
                        Ok(info) => {
                            if info.has_update {
                                notify(
                                    &app,
                                    "发现新版本",
                                    &format!("v{} 已发布，可前往 设置 → 关于 下载", info.latest_version),
                                );
                                let _ = app.emit("menu:update-available", info);
                            } else {
                                notify(&app, "已是最新版本", &format!("当前 v{}", info.current_version));
                            }
                        }
                        Err(_) => { /* 网络异常不打扰用户 */ }
                    }
                });
            }
            id if id.starts_with("recent:") => {
                show_main_window(app);
                let session_id = id.trim_start_matches("recent:").to_string();
                let _ = app.emit("menu:open-session", session_id);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 构建托盘菜单：固定项 + 动态最近会话。
fn build_tray_menu<R: Runtime>(app: &AppHandle<R>, recent: &[crate::ipc::session::SessionInfo]) -> tauri::Result<tauri::menu::Menu<R>> {
    let show_item = MenuItemBuilder::with_id("show", "显示 / 隐藏")
        .accelerator("Alt+W")
        .build(app)?;
    let new_session_item = MenuItemBuilder::with_id("new_session", "新建会话")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let quick_ask_item = MenuItemBuilder::with_id("quick_ask", "快速提问…")
        .build(app)?;
    let check_item = MenuItemBuilder::with_id("check_update", "检查更新")
        .build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let mut builder = MenuBuilder::new(app)
        .item(&show_item)
        .item(&new_session_item)
        .separator()
        .item(&quick_ask_item)
        .item(&check_item);

    if !recent.is_empty() {
        let mut items: Vec<MenuItem<R>> = Vec::new();
        for session in recent.iter().take(5) {
            let label = if session.title.trim().is_empty() {
                "未命名会话".to_string()
            } else {
                session.title.clone()
            };
            let item = MenuItemBuilder::with_id(
                format!("recent:{}", session.id),
                &truncate_label(&label, 24),
            )
            .build(app)?;
            items.push(item);
        }
        let item_refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|i| i as &dyn IsMenuItem<R>).collect();
        builder = builder.separator().items(&item_refs);
    }

    builder.separator().item(&quit_item).build()
}

fn truncate_label(label: &str, max: usize) -> String {
    if label.chars().count() <= max {
        label.to_string()
    } else {
        let mut out: String = label.chars().take(max - 1).collect();
        out.push('…');
        out
    }
}

/// 会话列表变化后刷新托盘"最近会话"子菜单。
pub fn refresh_recent_sessions<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    let sessions = state.sessions.lock().map(|s| s.clone()).unwrap_or_default();
    let mut sorted = sessions;
    sorted.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    let recent: Vec<_> = sorted.into_iter().take(5).collect();
    if let Ok(menu) = build_tray_menu(app, &recent) {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// 通过系统通知展示消息。
pub fn notify<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(title.to_string())
        .body(body.to_string())
        .show();
}