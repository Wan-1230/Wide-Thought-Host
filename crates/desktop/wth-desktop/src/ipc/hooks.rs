//! Hooks 生命周期事件执行。
//!
//! 扫描 `~/.wth/hooks` 与工作区 `.wth/hooks` 下启用的 hook 配置，
//! 在 Agent 生命周期事件（message_sent / agent_response_done /
//! tool_approved / tool_denied）触发时执行对应命令。
//! 任何失败都只记录日志，绝不阻断主流程。

use crate::settings::DesktopSettings;
use serde_json::Value;
use std::path::Path;
use walkdir::WalkDir;

/// 当前支持的触发点。
pub const TRIGGERS: &[&str] = &[
    "message_sent",
    "agent_response_done",
    "tool_approved",
    "tool_denied",
];

/// 异步执行匹配 trigger 的全部启用 hooks，返回已触发 hook 的名称。
pub async fn run_hooks(
    trigger: &str,
    payload: Value,
    settings: &DesktopSettings,
    workspace_root: &Path,
) -> Vec<String> {
    let user_home = xai_grok_config::wth_home();
    let mut roots = vec![
        user_home.join("hooks"),
        workspace_root.join(".wth").join("hooks"),
    ];
    // 插件 hooks：插件启用时其 hooks/ 目录一并参与触发
    for plugin in crate::ipc::capabilities::enabled_plugin_roots(settings, workspace_root) {
        roots.push(plugin.join("hooks"));
    }
    let mut triggered = Vec::new();

    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(&root).min_depth(1).max_depth(2).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "json" | "toml") {
                continue;
            }
            let Some((name, hook_trigger, command)) = parse_hook_file(path, ext) else {
                continue;
            };
            if hook_trigger != trigger || command.trim().is_empty() {
                continue;
            }
            // 开关：feature_toggles["hooks::{path}"]，默认启用
            let toggle_key = format!("hooks::{}", path.to_string_lossy());
            if !settings.feature_toggles.get(&toggle_key).copied().unwrap_or(true) {
                continue;
            }
            triggered.push(name.clone());
            spawn_hook_command(&name, &command, payload.clone());
        }
    }
    triggered
}

/// 同步触发（fire-and-forget）——供非 async 上下文（如工具审批）调用。
pub fn spawn_hooks(
    trigger: &str,
    payload: Value,
    settings: &DesktopSettings,
    workspace_root: &Path,
) {
    let settings = settings.clone();
    let workspace_root = workspace_root.to_path_buf();
    let trigger = trigger.to_string();
    tokio::spawn(async move {
        run_hooks(&trigger, payload, &settings, &workspace_root).await;
    });
}

fn parse_hook_file(path: &Path, ext: &str) -> Option<(String, String, String)> {
    let content = std::fs::read_to_string(path).ok()?;
    if ext == "json" {
        let v: Value = serde_json::from_str(&content).ok()?;
        Some((
            v.get("name").and_then(|n| n.as_str()).unwrap_or("hook").to_string(),
            v.get("trigger").and_then(|t| t.as_str()).unwrap_or("tool_after").to_string(),
            v.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string(),
        ))
    } else {
        let v: toml::Value = toml::from_str(&content).ok()?;
        Some((
            v.get("name").and_then(|n| n.as_str()).unwrap_or("hook").to_string(),
            v.get("trigger").and_then(|t| t.as_str()).unwrap_or("tool_after").to_string(),
            v.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string(),
        ))
    }
}

/// 执行 hook 命令（10s 超时；stdout/stderr 脱敏记录；失败不影响主流程）。
fn spawn_hook_command(name: &str, command: &str, payload: Value) {
    let name = name.to_string();
    let command = command.to_string();
    let payload_str = payload.to_string();
    tokio::spawn(async move {
        let mut cmd = if cfg!(windows) {
            let mut c = tokio::process::Command::new("cmd");
            c.arg("/C").arg(&command);
            c
        } else {
            let mut c = tokio::process::Command::new("sh");
            c.arg("-c").arg(&command);
            c
        };
        cmd.env("WTH_HOOK_PAYLOAD", &payload_str)
            .env("WTH_HOOK_NAME", &name)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                tracing::warn!("Hook「{name}」启动失败：{e}");
                return;
            }
        };
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            child.wait_with_output(),
        )
        .await
        {
            Ok(Ok(output)) => {
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    tracing::warn!(
                        "Hook「{name}」退出码 {:?}：{stderr}",
                        output.status.code()
                    );
                }
            }
            Ok(Err(e)) => tracing::warn!("Hook「{name}」执行错误：{e}"),
            Err(_) => tracing::warn!("Hook「{name}」执行超时（>10s）"),
        }
    });
}