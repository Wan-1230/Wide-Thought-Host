//! GitHub Device Flow 登录。客户端不持有 OAuth Client Secret。

use crate::{credentials, settings::{persist_state_settings, GitHubProfile}, state::AppState};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::State;

const GITHUB_TOKEN_KIND: &str = "github";
const GITHUB_TOKEN_ID: &str = "default";

#[derive(Clone)]
pub(crate) struct PendingDeviceFlow {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_at: Instant,
}

#[derive(Clone, Serialize)]
pub struct GitHubAuthStatus {
    pub state: String,
    pub user: Option<GitHubProfile>,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
    pub expires_in: Option<u64>,
    pub message: Option<String>,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    #[serde(default = "default_poll_interval")]
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn default_poll_interval() -> u64 {
    5
}

#[derive(Deserialize)]
struct GitHubUserResponse {
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

fn client_id() -> Result<String, String> {
    std::env::var("WTH_GITHUB_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("WTH_GITHUB_CLIENT_ID").map(str::to_owned))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "尚未配置 WTH_GITHUB_CLIENT_ID，GitHub 登录不可用".to_string())
}

fn cached_status(state: &AppState) -> Result<GitHubAuthStatus, String> {
    let user = state.settings.read().map_err(|e| e.to_string())?.github_user.clone();
    let signed_in = credentials::read_secret(GITHUB_TOKEN_KIND, GITHUB_TOKEN_ID)?.is_some();
    Ok(GitHubAuthStatus {
        state: if signed_in { "signed_in" } else { "signed_out" }.into(),
        user,
        user_code: None,
        verification_uri: None,
        expires_in: None,
        message: None,
    })
}

#[tauri::command]
pub async fn github_auth_status(state: State<'_, AppState>) -> Result<GitHubAuthStatus, String> {
    cached_status(&state)
}

#[tauri::command]
pub async fn github_auth_start(state: State<'_, AppState>) -> Result<GitHubAuthStatus, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", "WTH-Desktop")
        .form(&[("client_id", client_id()?), ("scope", "read:user user:email".into())])
        .send()
        .await
        .map_err(|e| format!("请求 GitHub 设备码失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub 拒绝设备码请求：{e}"))?;
    let device: DeviceCodeResponse = response.json().await.map_err(|e| format!("解析设备码失败：{e}"))?;
    let expires_at = Instant::now() + Duration::from_secs(device.expires_in);
    *state.github_auth.lock().map_err(|e| e.to_string())? = Some(PendingDeviceFlow {
        device_code: device.device_code,
        user_code: device.user_code.clone(),
        verification_uri: device.verification_uri.clone(),
        expires_at,
    });
    Ok(GitHubAuthStatus {
        state: "pending".into(),
        user: None,
        user_code: Some(device.user_code),
        verification_uri: Some(device.verification_uri),
        expires_in: Some(device.expires_in),
        message: Some(format!("请在浏览器中完成授权，建议每 {} 秒刷新一次", device.interval)),
    })
}

async fn fetch_profile(token: &str) -> Result<GitHubProfile, String> {
    let client = reqwest::Client::new();
    let user: GitHubUserResponse = client.get("https://api.github.com/user")
        .bearer_auth(token).header("Accept", "application/vnd.github+json").header("User-Agent", "WTH-Desktop")
        .send().await.map_err(|e| format!("读取 GitHub 资料失败：{e}"))?
        .error_for_status().map_err(|e| format!("GitHub 资料请求失败：{e}"))?
        .json().await.map_err(|e| format!("解析 GitHub 资料失败：{e}"))?;
    Ok(GitHubProfile { login: user.login, name: user.name, avatar_url: user.avatar_url })
}

#[tauri::command]
pub async fn github_auth_poll(state: State<'_, AppState>) -> Result<GitHubAuthStatus, String> {
    let pending = state.github_auth.lock().map_err(|e| e.to_string())?.clone().ok_or_else(|| "没有进行中的 GitHub 授权".to_string())?;
    if Instant::now() >= pending.expires_at {
        *state.github_auth.lock().map_err(|e| e.to_string())? = None;
        return Ok(GitHubAuthStatus { state: "expired".into(), user: None, user_code: None, verification_uri: None, expires_in: None, message: Some("设备码已过期，请重新登录".into()) });
    }
    let response: TokenResponse = reqwest::Client::new().post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json").header("User-Agent", "WTH-Desktop")
        .form(&[
            ("client_id", client_id()?),
            ("device_code", pending.device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code".into()),
        ])
        .send().await.map_err(|e| format!("轮询 GitHub 授权失败：{e}"))?
        .json().await.map_err(|e| format!("解析 GitHub 授权结果失败：{e}"))?;
    if let Some(token) = response.access_token {
        let profile = fetch_profile(&token).await?;
        credentials::write_secret(GITHUB_TOKEN_KIND, GITHUB_TOKEN_ID, &token)?;
        {
            let mut settings = state.settings.write().map_err(|e| e.to_string())?;
            settings.github_user = Some(profile.clone());
        }
        persist_state_settings(&state)?;
        *state.github_auth.lock().map_err(|e| e.to_string())? = None;
        return Ok(GitHubAuthStatus { state: "signed_in".into(), user: Some(profile), user_code: None, verification_uri: None, expires_in: None, message: None });
    }
    let error = response.error.unwrap_or_else(|| "authorization_pending".into());
    let state_name = match error.as_str() { "authorization_pending" | "slow_down" => "pending", "access_denied" => "denied", "expired_token" => "expired", _ => "error" };
    Ok(GitHubAuthStatus { state: state_name.into(), user: None, user_code: Some(pending.user_code), verification_uri: Some(pending.verification_uri), expires_in: Some(pending.expires_at.saturating_duration_since(Instant::now()).as_secs()), message: response.error_description.or(Some(error)) })
}

#[tauri::command]
pub async fn github_auth_cancel(state: State<'_, AppState>) -> Result<(), String> {
    *state.github_auth.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub async fn github_auth_logout(state: State<'_, AppState>) -> Result<(), String> {
    credentials::delete_secret(GITHUB_TOKEN_KIND, GITHUB_TOKEN_ID)?;
    { state.settings.write().map_err(|e| e.to_string())?.github_user = None; }
    persist_state_settings(&state)
}
