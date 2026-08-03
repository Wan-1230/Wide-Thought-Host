//! Headroom Tauri IPC 命令 — 前端调用以管理 headroom 代理。
//!
//! 命令：
//! - `headroom_status` — 查询代理状态
//! - `headroom_start` — 启动代理
//! - `headroom_stop` — 停止代理
//! - `headroom_is_installed` — 检查是否安装了 headroom CLI

use crate::headroom::HeadroomStatus;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct HeadroomStatusResponse {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub installed: bool,
    pub proxy_url: Option<String>,
    pub error: Option<String>,
}

fn build_response(
    status: HeadroomStatus,
    installed: bool,
    error: Option<String>,
) -> HeadroomStatusResponse {
    match status {
        HeadroomStatus::Disabled => HeadroomStatusResponse {
            enabled: false,
            running: false,
            port: 0,
            installed,
            proxy_url: None,
            error: None,
        },
        HeadroomStatus::Starting => HeadroomStatusResponse {
            enabled: true,
            running: false,
            port: 0,
            installed,
            proxy_url: None,
            error: None,
        },
        HeadroomStatus::Running { port } => HeadroomStatusResponse {
            enabled: true,
            running: true,
            port,
            installed,
            proxy_url: Some(format!("http://localhost:{}", port)),
            error: None,
        },
        HeadroomStatus::Error(msg) => HeadroomStatusResponse {
            enabled: true,
            running: false,
            port: 0,
            installed,
            proxy_url: None,
            error: Some(msg),
        },
    }
}

#[tauri::command]
pub async fn headroom_status(state: State<'_, AppState>) -> Result<HeadroomStatusResponse, String> {
    let installed = crate::headroom::HeadroomManager::is_installed();
    let status = state.headroom.status();
    Ok(build_response(status, installed, None))
}

#[tauri::command]
pub async fn headroom_is_installed() -> bool {
    crate::headroom::HeadroomManager::is_installed()
}

#[tauri::command]
pub async fn headroom_start(
    port: u16,
    state: State<'_, AppState>,
) -> Result<HeadroomStatusResponse, String> {
    let installed = crate::headroom::HeadroomManager::is_installed();
    if !installed {
        return Ok(HeadroomStatusResponse {
            enabled: false,
            running: false,
            port: 0,
            installed: false,
            proxy_url: None,
            error: Some(
                "Headroom 未安装。请运行: pip install headroom-ai[all]".into(),
            ),
        });
    }

    match state.headroom.start(port).await {
        Ok(()) => {
            let status = state.headroom.status();
            Ok(build_response(status, true, None))
        }
        Err(e) => Ok(HeadroomStatusResponse {
            enabled: true,
            running: false,
            port,
            installed: true,
            proxy_url: None,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub fn headroom_stop(state: State<'_, AppState>) -> HeadroomStatusResponse {
    state.headroom.stop();
    let installed = crate::headroom::HeadroomManager::is_installed();
    build_response(HeadroomStatus::Disabled, installed, None)
}

#[tauri::command]
pub async fn headroom_install() -> Result<String, String> {
    crate::headroom::HeadroomManager::auto_install().await
}

#[cfg(test)]
mod tests {
    use super::build_response;
    use crate::headroom::HeadroomStatus;

    #[test]
    fn build_response_maps_running_status() {
        let resp = build_response(HeadroomStatus::Running { port: 8787 }, true, None);
        assert!(resp.enabled);
        assert!(resp.running);
        assert_eq!(resp.port, 8787);
        assert_eq!(resp.proxy_url.as_deref(), Some("http://localhost:8787"));
        assert!(resp.error.is_none());
    }

    #[test]
    fn build_response_maps_disabled() {
        let resp = build_response(HeadroomStatus::Disabled, false, None);
        assert!(!resp.enabled);
        assert!(!resp.running);
        assert!(!resp.installed);
        assert!(resp.proxy_url.is_none());
    }

    #[test]
    fn build_response_maps_error_status() {
        let resp = build_response(HeadroomStatus::Error("启动失败".into()), true, None);
        assert!(resp.enabled);
        assert!(!resp.running);
        assert_eq!(resp.error.as_deref(), Some("启动失败"));
    }
}