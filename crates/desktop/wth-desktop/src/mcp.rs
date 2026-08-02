//! 轻量 MCP（Model Context Protocol）stdio 客户端。
//!
//! 把用户配置的 MCP 服务器工具接入 Agent 工具循环：
//! 启动服务器 → initialize 握手 → tools/list → 工具并入请求；
//! 模型调用时通过 tools/call 执行并回传结果。
//! 服务器启动失败或超时会自动降级（跳过该服务器，不影响主流程）。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdout;
use tokio::sync::Mutex;

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const HANDSHAKE_TIMEOUT_SECS: u64 = 10;
const CALL_TIMEOUT_SECS: u64 = 60;

/// 一个 stdio MCP 服务器连接。
pub struct McpClient {
    pub server_id: String,
    pub display_name: String,
    pub tools: Vec<McpTool>,
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>>,
    next_id: AtomicU64,
}

#[derive(Debug, Clone)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// 配置文件中的 MCP 服务器条目。
pub struct McpServerEntry {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub enabled: bool,
}

/// 读取用户与工作区配置中的 MCP 服务器列表。
pub fn read_mcp_servers(
    settings: &crate::settings::DesktopSettings,
    workspace_root: &Path,
) -> Vec<McpServerEntry> {
    let mut entries = Vec::new();
    let user_home = xai_grok_config::wth_home();
    let config_paths = vec![
        user_home.join("config.toml"),
        workspace_root.join(".wth").join("config.toml"),
    ];
    for config_path in config_paths {
        if !config_path.exists() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&config_path) else {
            continue;
        };
        let Ok(value) = content.parse::<toml::Value>() else {
            continue;
        };
        let Some(mcp_servers) = value.get("mcp_servers").and_then(|v| v.as_table()) else {
            continue;
        };
        for (name, entry) in mcp_servers {
            let Some(table) = entry.as_table() else { continue };
            let Some(command) = table.get("command").and_then(|v| v.as_str()) else {
                // 仅支持 stdio（command），HTTP 服务器暂不接入
                continue;
            };
            let args: Vec<String> = table
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let id = format!("{}::{name}", config_path.to_string_lossy());
            let toggle_key = format!("mcp::{}::{name}", config_path.to_string_lossy());
            let enabled = settings
                .feature_toggles
                .get(&toggle_key)
                .copied()
                .unwrap_or(true);
            entries.push(McpServerEntry {
                id,
                name: name.clone(),
                command: command.to_string(),
                args,
                enabled,
            });
        }
    }
    entries
}

impl McpClient {
    /// 启动子进程并完成 initialize + tools/list 握手。
    pub async fn connect(
        server_id: String,
        display_name: String,
        command: &str,
        args: &[String],
    ) -> Result<Self, String> {
        let mut child = tokio::process::Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("启动 MCP 服务器失败: {e}"))?;
        let stdin = child.stdin.take().ok_or("无法获取 MCP 服务器 stdin")?;
        let stdout = child.stdout.take().ok_or("无法获取 MCP 服务器 stdout")?;

        let mut client = Self {
            server_id,
            display_name,
            tools: Vec::new(),
            child,
            stdin,
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        };

        // 后台读循环：把响应分发到对应请求
        let pending = client.pending.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_message(&mut reader).await {
                    Ok(msg) => {
                        if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                            let mut map = pending.lock().await;
                            if let Some(tx) = map.remove(&id) {
                                let _ = tx.send(msg);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // 握手：initialize
        let init_id = client.next_id.fetch_add(1, Ordering::Relaxed);
        let _ = client
            .request(json!({
                "jsonrpc": "2.0",
                "id": init_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "wth-desktop", "version": "0.1.0" }
                }
            }))
            .await?;

        // initialized 通知
        let _ = client
            .request(json!({
                "jsonrpc": "2.0",
                "id": client.next_id.fetch_add(1, Ordering::Relaxed),
                "method": "notifications/initialized",
                "params": {}
            }))
            .await;

        // tools/list
        let list_id = client.next_id.fetch_add(1, Ordering::Relaxed);
        let resp = client
            .request(json!({
                "jsonrpc": "2.0",
                "id": list_id,
                "method": "tools/list",
                "params": {}
            }))
            .await?;
        if let Some(tools) = resp
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(|t| t.as_array())
        {
            for tool in tools {
                client.tools.push(McpTool {
                    name: tool["name"].as_str().unwrap_or("").to_string(),
                    description: tool["description"].as_str().unwrap_or("").to_string(),
                    input_schema: tool
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or(json!({"type":"object","properties":{}})),
                });
            }
        }
        Ok(client)
    }

    async fn request(&mut self, msg: Value) -> Result<Value, String> {
        let id = msg["id"].as_u64().unwrap_or_else(|| {
            self.next_id.fetch_add(1, Ordering::Relaxed)
        });
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }
        let mut payload = msg;
        payload["id"] = json!(id);
        write_message(&mut self.stdin, &payload).await?;
        tokio::time::timeout(
            std::time::Duration::from_secs(HANDSHAKE_TIMEOUT_SECS),
            rx,
        )
        .await
        .map_err(|_| format!("MCP 服务器响应超时（{}）", self.display_name))?
        .map_err(|_| format!("MCP 服务器连接已断开（{}）", self.display_name))
    }

    /// 调用 MCP 工具，返回文本内容。
    pub async fn call_tool(&mut self, tool: &str, arguments: &Value) -> Result<Value, String> {
        let call_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let resp = self
            .request(json!({
                "jsonrpc": "2.0",
                "id": call_id,
                "method": "tools/call",
                "params": { "name": tool, "arguments": arguments }
            }))
            .await?;
        if let Some(err) = resp.get("error") {
            return Err(format!("MCP 工具错误: {err}"));
        }
        let content = resp
            .get("result")
            .and_then(|r| r.get("content"))
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        let mut texts: Vec<String> = Vec::new();
        for item in content {
            match item["type"].as_str() {
                Some("text") => texts.push(item["text"].as_str().unwrap_or("").to_string()),
                Some("image") => texts.push("[图片结果]".to_string()),
                Some("resource") => texts.push("[资源结果]".to_string()),
                _ => {}
            }
        }
        Ok(json!({ "content": texts.join("\n") }))
    }

    pub fn is_alive(&mut self) -> bool {
        self.child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }
}

/// MCP 客户端管理器：维护所有已启动的服务器连接。
#[derive(Default)]
pub struct McpManager {
    pub clients: HashMap<String, McpClient>,
}

impl McpManager {
    /// 启动（或复用）所有启用的服务器，返回 OpenAI 格式的工具定义。
    /// 服务器失败时降级跳过，不影响其他工具。
    pub async fn start_enabled(
        &mut self,
        settings: &crate::settings::DesktopSettings,
        workspace_root: &Path,
    ) -> Vec<Value> {
        let entries = read_mcp_servers(settings, workspace_root);
        let mut tools = Vec::new();
        for entry in entries {
            if !entry.enabled {
                continue;
            }
            // 复用仍存活的连接
            if let Some(client) = self.clients.get_mut(&entry.id) {
                if client.is_alive() {
                    tools.extend(client.tool_defs(&entry.name));
                    continue;
                }
                self.clients.remove(&entry.id);
            }
            match McpClient::connect(entry.id.clone(), entry.name.clone(), &entry.command, &entry.args).await {
                Ok(client) => {
                    let defs = client.tool_defs(&entry.name);
                    tools.extend(defs);
                    self.clients.insert(entry.id, client);
                }
                Err(e) => {
                    tracing::warn!("MCP 服务器 {} 启动失败（已降级跳过）: {e}", entry.name);
                }
            }
        }
        tools
    }

    /// 执行 MCP 工具调用（工具名格式：mcp__<服务器名>__<工具名>）。
    pub async fn call(&mut self, full_name: &str, arguments: &Value) -> Result<Value, String> {
        let parts: Vec<&str> = full_name.splitn(3, "__").collect();
        if parts.len() != 3 {
            return Err("无效的 MCP 工具名".into());
        }
        let display = parts[1];
        let tool = parts[2];
        let mut target: Option<String> = None;
        for (id, client) in self.clients.iter() {
            if client.display_name == display {
                target = Some(id.clone());
                break;
            }
        }
        let Some(id) = target else {
            return Err(format!("MCP 服务器“{display}”未连接或已停止"));
        };
        let client = self.clients.get_mut(&id).ok_or("MCP 客户端状态异常")?;
        tokio::time::timeout(
            std::time::Duration::from_secs(CALL_TIMEOUT_SECS),
            client.call_tool(tool, arguments),
        )
        .await
        .map_err(|_| format!("MCP 工具调用超时（>{CALL_TIMEOUT_SECS}s）：{tool}"))?
    }

    /// 关闭全部 MCP 连接（应用退出时调用）。
    pub fn shutdown_all(&mut self) {
        for (_, client) in self.clients.iter_mut() {
            client.kill();
        }
        self.clients.clear();
    }
}

impl McpClient {
    /// 生成 OpenAI function 格式的工具定义（带 mcp__ 前缀避免冲突）。
    fn tool_defs(&self, display_name: &str) -> Vec<Value> {
        self.tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": format!("mcp__{}__{}", display_name, tool.name),
                        "description": format!("[MCP:{}] {}", display_name, tool.description),
                        "parameters": tool.input_schema,
                    }
                })
            })
            .collect()
    }
}

async fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut header_line = String::new();
    let mut content_length: Option<usize> = None;
    loop {
        header_line.clear();
        let n = reader
            .read_line(&mut header_line)
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("EOF".into());
        }
        let trimmed = header_line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = rest.trim().parse::<usize>().ok();
        }
    }
    let len = content_length.ok_or("缺少 Content-Length")?;
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&buf).map_err(|e| e.to_string())
}

async fn write_message(stdin: &mut tokio::process::ChildStdin, msg: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin
        .write_all(header.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin
        .write_all(&body)
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}