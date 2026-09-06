//! G2: 数据备份 / 恢复 与 配置导入导出。
//!
//! - `backup_create` — 将应用数据（会话、设置、技能等）打包为 .wthbackup（zip）
//! - `backup_restore` — 从备份恢复，恢复前自动备份当前数据
//! - `config_export` — 导出不含密钥的配置 JSON，可跨机器导入
//! - `config_import` — 导入配置 JSON（凭据字段保留占位，需重新输入密钥）

use crate::settings::persist_state_settings;
use crate::state::AppState;
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

const BACKUP_FORMAT: &str = "wth-backup";
const BACKUP_FORMAT_VERSION: u32 = 1;
const EXPORT_FORMAT: &str = "wth-config";
const EXPORT_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize)]
pub struct BackupResultDto {
    pub path: String,
    pub file_count: usize,
    pub bytes: u64,
    pub created_at: String,
}

fn app_data_dir(state: &AppState) -> PathBuf {
    state
        .settings_path
        .read()
        .map(|p| p.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(".")))
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// 收集备份源：appdata 顶层文件 + wth_home 关键目录。
fn collect_backup_sources(app_data: &Path, wth_home: &Path) -> Vec<(String, PathBuf)> {
    let mut sources: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(entries) = fs::read_dir(app_data) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    sources.push((format!("appdata/{name}"), path));
                }
            }
        }
    }
    // 用户扩展目录（技能等）；记忆/hooks/插件目录由各自功能按需创建，
    // 存在才纳入备份，避免把 CLI 侧无关数据卷入。
    for dir in ["skills"] {
        let p = wth_home.join(dir);
        if p.is_dir() {
            collect_dir_files(&p, &format!("wth/{dir}"), &mut sources);
        }
    }
    sources
}

fn collect_dir_files(dir: &Path, prefix: &str, out: &mut Vec<(String, PathBuf)>) {
    for entry in WalkDir::new(dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            let rel = entry
                .path()
                .strip_prefix(dir)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            out.push((format!("{prefix}/{rel}"), entry.path().to_path_buf()));
        }
    }
}

/// 归档当前数据到指定目录（恢复前兜底）。
fn archive_current_data(app_data: &Path, dest_dir: &Path) -> Result<usize, String> {
    fs::create_dir_all(dest_dir).map_err(|e| format!("创建备份目录失败：{e}"))?;
    let mut count = 0usize;
    if let Ok(entries) = fs::read_dir(app_data) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = entry.file_name();
                fs::copy(&path, dest_dir.join(&name)).map_err(|e| format!("备份当前数据失败：{e}"))?;
                count += 1;
            }
        }
    }
    Ok(count)
}

/// 安全展开相对路径：拒绝绝对路径与 .. 越界。
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let normalized = rel.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains("..") {
        return None;
    }
    let dest = root.join(&normalized);
    // 确保目标仍在 root 之内（目录不存在时回退到原始路径比较）
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let parent = dest.parent()?;
    let canonical_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    if canonical_parent.starts_with(&canonical_root) || canonical_parent == canonical_root {
        Some(dest)
    } else {
        None
    }
}

/// 创建 .wthbackup 备份文件。
#[tauri::command]
pub async fn backup_create(
    target_path: String,
    state: State<'_, AppState>,
) -> Result<BackupResultDto, String> {
    let target = PathBuf::from(&target_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let app_data = app_data_dir(&state);
    let wth_home = xai_grok_config::wth_home();
    let sources = collect_backup_sources(&app_data, &wth_home);

    let file = fs::File::create(&target).map_err(|e| format!("创建备份文件失败：{e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let manifest = json!({
        "format": BACKUP_FORMAT,
        "version": BACKUP_FORMAT_VERSION,
        "created_at": chrono::Utc::now().to_rfc3339(),
        "app_version": env!("CARGO_PKG_VERSION"),
        "file_count": sources.len(),
    });
    zip.start_file("manifest.json", options)
        .map_err(|e| format!("写入清单失败：{e}"))?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(|e| format!("写入清单失败：{e}"))?;

    for (rel, path) in &sources {
        let Ok(bytes) = fs::read(path) else { continue };
        zip.start_file(rel.clone(), options)
            .map_err(|e| format!("写入 {rel} 失败：{e}"))?;
        zip.write_all(&bytes).map_err(|e| format!("写入 {rel} 失败：{e}"))?;
    }
    let finished = zip.finish().map_err(|e| format!("完成打包失败：{e}"))?;
    let bytes = finished.metadata().map(|m| m.len()).unwrap_or(0);

    Ok(BackupResultDto {
        path: target.to_string_lossy().to_string(),
        file_count: sources.len() + 1,
        bytes,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// 从 .wthbackup 恢复数据。恢复前自动备份当前数据到 <appdata>/backups/pre-restore-*。
#[tauri::command]
pub async fn backup_restore(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("备份文件不存在".into());
    }
    let file = fs::File::open(&source).map_err(|e| format!("打开备份失败：{e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("备份文件无效：{e}"))?;

    let app_data = app_data_dir(&state);
    let wth_home = xai_grok_config::wth_home();

    // 1. 校验清单
    if let Ok(mut manifest) = zip.by_name("manifest.json") {
        let mut raw = String::new();
        if manifest.read_to_string(&mut raw).is_ok() {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                if value.get("format").and_then(|v| v.as_str()) != Some(BACKUP_FORMAT) {
                    return Err("不是有效的 WTH 备份文件".into());
                }
            }
        }
    }

    // 2. 恢复前自动备份当前数据
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let pre_dir = app_data.join("backups").join(format!("pre-restore-{stamp}"));
    let archived = archive_current_data(&app_data, &pre_dir).map_err(|e| e.to_string())?;
    tracing::info!("恢复前已备份 {archived} 个文件到 {:?}", pre_dir);

    // 3. 解压恢复（manifest.json 跳过；appdata/ 与 wth/ 前缀分别落盘）
    let mut restored = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("读取备份条目失败：{e}"))?;
        let name = entry.name().to_string();
        if name == "manifest.json" {
            continue;
        }
        let dest = if let Some(rel) = name.strip_prefix("appdata/") {
            safe_join(&app_data, rel)
        } else if let Some(rel) = name.strip_prefix("wth/") {
            safe_join(&wth_home, rel)
        } else {
            None
        };
        let Some(dest) = dest else { continue };
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("读取备份内容失败：{e}"))?;
        fs::write(&dest, bytes).map_err(|e| format!("写入 {name} 失败：{e}"))?;
        restored += 1;
    }

    // 4. 重新加载内存中的设置与会话
    let settings_path = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let reloaded = crate::settings::load_settings(&settings_path);
    *state.settings.write().map_err(|e| e.to_string())? = reloaded;

    let sessions_path = state.sessions_path.lock().map_err(|e| e.to_string())?.clone();
    let sessions = crate::ipc::session::load_sessions(&sessions_path);
    *state.sessions.lock().map_err(|e| e.to_string())? = sessions;

    Ok(format!(
        "恢复完成：共恢复 {restored} 个文件。恢复前数据已备份到备份目录，请重启应用使设置完全生效。"
    ))
}

/// 导出配置（不含 API Key，凭据以占位符表示）。
#[tauri::command]
pub async fn config_export(
    target_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let providers: Vec<serde_json::Value> = settings
        .providers
        .iter()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "kind": p.kind,
                "base_url": p.base_url,
                "model": p.model,
                "enabled": p.enabled,
                "builtin": p.builtin,
                "api_key": "***（凭据保存在本机，导入后需重新输入）",
            })
        })
        .collect();
    let export = json!({
        "format": EXPORT_FORMAT,
        "version": EXPORT_FORMAT_VERSION,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "app_version": env!("CARGO_PKG_VERSION"),
        "settings": {
            "language": settings.language,
            "close_action": settings.close_action,
            "theme": settings.theme,
            "font_scale": settings.font_scale,
            "font_family": settings.font_family,
            "custom_font_family": settings.custom_font_family,
            "session_display": settings.session_display,
            "reasoning_effort": settings.reasoning_effort,
            "edit_mode": settings.edit_mode,
            "web_search_engine": settings.web_search_engine,
            "show_system_events": settings.show_system_events,
            "sound_enabled": settings.sound_enabled,
            "headroom_enabled": settings.headroom_enabled,
            "context_compression": settings.context_compression,
            "context_window_tokens": settings.context_window_tokens,
            "price_per_million_tokens": settings.price_per_million_tokens,
        },
        "default_provider_id": settings.default_provider_id,
        "providers": providers,
        "subagents": settings.subagents,
        "shortcuts": settings.shortcuts,
        "prompt_templates": settings.prompt_templates,
    });
    let path = PathBuf::from(&target_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let json = serde_json::to_string_pretty(&export).map_err(|e| format!("序列化失败：{e}"))?;
    fs::write(&path, json).map_err(|e| format!("导出失败：{e}"))?;
    Ok(format!("配置已导出到 {}", path.to_string_lossy()))
}

/// 导入配置 JSON：更新常规设置、子智能体与快捷键；Providers 按 id 合并（保留本地凭据标记）。
#[tauri::command]
pub async fn config_import(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = PathBuf::from(&source_path);
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取配置文件失败：{e}"))?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("配置格式无效：{e}"))?;
    if value.get("format").and_then(|v| v.as_str()) != Some(EXPORT_FORMAT) {
        return Err("不是有效的 WTH 配置导出文件".into());
    }

    let mut settings = state.settings.read().map_err(|e| e.to_string())?.clone();

    // 常规设置
    if let Some(s) = value.get("settings") {
        if let Some(v) = s.get("language").and_then(|v| v.as_str()) { settings.language = v.into(); }
        if let Some(v) = s.get("close_action").and_then(|v| v.as_str()) { settings.close_action = v.into(); }
        if let Some(v) = s.get("theme").and_then(|v| v.as_str()) { settings.theme = v.into(); }
        if let Some(v) = s.get("font_scale").and_then(|v| v.as_str()) { settings.font_scale = v.into(); }
        if let Some(v) = s.get("font_family").and_then(|v| v.as_str()) { settings.font_family = v.into(); }
        if let Some(v) = s.get("custom_font_family").and_then(|v| v.as_str()) { settings.custom_font_family = Some(v.into()); }
        if let Some(v) = s.get("session_display").and_then(|v| v.as_str()) { settings.session_display = v.into(); }
        if let Some(v) = s.get("reasoning_effort").and_then(|v| v.as_str()) { settings.reasoning_effort = v.into(); }
        if let Some(v) = s.get("edit_mode").and_then(|v| v.as_str()) { settings.edit_mode = v.into(); }
        if let Some(v) = s.get("web_search_engine").and_then(|v| v.as_str()) { settings.web_search_engine = v.into(); }
        if let Some(v) = s.get("show_system_events").and_then(|v| v.as_bool()) { settings.show_system_events = v; }
        if let Some(v) = s.get("sound_enabled").and_then(|v| v.as_bool()) { settings.sound_enabled = v; }
        if let Some(v) = s.get("headroom_enabled").and_then(|v| v.as_bool()) { settings.headroom_enabled = v; }
        if let Some(v) = s.get("context_compression").and_then(|v| v.as_bool()) { settings.context_compression = v; }
        if let Some(v) = s.get("context_window_tokens").and_then(|v| v.as_u64()) { settings.context_window_tokens = v as u32; }
        if let Some(v) = s.get("price_per_million_tokens").and_then(|v| v.as_f64()) { settings.price_per_million_tokens = v; }
    }

    // Providers：按 id 合并，保留本地已有凭据，新增的标记"待补凭据"
    if let Some(arr) = value.get("providers").and_then(|v| v.as_array()) {
        for pv in arr {
            let Some(id) = pv.get("id").and_then(|v| v.as_str()) else { continue };
            if settings.providers.iter().any(|p| p.id == id) {
                continue; // 已存在：保留本地配置与凭据
            }
            let name = pv.get("name").and_then(|v| v.as_str()).unwrap_or(id).to_string();
            let kind = pv.get("kind").and_then(|v| v.as_str()).unwrap_or("openai-compatible").to_string();
            let base_url = pv.get("base_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let model = pv.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let enabled = pv.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let builtin = pv.get("builtin").and_then(|v| v.as_bool()).unwrap_or(false);
            settings.providers.push(crate::settings::ProviderConfig {
                id: id.into(),
                name,
                kind,
                base_url,
                model,
                enabled,
                builtin,
                local: pv.get("local").and_then(|v| v.as_bool()).unwrap_or(false),
                price_input: pv.get("price_input").and_then(|v| v.as_f64()),
                price_output: pv.get("price_output").and_then(|v| v.as_f64()),
            });
        }
    }
    if let Some(pid) = value.get("default_provider_id").and_then(|v| v.as_str()) {
        if settings.providers.iter().any(|p| &p.id == pid) {
            settings.default_provider_id = Some(pid.into());
        }
    }
    if let Some(arr) = value.get("subagents").and_then(|v| v.as_array()) {
        if let Ok(agents) = serde_json::from_value::<Vec<crate::settings::SubagentConfig>>(serde_json::Value::Array(arr.clone())) {
            settings.subagents = agents;
        }
    }
    if let Some(obj) = value.get("shortcuts").and_then(|v| v.as_object()) {
        let mut map = std::collections::HashMap::new();
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                map.insert(k.clone(), s.to_string());
            }
        }
        settings.shortcuts = map;
    }
    if let Some(arr) = value.get("prompt_templates").and_then(|v| v.as_array()) {
        if let Ok(templates) = serde_json::from_value::<Vec<crate::settings::PromptTemplate>>(serde_json::Value::Array(arr.clone())) {
            settings.prompt_templates = templates;
        }
    }

    persist_state_settings(&state)?;
    Ok("配置导入成功。已导入的 Provider 若缺少凭据，请在模型与 API 页面重新填写 API Key。".into())
}

/// G10: 导出团队共享配置（子智能体 + 提示词模板 + 快捷键，不含密钥）。
#[tauri::command]
pub async fn team_config_export(
    target_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let export = json!({
        "format": "wth-team-config",
        "version": 1,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "app_version": env!("CARGO_PKG_VERSION"),
        "subagents": settings.subagents,
        "prompt_templates": settings.prompt_templates,
        "shortcuts": settings.shortcuts,
    });
    let path = PathBuf::from(&target_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let json = serde_json::to_string_pretty(&export).map_err(|e| format!("序列化失败：{e}"))?;
    fs::write(&path, json).map_err(|e| format!("导出失败：{e}"))?;
    Ok(format!("团队配置已导出到 {}", path.to_string_lossy()))
}

/// G10: 导入团队共享配置（覆盖子智能体与提示词模板，合并快捷键）。
#[tauri::command]
pub async fn team_config_import(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = PathBuf::from(&source_path);
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取配置文件失败：{e}"))?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("配置格式无效：{e}"))?;
    if value.get("format").and_then(|v| v.as_str()) != Some("wth-team-config") {
        return Err("不是有效的 WTH 团队配置文件".into());
    }
    let mut settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    if let Some(arr) = value.get("subagents").and_then(|v| v.as_array()) {
        if let Ok(agents) = serde_json::from_value::<Vec<crate::settings::SubagentConfig>>(serde_json::Value::Array(arr.clone())) {
            settings.subagents = agents;
        }
    }
    if let Some(arr) = value.get("prompt_templates").and_then(|v| v.as_array()) {
        if let Ok(templates) = serde_json::from_value::<Vec<crate::settings::PromptTemplate>>(serde_json::Value::Array(arr.clone())) {
            settings.prompt_templates = templates;
        }
    }
    if let Some(obj) = value.get("shortcuts").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                settings.shortcuts.insert(k.clone(), s.to_string());
            }
        }
    }
    persist_state_settings(&state)?;
    Ok("团队配置导入成功。子智能体、提示词模板与快捷键已更新。".into())
}

#[cfg(test)]
mod tests {
    use super::{collect_backup_sources, safe_join};
    use std::path::PathBuf;

    #[test]
    fn safe_join_rejects_traversal() {
        let root = PathBuf::from("C:\\appdata");
        assert!(safe_join(&root, "settings.json").is_some());
        assert!(safe_join(&root, "sub/dir.json").is_some());
        assert!(safe_join(&root, "../evil.json").is_none());
        assert!(safe_join(&root, "a/../../evil.json").is_none());
        assert!(safe_join(&root, "/abs/path").is_none());
    }

    #[test]
    fn collect_sources_skips_missing_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("appdata");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join("sessions.json"), "[]").unwrap();
        let wth = dir.path().join("wth");
        std::fs::create_dir_all(wth.join("skills").join("demo")).unwrap();
        std::fs::write(wth.join("skills").join("demo").join("SKILL.md"), "# Demo").unwrap();
        let sources = collect_backup_sources(&app, &wth);
        let names: Vec<&str> = sources.iter().map(|(n, _)| n.as_str()).collect();
        assert!(names.contains(&"appdata/sessions.json"));
        assert!(names.contains(&"wth/skills/demo/SKILL.md"));
    }
}