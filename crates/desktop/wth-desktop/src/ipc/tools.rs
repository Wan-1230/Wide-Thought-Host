//! Agent 工具执行器：工具定义、执行与权限策略。
//!
//! 工具循环中，模型声明的工具由本模块执行，结果回填到下一轮请求。
//! 所有文件路径操作都被限制在活动工作区内；shell 与 git 写操作按
//! `edit_mode`（plan/review/auto/yolo）决定是否需要用户确认。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// 一次待用户确认的工具调用。
/// 完整信息（工具名、参数）通过 `agent:approval` 事件推送给前端，
/// 这里只保留回传决定的通道。
pub struct ApprovalRequest {
    pub tool_call_id: String,
    /// 前端通过 `agent_approve_tool` / `agent_deny_tool` 回传决定。
    pub tx: tokio::sync::oneshot::Sender<bool>,
}

/// 工具循环最大轮数，防止模型无限调用。
pub const MAX_TOOL_ITERATIONS: usize = 24;

/// shell 命令最长执行时间（秒）。
const SHELL_TIMEOUT_SECS: u64 = 60;
/// 工具结果回传时的单字段最大长度。
const MAX_TOOL_OUTPUT_CHARS: usize = 30_000;

/// git 子命令风险等级。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitRisk {
    ReadOnly,
    Write,
    Dangerous,
}

fn git_risk(args: &[String]) -> GitRisk {
    let Some(cmd) = args.first() else {
        return GitRisk::Dangerous;
    };
    match cmd.as_str() {
        "status" | "diff" | "log" | "show" | "branch" | "remote" | "ls-files" | "rev-parse"
        | "tag" | "blame" | "shortlog" | "stash" | "grep" => GitRisk::ReadOnly,
        "add" | "commit" | "rm" | "mv" => GitRisk::Write,
        _ => GitRisk::Dangerous,
    }
}

/// 构建发送给模型的工具定义列表（JSON Schema）。
pub fn build_tools() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "file_read",
                "description": "读取工作区内文本文件的内容。路径可相对工作区或绝对路径。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "要读取的文件路径" }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "file_write",
                "description": "创建新文件或整体覆盖写入文件内容。谨慎使用：会覆盖目标文件的全部内容，建议优先使用 file_edit 做小范围修改。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "要写入的文件路径" },
                        "content": { "type": "string", "description": "完整的文件内容" }
                    },
                    "required": ["path", "content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "file_edit",
                "description": "精确替换文件中首次出现的文本片段。适合小范围修改，保留其余内容不变。old_string 必须与文件内容完全一致。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "目标文件路径" },
                        "old_string": { "type": "string", "description": "要替换的原文（必须与文件内容完全一致）" },
                        "new_string": { "type": "string", "description": "替换后的新文本" }
                    },
                    "required": ["path", "old_string", "new_string"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "file_list",
                "description": "列出工作区内目录的文件与子目录。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "目录路径，默认工作区根目录" }
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "file_search",
                "description": "在工作区内按文件名关键词搜索文件。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "文件名包含的关键词" }
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "bash",
                "description": "在工作区目录下执行 shell 命令，用于运行测试、构建、查看日志等。危险操作会请求用户确认。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "要执行的 shell 命令" }
                    },
                    "required": ["command"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "git",
                "description": "在工作区执行 git 命令。参数为 git 子命令及其参数，如 [\"status\"]、[\"diff\", \"--stat\"]、[\"log\", \"--oneline\", \"-5\"]。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "args": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "git 子命令与参数列表"
                        }
                    },
                    "required": ["args"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "搜索互联网获取最新信息。用于查找文档、问题解决方案、API 用法等。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "搜索关键词" }
                    },
                    "required": ["query"]
                }
            }
        }),
    ]
}

/// 判断某个工具调用是否需要用户确认。
pub fn needs_approval(tool_name: &str, arguments: &Value, edit_mode: &str) -> bool {
    let read_only = matches!(
        tool_name,
        "file_read" | "file_list" | "file_search" | "web_search"
    );
    if read_only {
        return false;
    }
    if edit_mode == "yolo" {
        return false;
    }
    match tool_name {
        // 低风险写操作：auto 模式自动执行，plan/review 需确认
        "file_write" | "file_edit" => edit_mode != "auto",
        // 高风险操作：除 yolo 外一律确认
        "bash" | "file_delete" => true,
        "git" => {
            let args = git_arg_strings(arguments);
            match git_risk(&args) {
                GitRisk::ReadOnly => false,
                GitRisk::Write => edit_mode != "auto",
                GitRisk::Dangerous => true,
            }
        }
        _ => true,
    }
}

/// 从工具参数中提取 git 参数列表。
fn git_arg_strings(arguments: &Value) -> Vec<String> {
    arguments
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

/// 工具执行输出：`model_result` 回填给模型；`full_before`/`full_after`
/// 为文件修改前后的完整内容（仅用于前端 diff 展示与撤销，不进模型上下文）。
pub struct ToolOutput {
    pub model_result: Value,
    pub full_before: Option<String>,
    pub full_after: Option<String>,
}

impl ToolOutput {
    fn plain(result: Value) -> Self {
        Self {
            model_result: result,
            full_before: None,
            full_after: None,
        }
    }
}

/// 执行工具调用，返回 JSON 结果。
pub async fn execute_tool(
    tool_name: &str,
    arguments: &Value,
    workspace_root: &Path,
    settings: &crate::settings::DesktopSettings,
) -> Result<ToolOutput, String> {
    let root = dunce::canonicalize(workspace_root)
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    match tool_name {
        "file_read" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 path 参数".to_string())?;
            let path = resolve_workspace_path(path, &root)?;
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("读取文件失败: {e}"))?;
            Ok(ToolOutput::plain(json!({
                "path": path.display().to_string(),
                "content": truncate(&content),
                "bytes": content.len()
            })))
        }
        "file_write" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 path 参数".to_string())?;
            let content = arguments
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 content 参数".to_string())?;
            let path = resolve_workspace_write_path(path, &root)?;
            let before = std::fs::read_to_string(&path).ok();
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败: {e}"))?;
            }
            std::fs::write(&path, content)
                .map_err(|e| format!("写入文件失败: {e}"))?;
            Ok(ToolOutput {
                model_result: json!({
                    "path": path.display().to_string(),
                    "status": "written",
                    "bytes": content.len()
                }),
                full_before: before,
                full_after: Some(content.to_string()),
            })
        }
        "file_edit" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 path 参数".to_string())?;
            let old = arguments
                .get("old_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 old_string 参数".to_string())?;
            let new = arguments
                .get("new_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 new_string 参数".to_string())?;
            let path = resolve_workspace_path(path, &root)?;
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("读取文件失败: {e}"))?;
            let Some(pos) = content.find(old) else {
                return Err("未找到要替换的原文（old_string 与文件内容不完全一致）".into());
            };
            let mut updated = content.clone();
            updated.replace_range(pos..pos + old.len(), new);
            std::fs::write(&path, updated.clone())
                .map_err(|e| format!("写入文件失败: {e}"))?;
            Ok(ToolOutput {
                model_result: json!({
                    "path": path.display().to_string(),
                    "status": "edited",
                    "before": truncate(old),
                    "after": truncate(new)
                }),
                full_before: Some(content),
                full_after: Some(updated),
            })
        }
        "file_list" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let path = if path.is_empty() {
                root.clone()
            } else {
                resolve_workspace_path(path, &root)?
            };
            let mut entries: Vec<Value> = Vec::new();
            for entry in std::fs::read_dir(&path)
                .map_err(|e| format!("读取目录失败: {e}"))?
            {
                let entry = entry.map_err(|e| format!("读取目录条目失败: {e}"))?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') && name != ".env" {
                    continue;
                }
                let is_dir = entry
                    .file_type()
                    .map(|t| t.is_dir())
                    .unwrap_or(false);
                entries.push(json!({ "name": name, "is_dir": is_dir }));
            }
            entries.sort_by(|a, b| {
                let a_dir = a["is_dir"].as_bool().unwrap_or(false);
                let b_dir = b["is_dir"].as_bool().unwrap_or(false);
                b_dir
                    .cmp(&a_dir)
                    .then_with(|| {
                        a["name"]
                            .as_str()
                            .unwrap_or("")
                            .to_lowercase()
                            .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
                    })
            });
            Ok(ToolOutput::plain(json!({ "path": path.display().to_string(), "entries": entries })))
        }
        "file_search" => {
            let query = arguments
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 query 参数".to_string())?;
            let q = query.to_lowercase();
            let mut results: Vec<String> = Vec::new();
            for entry in walkdir::WalkDir::new(&root)
                .max_depth(6)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if results.len() >= 50 {
                    break;
                }
                if entry.file_type().is_file() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if name.contains(&q) {
                        results.push(entry.path().display().to_string());
                    }
                }
            }
            Ok(ToolOutput::plain(json!({ "query": query, "results": results })))
        }
        "bash" => {
            let command = arguments
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 command 参数".to_string())?;
            let output = run_shell(command, &root).await?;
            Ok(ToolOutput::plain(json!({
                "command": command,
                "exit_code": output.code,
                "stdout": output.stdout,
                "stderr": output.stderr
            })))
        }
        "git" => {
            let args = git_arg_strings(arguments);
            if args.is_empty() {
                return Err("缺少 git 参数".into());
            }
            let output = run_git(&args, &root).await?;
            Ok(ToolOutput::plain(json!({
                "args": args,
                "exit_code": output.code,
                "stdout": output.stdout,
                "stderr": output.stderr
            })))
        }
        "web_search" => {
            let query = arguments
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 query 参数".to_string())?;
            match settings.web_search_engine.as_str() {
                "tavily" => match crate::credentials::read_secret("service", "tavily") {
                    Ok(Some(key)) => web_search_tavily(query, &key).await,
                    Ok(None) => Ok(ToolOutput::plain(json!({
                        "query": query,
                        "results": [],
                        "note": "已选择 Tavily 但尚未配置 API Key：请在“设置 → 搜索”中填写 Tavily API Key"
                    }))),
                    Err(e) => Ok(ToolOutput::plain(json!({
                        "query": query,
                        "results": [],
                        "note": format!("读取 Tavily 凭据失败：{e}")
                    }))),
                },
                _ => web_search(query).await,
            }
        }
        _ => Err(format!("未知工具: {tool_name}")),
    }
}

/// 解析工作区内的绝对/相对路径（文件必须已存在）。
fn resolve_workspace_path(raw: &str, root: &Path) -> Result<PathBuf, String> {
    let p = PathBuf::from(raw);
    let p = if p.is_absolute() { p } else { root.join(p) };
    let canonical = dunce::canonicalize(&p).map_err(|e| format!("路径不存在: {e}"))?;
    if !canonical.starts_with(root) {
        return Err("拒绝访问：路径位于工作区之外".into());
    }
    Ok(canonical)
}

/// 解析工作区内用于写入的路径（文件可不存在，但父目录必须存在且在工作区内）。
fn resolve_workspace_write_path(raw: &str, root: &Path) -> Result<PathBuf, String> {
    let p = PathBuf::from(raw);
    let p = if p.is_absolute() { p } else { root.join(p) };
    if let Some(parent) = p.parent() {
        let canonical_parent =
            dunce::canonicalize(parent).map_err(|e| format!("父目录不存在: {e}"))?;
        if !canonical_parent.starts_with(root) {
            return Err("拒绝访问：路径位于工作区之外".into());
        }
        Ok(canonical_parent.join(p.file_name().unwrap_or_default()))
    } else {
        Err("无效路径".into())
    }
}

struct ShellOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

async fn run_shell(command: &str, root: &Path) -> Result<ShellOutput, String> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", command]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", command]);
        c
    };
    cmd.current_dir(root);
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(SHELL_TIMEOUT_SECS),
        cmd.output(),
    )
    .await
    .map_err(|_| format!("命令执行超时（>{SHELL_TIMEOUT_SECS}s）"))?
    .map_err(|e| format!("命令执行失败: {e}"))?;
    Ok(ShellOutput {
        code: output.status.code(),
        stdout: truncate(&String::from_utf8_lossy(&output.stdout)),
        stderr: truncate(&String::from_utf8_lossy(&output.stderr)),
    })
}

async fn run_git(args: &[String], root: &Path) -> Result<ShellOutput, String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(SHELL_TIMEOUT_SECS),
        tokio::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output(),
    )
    .await
    .map_err(|_| format!("git 执行超时（>{SHELL_TIMEOUT_SECS}s）"))?
    .map_err(|e| format!("git 执行失败（请确认已安装 Git）: {e}"))?;
    Ok(ShellOutput {
        code: output.status.code(),
        stdout: truncate(&String::from_utf8_lossy(&output.stdout)),
        stderr: truncate(&String::from_utf8_lossy(&output.stderr)),
    })
}

/// Tavily 搜索（需 API Key，配置于“设置 → 搜索”）。
async fn web_search_tavily(query: &str, api_key: &str) -> Result<ToolOutput, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建搜索客户端失败: {e}"))?;
    let resp = client
        .post("https://api.tavily.com/search")
        .json(&json!({
            "api_key": api_key,
            "query": query,
            "max_results": 5,
            "search_depth": "basic",
        }))
        .send()
        .await
        .map_err(|e| format!("Tavily 请求失败: {e}"))?;
    let parsed: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 Tavily 响应失败: {e}"))?;
    let results: Vec<Value> = parsed["results"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .take(5)
        .map(|item| {
            json!({
                "title": item["title"].as_str().unwrap_or(""),
                "url": item["url"].as_str().unwrap_or(""),
                "snippet": item["content"].as_str().unwrap_or(""),
            })
        })
        .collect();
    Ok(ToolOutput::plain(json!({ "query": query, "results": results })))
}

/// 轻量 Web 搜索：DuckDuckGo Lite，无需 API Key。
async fn web_search(query: &str) -> Result<ToolOutput, String> {
    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let url = format!("https://lite.duckduckgo.com/lite/?q={encoded}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建搜索客户端失败: {e}"))?;
    let resp = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WTH-Desktop/0.1")
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {e}"))?;
    let html = resp.text().await.map_err(|e| format!("读取搜索响应失败: {e}"))?;

    // 解析 DuckDuckGo Lite 结果：<a rel="nofollow" href="URL">标题</a>
    let marker = "<a rel=\"nofollow\" href=\"";
    let mut results: Vec<Value> = Vec::new();
    let mut rest = html.as_str();
    while results.len() < 5 {
        let Some(start) = rest.find(marker) else { break };
        let after = &rest[start + marker.len()..];
        let Some(quote_end) = after.find('"') else { break };
        let link = &after[..quote_end];
        let Some(title_start) = after[quote_end..].find('>') else { break };
        let after_title = &after[quote_end + title_start + 1..];
        let Some(title_end) = after_title.find("</a>") else { break };
        let title = strip_html(&after_title[..title_end]);
        if !link.is_empty() && !title.is_empty() {
            results.push(json!({ "title": title, "url": link }));
        }
        rest = &after_title[title_end + 4..];
    }
    if results.is_empty() {
        return Ok(ToolOutput::plain(json!({ "query": query, "results": [], "note": "未获取到搜索结果，可能网络受限或搜索服务不可用" })));
    }
    Ok(ToolOutput::plain(json!({ "query": query, "results": results })))
}

fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// 截断过长文本，防止超大工具输出撑爆上下文。
fn truncate(s: &str) -> String {
    if s.chars().count() <= MAX_TOOL_OUTPUT_CHARS {
        return s.to_string();
    }
    let mut out: String = s.chars().take(MAX_TOOL_OUTPUT_CHARS).collect();
    out.push_str("\n…[输出过长，已截断]");
    out
}