//! 本地扩展能力管理视图。
//!
//! 扫描 `~/.wth` 与当前工作区 `.wth` 目录，给前端返回可浏览、
//! 可启停、可定位的条目列表。

use crate::{settings::DesktopSettings, state::AppState};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
pub struct CapabilitySourceDto {
    pub label: String,
    pub scope: String,
    pub path: String,
    pub exists: bool,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityItemDto {
    pub id: String,
    pub toggle_key: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub scope: String,
    pub kind: String,
    pub enabled: bool,
    pub tags: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityStatsDto {
    pub sources: usize,
    pub items: usize,
    pub enabled: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityViewDto {
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub search_placeholder: String,
    pub sources: Vec<CapabilitySourceDto>,
    pub items: Vec<CapabilityItemDto>,
    pub stats: CapabilityStatsDto,
}

#[tauri::command]
pub async fn capability_view(
    kind: String,
    state: State<'_, AppState>,
) -> Result<CapabilityViewDto, String> {
    let kind = kind.trim().to_ascii_lowercase();
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let workspace_root = state
        .workspace_root
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let user_home = xai_grok_config::wth_home();

    let view = match kind.as_str() {
        "mcp" => build_mcp_view(&settings, &workspace_root, &user_home),
        "skills" => build_skill_view(&settings, &workspace_root, &user_home),
        "plugins" => build_plugin_view(&settings, &workspace_root, &user_home),
        "memory" => build_memory_view(&settings, &workspace_root, &user_home),
        "hooks" => build_hooks_view(&settings, &workspace_root, &user_home),
        other => return Err(format!("未知的扩展能力类型：{other}")),
    };
    Ok(view)
}

fn build_mcp_view(
    settings: &DesktopSettings,
    workspace_root: &Path,
    user_home: &Path,
) -> CapabilityViewDto {
    let sources = vec![
        CapabilitySourceDto {
            label: "用户配置".into(),
            scope: "用户".into(),
            path: user_home.join("config.toml").to_string_lossy().to_string(),
            exists: user_home.join("config.toml").exists(),
            item_count: 0,
        },
        CapabilitySourceDto {
            label: "工作区配置".into(),
            scope: "工作区".into(),
            path: workspace_root
                .join(".wth")
                .join("config.toml")
                .to_string_lossy()
                .to_string(),
            exists: workspace_root.join(".wth").join("config.toml").exists(),
            item_count: 0,
        },
    ];

    let mut items = Vec::new();
    let mut sources = sources;
    for source in &mut sources {
        let path = PathBuf::from(&source.path);
        if !path.exists() {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let value: toml::Value = match toml::from_str(&content) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(servers) = value.get("mcp_servers").and_then(|value| value.as_table()) else {
            continue;
        };

        let mut count = 0usize;
        for (name, entry) in servers {
            count += 1;
            let description = entry
                .as_table()
                .and_then(|table| {
                    table
                        .get("command")
                        .and_then(|value| value.as_str())
                        .map(|value| format!("stdio · {value}"))
                        .or_else(|| {
                            table
                                .get("url")
                                .and_then(|value| value.as_str())
                                .map(|value| format!("HTTP · {value}"))
                        })
                        .or_else(|| {
                            table
                                .get("transport")
                                .and_then(|value| value.as_str())
                                .map(|value| format!("传输 · {value}"))
                        })
                })
                .unwrap_or_else(|| "MCP 服务器配置".into());
            let path_text = path.to_string_lossy().to_string();
            let toggle_key = format!("mcp::{path_text}::{name}");
            let enabled = settings
                .feature_toggles
                .get(&toggle_key)
                .copied()
                .unwrap_or(true);
            items.push(CapabilityItemDto {
                id: format!("{path_text}::{name}"),
                toggle_key,
                name: name.to_string(),
                description,
                path: path_text,
                scope: source.scope.clone(),
                kind: "mcp".into(),
                enabled,
                tags: vec!["配置".into(), source.scope.clone()],
                status: "已配置".into(),
            });
        }
        source.item_count = count;
    }

    build_view(
        "mcp",
        "MCP 与工具",
        "管理本地 MCP 服务器配置、连接状态与来源。",
        "搜索 MCP 服务器…",
        sources,
        items,
    )
}

fn build_skill_view(
    settings: &DesktopSettings,
    workspace_root: &Path,
    user_home: &Path,
) -> CapabilityViewDto {
    build_directory_kind_view(
        "skills",
        "技能",
        "浏览、启用和管理本地技能目录。",
        "搜索技能…",
        settings,
        vec![
            (user_home.join("skills"), "用户"),
            (workspace_root.join(".wth").join("skills"), "工作区"),
        ],
        DirectoryScan::Skill,
    )
}

fn build_plugin_view(
    settings: &DesktopSettings,
    workspace_root: &Path,
    user_home: &Path,
) -> CapabilityViewDto {
    build_directory_kind_view(
        "plugins",
        "插件",
        "浏览、启用和管理本地插件目录。",
        "搜索插件…",
        settings,
        vec![
            (user_home.join("plugins"), "用户"),
            (workspace_root.join(".wth").join("plugins"), "工作区"),
        ],
        DirectoryScan::Plugin,
    )
}

fn build_memory_view(
    settings: &DesktopSettings,
    workspace_root: &Path,
    user_home: &Path,
) -> CapabilityViewDto {
    build_directory_kind_view(
        "memory",
        "记忆",
        "查看和管理全局、工作区与会话记忆文件。",
        "搜索记忆…",
        settings,
        vec![
            (user_home.join("memory"), "用户"),
            (workspace_root.join(".wth").join("memory"), "工作区"),
        ],
        DirectoryScan::Memory,
    )
}

fn build_hooks_view(
    settings: &DesktopSettings,
    workspace_root: &Path,
    user_home: &Path,
) -> CapabilityViewDto {
    build_directory_kind_view(
        "hooks",
        "Hooks",
        "浏览、启用和管理命令 / HTTP 生命周期 Hooks。",
        "搜索 Hooks…",
        settings,
        vec![
            (user_home.join("hooks"), "用户"),
            (workspace_root.join(".wth").join("hooks"), "工作区"),
        ],
        DirectoryScan::Hook,
    )
}

#[derive(Clone, Copy)]
enum DirectoryScan {
    Skill,
    Plugin,
    Memory,
    Hook,
}

fn build_directory_kind_view(
    kind: &str,
    title: &str,
    subtitle: &str,
    search_placeholder: &str,
    settings: &DesktopSettings,
    roots: Vec<(PathBuf, &str)>,
    scan: DirectoryScan,
) -> CapabilityViewDto {
    let mut sources = Vec::new();
    let mut items = Vec::new();

    for (root, scope) in roots {
        let (source, mut source_items) = scan_root(kind, title, &root, scope, settings, scan);
        sources.push(source);
        items.append(&mut source_items);
    }

    build_view(kind, title, subtitle, search_placeholder, sources, items)
}

fn scan_root(
    kind: &str,
    title: &str,
    root: &Path,
    scope: &str,
    settings: &DesktopSettings,
    scan: DirectoryScan,
) -> (CapabilitySourceDto, Vec<CapabilityItemDto>) {
    let mut source = CapabilitySourceDto {
        label: format!("{scope}{title}目录"),
        scope: scope.into(),
        path: root.to_string_lossy().to_string(),
        exists: root.exists(),
        item_count: 0,
    };
    if !root.exists() {
        return (source, Vec::new());
    }

    let items = match scan {
        DirectoryScan::Skill => scan_skill_root(kind, scope, root, settings, &mut source.item_count),
        DirectoryScan::Plugin => scan_plugin_root(kind, scope, root, settings, &mut source.item_count),
        DirectoryScan::Memory => scan_memory_root(kind, scope, root, settings, &mut source.item_count),
        DirectoryScan::Hook => scan_hook_root(kind, scope, root, settings, &mut source.item_count),
    };
    (source, items)
}

fn scan_skill_root(
    kind: &str,
    scope: &str,
    root: &Path,
    settings: &DesktopSettings,
    count: &mut usize,
) -> Vec<CapabilityItemDto> {
    let mut items = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return items;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let marker = path.join("SKILL.md");
        if !marker.exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("skill")
            .to_string();
        let description = markdown_preview(&marker)
            .or_else(|| first_preview_in_directory(&path))
            .unwrap_or_else(|| "本地技能".into());
        push_item(kind, scope, settings, &mut items, &path, name, description, "目录", "可用");
        *count += 1;
    }
    items
}

fn scan_plugin_root(
    kind: &str,
    scope: &str,
    root: &Path,
    settings: &DesktopSettings,
    count: &mut usize,
) -> Vec<CapabilityItemDto> {
    let mut items = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return items;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("plugin")
            .to_string();
        let description = file_preview(&path.join("README.md"))
            .or_else(|| file_preview(&path.join("plugin.json")))
            .or_else(|| first_preview_in_directory(&path))
            .unwrap_or_else(|| "本地插件".into());
        push_item(kind, scope, settings, &mut items, &path, name, description, "目录", "可用");
        *count += 1;
    }
    items
}

fn scan_memory_root(
    kind: &str,
    scope: &str,
    root: &Path,
    settings: &DesktopSettings,
    count: &mut usize,
) -> Vec<CapabilityItemDto> {
    let mut items = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return items;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_file() {
            let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
            if !matches!(extension, "md" | "txt" | "json" | "toml") && path.file_name().and_then(|n| n.to_str()) != Some("MEMORY.md") {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("memory")
                .to_string();
            let description = file_preview(&path).unwrap_or_else(|| "记忆文件".into());
            push_item(kind, scope, settings, &mut items, &path, name, description, "文件", "本地");
            *count += 1;
            continue;
        }

        if !meta.is_dir() {
            continue;
        }
        let marker = path.join("MEMORY.md");
        if !marker.exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("memory")
            .to_string();
        let description = markdown_preview(&marker)
            .or_else(|| first_preview_in_directory(&path))
            .unwrap_or_else(|| "记忆目录".into());
        push_item(kind, scope, settings, &mut items, &path, name, description, "目录", "本地");
        *count += 1;
    }
    items
}

fn scan_hook_root(
    kind: &str,
    scope: &str,
    root: &Path,
    settings: &DesktopSettings,
    count: &mut usize,
) -> Vec<CapabilityItemDto> {
    let mut items = Vec::new();
    for entry in WalkDir::new(root).min_depth(1).max_depth(2).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path().to_path_buf();
        let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
        if !matches!(extension, "json" | "toml" | "sh" | "ps1" | "py") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("hook")
            .to_string();
        let description = file_preview(&path).unwrap_or_else(|| "生命周期 Hooks 配置".into());
        push_item(kind, scope, settings, &mut items, &path, name, description, "文件", "可管理");
        *count += 1;
    }
    items
}

fn push_item(
    kind: &str,
    scope: &str,
    settings: &DesktopSettings,
    items: &mut Vec<CapabilityItemDto>,
    path: &Path,
    name: String,
    description: String,
    tag_kind: &str,
    status: &str,
) {
    let path_text = path.to_string_lossy().to_string();
    let toggle_key = format!("{kind}::{path_text}");
    let enabled = settings
        .feature_toggles
        .get(&toggle_key)
        .copied()
        .unwrap_or(true);
    items.push(CapabilityItemDto {
        id: path_text.clone(),
        toggle_key,
        name,
        description,
        path: path_text,
        scope: scope.into(),
        kind: kind.into(),
        enabled,
        tags: vec![tag_kind.into(), scope.into()],
        status: status.into(),
    });
}

fn build_view(
    kind: &str,
    title: &str,
    subtitle: &str,
    search_placeholder: &str,
    sources: Vec<CapabilitySourceDto>,
    items: Vec<CapabilityItemDto>,
) -> CapabilityViewDto {
    let enabled = items.iter().filter(|item| item.enabled).count();
    CapabilityViewDto {
        kind: kind.into(),
        title: title.into(),
        subtitle: subtitle.into(),
        search_placeholder: search_placeholder.into(),
        stats: CapabilityStatsDto {
            sources: sources.iter().filter(|source| source.exists).count(),
            items: items.len(),
            enabled,
        },
        sources,
        items,
    }
}

fn file_preview(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    text_preview(&raw, path.extension().and_then(|ext| ext.to_str()))
}

fn markdown_preview(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut in_frontmatter = false;
    for line in trimmed.lines() {
        let line = line.trim();
        if line == "---" {
            in_frontmatter = !in_frontmatter;
            continue;
        }
        if in_frontmatter || line.is_empty() || line.starts_with('#') {
            continue;
        }
        return Some(line.chars().take(120).collect());
    }
    None
}

fn first_preview_in_directory(path: &Path) -> Option<String> {
    let mut entries = fs::read_dir(path).ok()?.flatten().collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        if let Some(preview) = file_preview(&entry_path) {
            return Some(preview);
        }
    }
    None
}

fn text_preview(raw: &str, ext: Option<&str>) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if ext == Some("json") {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(text) = value.get("description").and_then(|v| v.as_str()) {
                return Some(text.trim().to_string());
            }
            if let Some(text) = value.get("title").and_then(|v| v.as_str()) {
                return Some(text.trim().to_string());
            }
        }
    }
    if ext == Some("toml") {
        if let Ok(value) = toml::from_str::<toml::Value>(trimmed) {
            if let Some(text) = value.get("description").and_then(|v| v.as_str()) {
                return Some(text.trim().to_string());
            }
            if let Some(text) = value.get("title").and_then(|v| v.as_str()) {
                return Some(text.trim().to_string());
            }
        }
    }

    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() || line == "---" || line.starts_with('#') {
            continue;
        }
        return Some(line.chars().take(120).collect());
    }
    None
}

// ─── MCP Server CRUD ─────────────────────────────────

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(default)]
pub struct McpServerConfigDto {
    pub id: String,
    pub name: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub url: Option<String>,
    pub transport: Option<String>,
    pub enabled: bool,
    pub status: String,
    pub tool_count: usize,
}

impl Default for McpServerConfigDto {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            command: None,
            args: None,
            env: None,
            url: None,
            transport: None,
            enabled: true,
            status: "unknown".into(),
            tool_count: 0,
        }
    }
}

#[tauri::command]
pub async fn mcp_list_servers(state: State<'_, AppState>) -> Result<Vec<McpServerConfigDto>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    let user_home = xai_grok_config::wth_home();

    let mut servers = Vec::new();
    let config_paths = vec![
        user_home.join("config.toml"),
        workspace_root.join(".wth").join("config.toml"),
    ];

    for config_path in config_paths {
        if !config_path.exists() {
            continue;
        }
        let content = match fs::read_to_string(&config_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let value: toml::Value = match toml::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let Some(mcp_servers) = value.get("mcp_servers").and_then(|v| v.as_table()) else {
            continue;
        };
        for (name, entry) in mcp_servers {
            let table = entry.as_table();
            let command = table.and_then(|t| t.get("command")).and_then(|v| v.as_str()).map(String::from);
            let args = table.and_then(|t| t.get("args")).and_then(|v| v.as_array()).map(|arr| {
                arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
            });
            let url = table.and_then(|t| t.get("url")).and_then(|v| v.as_str()).map(String::from);
            let transport = table.and_then(|t| t.get("transport")).and_then(|v| v.as_str()).map(String::from);
            let id = format!("{}::{name}", config_path.to_string_lossy());
            let toggle_key = format!("mcp::{}::{name}", config_path.to_string_lossy());
            let enabled = settings.feature_toggles.get(&toggle_key).copied().unwrap_or(true);

            servers.push(McpServerConfigDto {
                id,
                name: name.clone(),
                command,
                args,
                env: None,
                url,
                transport,
                enabled,
                status: if enabled { "unknown".into() } else { "offline".into() },
                tool_count: 0,
            });
        }
    }
    Ok(servers)
}

#[tauri::command]
pub async fn mcp_add_server(
    config: McpServerConfigDto,
    _state: State<'_, AppState>,
) -> Result<McpServerConfigDto, String> {
    if config.name.trim().is_empty() {
        return Err("服务器名称不能为空".into());
    }
    let user_home = xai_grok_config::wth_home();
    let config_path = user_home.join("config.toml");

    let mut content = fs::read_to_string(&config_path).unwrap_or_default();
    let mut value: toml::Value = toml::from_str(&content).unwrap_or(toml::Value::Table(Default::default()));

    let table = value.as_table_mut().ok_or("配置文件格式无效")?;
    let mcp = table.entry("mcp_servers").or_insert(toml::Value::Table(Default::default()));
    let mcp_table = mcp.as_table_mut().ok_or("mcp_servers 格式无效")?;

    let mut entry = toml::map::Map::new();
    if let Some(cmd) = &config.command {
        entry.insert("command".into(), toml::Value::String(cmd.clone()));
    }
    if let Some(args) = &config.args {
        entry.insert("args".into(), toml::Value::Array(args.iter().map(|a| toml::Value::String(a.clone())).collect()));
    }
    if let Some(url) = &config.url {
        entry.insert("url".into(), toml::Value::String(url.clone()));
    }
    mcp_table.insert(config.name.clone(), toml::Value::Table(entry));

    content = toml::to_string_pretty(&value).map_err(|e| e.to_string())?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    let id = format!("{}::{}", config_path.to_string_lossy(), config.name);
    Ok(McpServerConfigDto { id, status: "unknown".into(), tool_count: 0, ..config })
}

#[tauri::command]
pub async fn mcp_remove_server(id: String, _state: State<'_, AppState>) -> Result<(), String> {
    let parts: Vec<&str> = id.splitn(2, "::").collect();
    if parts.len() != 2 {
        return Err("无效的服务器 ID".into());
    }
    let config_path = PathBuf::from(parts[0]);
    let name = parts[1];

    if !config_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut value: toml::Value = toml::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(mcp) = value.get_mut("mcp_servers").and_then(|v| v.as_table_mut()) {
        mcp.remove(name);
    }
    let new_content = toml::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&config_path, new_content).map_err(|e| e.to_string())
}

/// 真实连通性测试：启动服务器 → 握手 → 拉取工具列表 → 关闭。
#[tauri::command]
pub async fn mcp_test_server(id: String, state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    let entries = crate::mcp::read_mcp_servers(&settings, &workspace_root);
    let entry = entries
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "未找到该服务器配置".to_string())?;
    let client = crate::mcp::McpClient::connect(
        entry.id.clone(),
        entry.name.clone(),
        &entry.command,
        &entry.args,
    )
    .await?;
    let count = client.tools.len();
    let names: Vec<String> = client.tools.iter().take(10).map(|t| t.name.clone()).collect();
    let mut c = client;
    c.kill();
    if count == 0 {
        return Ok("连接成功，但服务器未暴露任何工具".into());
    }
    Ok(format!("连接成功，发现 {count} 个工具：{}", names.join(", ")))
}

// ─── Hook CRUD ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(default)]
pub struct HookConfigDto {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub command: String,
    pub enabled: bool,
}

impl Default for HookConfigDto {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            trigger: "tool_after".into(),
            command: String::new(),
            enabled: true,
        }
    }
}

#[tauri::command]
pub async fn hook_list(state: State<'_, AppState>) -> Result<Vec<HookConfigDto>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let user_home = xai_grok_config::wth_home();
    let hooks_dir = user_home.join("hooks");
    let mut hooks = Vec::new();

    if hooks_dir.exists() {
        for entry in WalkDir::new(&hooks_dir).min_depth(1).max_depth(2).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path().to_path_buf();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "json" | "toml") {
                continue;
            }
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let (name, trigger, command) = if ext == "json" {
                let v: serde_json::Value = match serde_json::from_str(&content) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                (
                    v.get("name").and_then(|n| n.as_str()).unwrap_or("hook").to_string(),
                    v.get("trigger").and_then(|t| t.as_str()).unwrap_or("tool_after").to_string(),
                    v.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string(),
                )
            } else {
                let v: toml::Value = match toml::from_str(&content) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                (
                    v.get("name").and_then(|n| n.as_str()).unwrap_or("hook").to_string(),
                    v.get("trigger").and_then(|t| t.as_str()).unwrap_or("tool_after").to_string(),
                    v.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string(),
                )
            };
            let id = path.to_string_lossy().to_string();
            let toggle_key = format!("hooks::{id}");
            let enabled = settings.feature_toggles.get(&toggle_key).copied().unwrap_or(true);
            hooks.push(HookConfigDto { id, name, trigger, command, enabled });
        }
    }
    Ok(hooks)
}

#[tauri::command]
pub async fn hook_add(config: HookConfigDto, _state: State<'_, AppState>) -> Result<HookConfigDto, String> {
    if config.name.trim().is_empty() || config.command.trim().is_empty() {
        return Err("名称和命令不能为空".into());
    }
    let user_home = xai_grok_config::wth_home();
    let hooks_dir = user_home.join("hooks");
    fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let file_path = hooks_dir.join(format!("{id}.json"));
    let json = serde_json::json!({
        "name": config.name,
        "trigger": config.trigger,
        "command": config.command,
    });
    fs::write(&file_path, serde_json::to_string_pretty(&json).unwrap()).map_err(|e| e.to_string())?;

    Ok(HookConfigDto { id: file_path.to_string_lossy().to_string(), enabled: true, ..config })
}

#[tauri::command]
pub async fn hook_remove(id: String, _state: State<'_, AppState>) -> Result<(), String> {
    let path = PathBuf::from(&id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hook_toggle(id: String, enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let toggle_key = format!("hooks::{id}");
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.feature_toggles.insert(toggle_key, enabled);
    }
    crate::settings::persist_state_settings(&state)
}

// ─── Slash Commands ──────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SlashCommandInfo {
    pub name: String,
    pub description: String,
    pub source: String,  // "builtin" | "skill"
    pub scope: String,   // "用户" | "工作区"
    pub path: Option<String>,
}

const BUILTIN_COMMANDS: &[(&str, &str)] = &[
    ("init", "初始化项目指令（提供 TECH.md / AGENTS.md 模板）"),
    ("compact", "压缩当前会话上下文，释放 token 预算"),
    ("clear", "清空当前会话消息"),
    ("model", "切换默认模型"),
    ("help", "显示可用命令和帮助信息"),
    ("exit", "退出当前代理会话"),
    ("dream", "让 Agent 生成项目愿景 / 创意发想"),
    ("memory", "管理持久记忆（增/删/查）"),
    ("context", "查看 / 调整上下文窗口使用策略"),
    ("plugins", "管理已安装插件"),
    ("feedback", "给当前会话 / 工具输出打分"),
    ("goal", "设置 / 查看当前会话目标"),
];

#[tauri::command]
pub async fn list_slash_commands(
    state: State<'_, AppState>,
) -> Result<Vec<SlashCommandInfo>, String> {
    let mut commands = Vec::new();

    // builtins
    for (name, desc) in BUILTIN_COMMANDS {
        commands.push(SlashCommandInfo {
            name: name.to_string(),
            description: desc.to_string(),
            source: "builtin".into(),
            scope: "—".into(),
            path: None,
        });
    }

    // skills from ~/.wth/skills and workspace/.wth/skills
    let workspace = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    let user_home = xai_grok_config::wth_home();
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let skill_roots = vec![
        (user_home.join("skills"), "用户"),
        (workspace.join(".wth").join("skills"), "工作区"),
    ];

    for (root, scope) in skill_roots {
        let Ok(entries) = fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_dir() { continue; }
            let marker = path.join("SKILL.md");
            if !marker.exists() { continue; }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("skill").to_string();
            let desc = markdown_preview(&marker).unwrap_or_else(|| "用户技能".into());
            commands.push(SlashCommandInfo {
                name,
                description: desc,
                source: "skill".into(),
                scope: scope.to_string(),
                path: Some(path.to_string_lossy().to_string()),
            });
        }
    }

    // 插件技能：~/.wth/plugins/{插件}/skills/{技能}/SKILL.md（插件启用时生效）
    for plugin in enabled_plugin_roots(&settings, &workspace) {
        let skills_dir = plugin.join("skills");
        let Ok(entries) = fs::read_dir(&skills_dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_dir() { continue; }
            let marker = path.join("SKILL.md");
            if !marker.exists() { continue; }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("skill").to_string();
            let desc = markdown_preview(&marker).unwrap_or_else(|| "插件技能".into());
            commands.push(SlashCommandInfo {
                name,
                description: desc,
                source: "skill".into(),
                scope: "插件".into(),
                path: Some(path.to_string_lossy().to_string()),
            });
        }
    }

    Ok(commands)
}

// ─── Workspace RAG (lightweight keyword index) ───────

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceSearchHitDto {
    pub path: String,
    pub line: usize,
    pub snippet: String,
    pub score: usize,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct IndexedFile {
    path: String,
    name: String,
    size: u64,
}

fn workspace_index_cache(workspace: &Path) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    workspace.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();
    xai_grok_config::wth_home()
        .join("index")
        .join(format!("ws-{hash:x}.json"))
}

fn build_workspace_index(workspace: &Path) -> Vec<IndexedFile> {
    const IGNORE: &[&str] = &[
        "node_modules", ".git", "target", "dist", ".next", ".wth",
        ".idea", ".vscode", "vendor", "__pycache__", "bin", "obj",
    ];
    const EXTS: &[&str] = &[
        "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "kt", "c", "cpp", "h", "hpp",
        "md", "txt", "json", "toml", "yaml", "yml", "html", "css", "scss", "vue", "svelte",
        "sql", "sh", "ps1", "xml", "ini",
    ];
    let mut files = Vec::new();
    for entry in WalkDir::new(workspace)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy().to_string();
            !IGNORE.iter().any(|ig| name == *ig)
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !EXTS.contains(&ext.as_str()) {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if size > 1_048_576 {
            continue;
        }
        let rel = path
            .strip_prefix(workspace)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        files.push(IndexedFile {
            path: rel,
            name,
            size,
        });
        if files.len() >= 20_000 {
            break;
        }
    }
    files
}

fn load_workspace_index(workspace: &Path, cache: &Path) -> Vec<IndexedFile> {
    if let Ok(content) = fs::read_to_string(cache) {
        if let Ok(files) = serde_json::from_str::<Vec<IndexedFile>>(&content) {
            if !files.is_empty() {
                return files;
            }
        }
    }
    let files = build_workspace_index(workspace);
    if let Some(parent) = cache.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(cache, serde_json::to_string(&files).unwrap_or_default());
    files
}

/// 工作区轻量检索：文件名与内容关键词匹配，返回 top-k 片段。
#[tauri::command]
pub async fn workspace_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WorkspaceSearchHitDto>, String> {
    let workspace = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    if !workspace.is_dir() {
        return Err("未选择工作区".into());
    }
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(10).min(50);
    let workspace_clone = workspace.clone();
    let hits = tokio::task::spawn_blocking(move || {
        let cache = workspace_index_cache(&workspace_clone);
        let files = load_workspace_index(&workspace_clone, &cache);
        let q = query.to_lowercase();
        let mut hits = Vec::new();
        for file in files {
            let name_score = file.name.to_lowercase().matches(&q).count();
            let full_path = workspace_clone.join(&file.path);
            let Ok(content) = fs::read_to_string(&full_path) else {
                continue;
            };
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&q) {
                    hits.push(WorkspaceSearchHitDto {
                        path: file.path.clone(),
                        line: i + 1,
                        snippet: line.trim().chars().take(200).collect(),
                        score: name_score * 10 + 1,
                    });
                }
            }
            if hits.len() >= limit * 30 {
                break;
            }
        }
        hits.sort_by(|a, b| b.score.cmp(&a.score));
        hits.truncate(limit);
        hits
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(hits)
}

// ─── Update check ────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckDto {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
    pub notes: String,
}

fn version_gt(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split('.')
            .filter_map(|part| {
                let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse::<u64>().ok()
            })
            .collect()
    };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..l.len().max(c.len()) {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv > cv {
            return true;
        }
        if lv < cv {
            return false;
        }
    }
    false
}

/// 手动检查更新：对比 GitHub Releases 最新 tag 与本地版本。
#[tauri::command]
pub async fn update_check() -> Result<UpdateCheckDto, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://api.github.com/repos/Wan-1230/Wide-Thought-Host/releases/latest")
        .header("User-Agent", "WTH-Desktop")
        .send()
        .await
        .map_err(|e| format!("网络请求失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API 返回状态码 {}", resp.status()));
    }
    let value: Value = resp.json().await.map_err(|e| format!("解析响应失败：{e}"))?;
    let latest = value
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let release_url = value
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let notes = value
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(2000)
        .collect();
    let current = env!("CARGO_PKG_VERSION").to_string();
    let has_update = version_gt(&latest, &current);
    Ok(UpdateCheckDto {
        current_version: current,
        latest_version: latest,
        has_update,
        release_url,
        notes,
    })
}

/// 从本地目录导入插件（复制到 ~/.wth/plugins/{名称}）。
#[tauri::command]
pub async fn plugin_import(source_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&source_dir);
    if !src.is_dir() {
        return Err("源目录不存在".into());
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("plugin")
        .to_string();
    let plugins_dir = xai_grok_config::wth_home().join("plugins");
    fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())?;
    let dest = plugins_dir.join(&name);
    if dest.exists() {
        return Err(format!("插件「{name}」已存在，请先删除后再导入"));
    }
    copy_dir_recursive(&src, &dest).map_err(|e| format!("导入失败：{e}"))?;
    Ok(format!("插件「{name}」导入成功"))
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

/// 返回已启用的插件目录（用户 + 工作区），禁用插件不参与能力加载。
pub(crate) fn enabled_plugin_roots(
    settings: &DesktopSettings,
    workspace_root: &Path,
) -> Vec<PathBuf> {
    let user_home = xai_grok_config::wth_home();
    let roots = vec![
        user_home.join("plugins"),
        workspace_root.join(".wth").join("plugins"),
    ];
    let mut out = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let toggle_key = format!("plugins::{}", path.to_string_lossy());
            if settings.feature_toggles.get(&toggle_key).copied().unwrap_or(true) {
                out.push(path);
            }
        }
    }
    out
}

#[tauri::command]
pub async fn resolve_skill(
    name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let workspace = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    let user_home = xai_grok_config::wth_home();

    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let mut candidates = vec![
        user_home.join("skills").join(&name).join("SKILL.md"),
        workspace.join(".wth").join("skills").join(&name).join("SKILL.md"),
    ];
    for plugin in enabled_plugin_roots(&settings, &workspace) {
        candidates.push(plugin.join("skills").join(&name).join("SKILL.md"));
    }

    for path in candidates {
        if path.exists() {
            return fs::read_to_string(&path).map_err(|e| format!("读取技能文件失败：{e}"));
        }
    }
    Err(format!("技能 \"{name}\" 未找到"))
}

// ─── Memory CRUD ─────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct MemoryEntryDto {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub summary: String,
    pub content: String,
    pub scope: String,
    pub path: String,
}

/// 扫描用户与工作区记忆目录，返回全部条目（供列表与注入共用）。
fn scan_memory_entries(workspace_root: &Path) -> Vec<MemoryEntryDto> {
    let user_home = xai_grok_config::wth_home();
    let mut entries = Vec::new();

    let roots = vec![
        (user_home.join("memory"), "用户"),
        (workspace_root.join(".wth").join("memory"), "工作区"),
    ];

    for (root, scope) in roots {
        if !root.exists() {
            continue;
        }
        let Ok(rd) = fs::read_dir(&root) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !meta.is_file() {
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "md" | "txt" | "json" | "toml") {
                continue;
            }
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let title = path.file_stem().and_then(|n| n.to_str()).unwrap_or("memory").to_string();
            let summary: String = content.trim().lines().next().unwrap_or("").chars().take(100).collect();
            let created_at = meta.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| format!("{}", d.as_secs()))
                .unwrap_or_default();
            let id = path.to_string_lossy().to_string();
            entries.push(MemoryEntryDto {
                id: id.clone(),
                title,
                tags: vec![scope.to_string(), ext.to_string()],
                created_at,
                summary,
                content,
                scope: scope.to_string(),
                path: id,
            });
        }
    }
    entries
}

#[tauri::command]
pub async fn memory_list(state: State<'_, AppState>) -> Result<Vec<MemoryEntryDto>, String> {
    let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    Ok(scan_memory_entries(&workspace_root))
}

/// 记忆写入：按 scope 落盘到用户或工作区记忆目录，返回新条目。
#[tauri::command]
pub async fn memory_write(
    state: State<'_, AppState>,
    title: String,
    content: String,
    tags: Option<Vec<String>>,
    scope: Option<String>,
) -> Result<MemoryEntryDto, String> {
    let title = title.trim().to_string();
    let content = content.trim().to_string();
    if title.is_empty() || content.is_empty() {
        return Err("标题和内容不能为空".into());
    }
    let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    let scope_name = scope.unwrap_or_else(|| "user".to_string());
    let root = if scope_name == "workspace" {
        workspace_root.join(".wth").join("memory")
    } else {
        xai_grok_config::wth_home().join("memory")
    };
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let base = slugify(&title);
    let mut path = root.join(format!("{base}.md"));
    let mut n = 1;
    while path.exists() {
        path = root.join(format!("{base}-{n}.md"));
        n += 1;
    }
    let mut text = format!("# {title}\n\n{content}\n");
    if let Some(tags) = &tags {
        if !tags.is_empty() {
            text.push_str(&format!("\n<!-- wth-memory-tags: {} -->\n", tags.join(", ")));
        }
    }
    fs::write(&path, text).map_err(|e| e.to_string())?;

    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let created_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| format!("{}", d.as_secs()))
        .unwrap_or_default();
    Ok(MemoryEntryDto {
        id: path.to_string_lossy().to_string(),
        title,
        tags: tags.unwrap_or_default(),
        created_at,
        summary: content.chars().take(100).collect(),
        content,
        scope: if scope_name == "workspace" { "工作区".into() } else { "用户".into() },
        path: path.to_string_lossy().to_string(),
    })
}

/// 轻量相关性打分：标题/内容与查询词及工作区名的重合次数。
fn memory_relevance(entry: &MemoryEntryDto, query: &str, workspace_name: &str) -> usize {
    let haystacks = [
        entry.title.to_lowercase(),
        entry.content.to_lowercase(),
        entry.path.to_lowercase(),
    ];
    let mut score = 0usize;
    for token in query.to_lowercase().split_whitespace() {
        let token = token.trim_matches(|c: char| !c.is_alphanumeric());
        if token.is_empty() {
            continue;
        }
        for hay in &haystacks {
            if hay.contains(token) {
                score += 1;
            }
        }
    }
    if !workspace_name.is_empty() {
        for hay in &haystacks {
            if hay.contains(workspace_name) {
                score += 1;
            }
        }
    }
    score
}

/// 注入用：按相关性取前 limit 条记忆条目（供 agent 组装请求前调用）。
pub(crate) fn load_relevant_memories(
    workspace_root: &Path,
    query: &str,
    limit: usize,
) -> Vec<MemoryEntryDto> {
    let mut entries = scan_memory_entries(workspace_root);
    let workspace_name = workspace_root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();
    entries.sort_by(|a, b| {
        memory_relevance(b, query, &workspace_name)
            .cmp(&memory_relevance(a, query, &workspace_name))
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
    entries.truncate(limit);
    entries
}

/// 生成安全的文件名 slug（Windows 非法字符替换，去重由调用方处理）。
fn slugify(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('-');
        } else {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "memory".into()
    } else {
        out.chars().take(60).collect()
    }
}

#[tauri::command]
pub async fn memory_delete(id: String, _state: State<'_, AppState>) -> Result<(), String> {
    let path = PathBuf::from(&id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除失败：{e}"))?;
    }
    Ok(())
}

// ─── Diagnostics ─────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticItemDto {
    pub name: String,
    pub status: String,
    pub detail: String,
}

/// 读取 WebView2 运行时版本（注册表 pv 值）。
fn webview2_version() -> String {
    let key = r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    match std::process::Command::new("reg").args(["query", key, "/v", "pv"]).output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            text.lines()
                .find_map(|line| {
                    let line = line.trim();
                    let idx = line.rfind("REG_SZ")?;
                    Some(line[idx + "REG_SZ".len()..].trim().to_string())
                })
                .unwrap_or_else(|| "WebView2 运行时已安装".into())
        }
        _ => "未检测到独立版本（Tauri 依赖 WebView2 运行）".into(),
    }
}

fn git_version() -> String {
    match std::process::Command::new("git").arg("--version").output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        _ => "Git 未安装或不在 PATH 中".into(),
    }
}

/// 凭据存储读写往返测试（写 → 读 → 删）。
fn credentials_roundtrip() -> String {
    let service = "wth-diagnostics";
    let account = "probe";
    match crate::credentials::write_secret(service, account, "ok") {
        Ok(()) => {
            let read = crate::credentials::read_secret(service, account);
            let _ = crate::credentials::delete_secret(service, account);
            match read {
                Ok(Some(value)) if value == "ok" => "OK（写入/读取/删除通过）".into(),
                _ => "读取校验失败".into(),
            }
        }
        Err(e) => format!("写入失败：{e}"),
    }
}

/// 诊断页真实数据：环境、Agent、凭据、最近日志。
#[tauri::command]
pub async fn diagnostics_get(state: State<'_, AppState>) -> Result<Vec<DiagnosticItemDto>, String> {
    let mut items = Vec::new();

    // WebView2
    let wv = webview2_version();
    items.push(DiagnosticItemDto {
        name: "WebView2 运行时".into(),
        status: if wv.starts_with("未检测到") { "warn".into() } else { "ok".into() },
        detail: wv,
    });

    // Git
    let git = git_version();
    items.push(DiagnosticItemDto {
        name: "Git".into(),
        status: if git.contains("git version") { "ok".into() } else { "warn".into() },
        detail: git,
    });

    // Shell
    let shell = {
        let s = state.settings.read().map_err(|e| e.to_string())?;
        s.terminal_shell.clone().unwrap_or_else(|| "powershell.exe（默认）".into())
    };
    items.push(DiagnosticItemDto {
        name: "终端 Shell".into(),
        status: "ok".into(),
        detail: shell,
    });

    // Agent 核心
    let agent_detail = {
        let s = state.settings.read().map_err(|e| e.to_string())?;
        let provider_id = s.default_provider_id.clone().unwrap_or_default();
        let has_provider = s.providers.iter().any(|p| p.id == provider_id && p.enabled);
        let has_key = crate::credentials::read_secret("provider", &provider_id)
            .ok()
            .flatten()
            .is_some();
        if has_provider && has_key {
            "默认模型已配置且凭据有效".to_string()
        } else if has_provider {
            "默认模型已配置，但 API Key 缺失".to_string()
        } else {
            "未配置默认模型".to_string()
        }
    };
    items.push(DiagnosticItemDto {
        name: "Agent 核心".into(),
        status: if agent_detail.starts_with("默认模型已配置且") { "ok".into() } else { "warn".into() },
        detail: agent_detail,
    });

    // 凭据存储
    let cred = credentials_roundtrip();
    items.push(DiagnosticItemDto {
        name: "凭据存储".into(),
        status: if cred.starts_with("OK") { "ok".into() } else { "error".into() },
        detail: cred,
    });

    // 最近日志（脱敏：仅展示时间/级别/消息，不含密钥）
    let logs = state.log_buffer.lock().map_err(|e| e.to_string())?;
    let recent: Vec<String> = logs.iter().rev().take(20).cloned().collect();
    items.push(DiagnosticItemDto {
        name: "最近日志".into(),
        status: "ok".into(),
        detail: if recent.is_empty() {
            "暂无运行日志".into()
        } else {
            recent.join("\n")
        },
    });

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::{MemoryEntryDto, build_workspace_index, memory_relevance, slugify, version_gt};
    use std::path::PathBuf;

    #[test]
    fn version_gt_compares_segments() {
        assert!(version_gt("0.2.0", "0.1.9"));
        assert!(version_gt("1.0.0", "0.9.9"));
        assert!(!version_gt("0.1.0", "0.2.0"));
        assert!(!version_gt("0.1.0", "0.1.0"));
        assert!(!version_gt("0.1.0", "0.1.0-beta"));
        assert!(version_gt("0.10.0", "0.9.0"));
    }

    #[test]
    fn slugify_sanitizes_windows_illegal_chars() {
        assert_eq!(slugify("Hello World"), "Hello-World");
        assert_eq!(slugify("a:b*c?d"), "a-b-c-d");
        assert_eq!(slugify("中文记忆"), "中文记忆");
        assert_eq!(slugify("   "), "memory");
        assert_eq!(slugify("x").len(), 1);
    }

    fn memory(title: &str, content: &str, path: &str) -> MemoryEntryDto {
        MemoryEntryDto {
            id: String::new(),
            title: title.into(),
            tags: vec![],
            created_at: "2026-01-01T00:00:00Z".into(),
            summary: String::new(),
            content: content.into(),
            scope: "用户".into(),
            path: path.into(),
        }
    }

    #[test]
    fn memory_relevance_scores_matching_tokens() {
        let entry = memory("登录超时排查", "用户登录时出现超时问题，需要检查认证服务", "/mem/login.md");
        let high = memory_relevance(&entry, "登录 超时", "demo");
        let low = memory_relevance(&entry, "支付 退款", "demo");
        assert!(high > low);
        assert!(high >= 2);
    }

    #[test]
    fn memory_relevance_boosts_workspace_name() {
        let entry = memory("重构说明", "本工作区 wth 的架构说明", "/mem/wth.md");
        let with_ws = memory_relevance(&entry, "重构", "wth");
        let without_ws = memory_relevance(&entry, "重构", "other");
        assert!(with_ws >= without_ws);
    }

    #[test]
    fn workspace_index_builds_index_of_source_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.path().join("README.md"), "# Demo").unwrap();
        std::fs::write(dir.path().join("ignored.tmp"), "skip").unwrap();
        let files = build_workspace_index(dir.path());
        let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"main.rs"));
        assert!(names.contains(&"README.md"));
        assert!(!names.contains(&"ignored.tmp"));
        assert!(files.iter().all(|f| PathBuf::from(&f.path).is_relative()));
    }
}
/// G3: 返回实时日志缓冲（最近 200 条，按时间升序）。日志已脱敏，不含密钥。
#[tauri::command]
pub async fn log_list(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let logs = state.log_buffer.lock().map_err(|e| e.to_string())?;
    Ok(logs.iter().cloned().collect())
}