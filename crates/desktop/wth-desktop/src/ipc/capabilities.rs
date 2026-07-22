//! 本地扩展能力管理视图。
//!
//! 扫描 `~/.wth` 与当前工作区 `.wth` 目录，给前端返回可浏览、
//! 可启停、可定位的条目列表。

use crate::{settings::DesktopSettings, state::AppState};
use serde::Serialize;
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
