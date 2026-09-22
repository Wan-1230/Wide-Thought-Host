//! F-07: `wth mcp-serve` — 把 WTH 工作区暴露为 MCP (Model Context Protocol)
//! 服务器，供 VS Code / Claude Desktop / 其他 Agent 消费。
//!
//! 第一阶段为**只读工具面**（读文件 / 列目录 / 文本检索），stdio 传输
//! （newline-delimited JSON-RPC，MCP 2025-06-18 规范）；路径严格限制在
//! `--root` 工作区内（与桌面端 `safe_join` 同款围栏）。会话级工具（提问）
//! 待内核会话面接入后开放。
//!
//! # 协议处理
//!
//! [`handle_message`] 是纯函数：入站 JSON-RPC 消息 → 响应（通知返回 None），
//! 单测可完整覆盖协议形状；[`run_stdio_server`] 只负责行循环。

use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

/// 本服务器实现的 MCP 协议版本。
pub const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
/// 服务器名（clientInfo / serverInfo 用）。
pub const SERVER_NAME: &str = "wth";

/// 单个服务器实例的根状态。
#[derive(Debug, Clone)]
pub struct ServerState {
    /// 工作区根（所有工具路径的围栏边界）。
    pub root: PathBuf,
}

/// 工具清单（tools/list 返回，与执行分发共用同一张表）。
pub const TOOL_NAMES: &[&str] = &["wth_read_file", "wth_list_dir", "wth_ask", "wth_grep"];

/// 解析单条入站消息。返回 `None` 表示无需响应（通知/解析失败静默丢弃）。
pub fn handle_message(msg: &Value, state: &ServerState) -> Option<Value> {
    let method = msg.get("method").and_then(Value::as_str)?;
    let id = msg.get("id").cloned();
    let respond = |result: Result<Value, (i64, String)>| {
        let id = id.clone()?;
        Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": code, "message": message },
            }),
        })
    };
    match method {
        "initialize" => respond(Ok(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
        }))),
        "ping" => respond(Ok(json!({}))),
        "tools/list" => respond(Ok(json!({ "tools": tool_definitions() }))),
        "tools/call" => {
            let name = msg
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let args = msg
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            let result = call_tool(state, &name, &args);
            // MCP 工具错误以 isError 结果返回（而非 JSON-RPC error），客户端可读性更好。
            respond(Ok(result))
        }
        // 通知（initialized/cancelled 等）：无需响应。
        _ if id.is_none() => None,
        _ => respond(Err((-32601, format!("未知方法: {method}")))),
    }
}

/// 三件只读工具的定义（JSON Schema）。
pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "wth_read_file",
            "description": "读取工作区内一个文本文件的内容（UTF-8，超过 max_bytes 截断）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "相对工作区根的路径" },
                    "max_bytes": { "type": "integer", "description": "最大读取字节数（默认 200000）" },
                },
                "required": ["path"],
            },
        }),
        json!({
            "name": "wth_list_dir",
            "description": "列出工作区内一个目录的一层内容（名称 + 类型），不递归。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "相对工作区根的目录，默认根" },
                },
            },
        }),
        json!({
            "name": "wth_ask",
            "description": "把一个问题交给 WTH Agent 在工作区上下文中回答（headless 运行，只读分析；耗时可能数十秒）。适合让调用方 Agent 借助 WTH 的完整工具生态（代码检索/执行/子代理）获取带依据的答案。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "要交给 WTH Agent 的问题" },
                    "timeout_secs": { "type": "integer", "description": "超时秒数（默认 300）" },
                },
                "required": ["prompt"],
            },
        }),
        json!({
            "name": "wth_grep",
            "description": "在工作区内做大小写不敏感的子串文本检索（跳过 .git/target/node_modules 与二进制文件），返回命中文件与行。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "检索子串（大小写不敏感）" },
                    "path": { "type": "string", "description": "限定目录（默认整个工作区）" },
                    "max_results": { "type": "integer", "description": "最多命中条数（默认 50）" },
                },
                "required": ["pattern"],
            },
        }),
    ]
}

/// 分发工具调用；输出统一为 MCP content 形状，错误置 isError。
pub fn call_tool(state: &ServerState, name: &str, args: &Value) -> Value {
    let text = match name {
        "wth_read_file" => tool_read_file(state, args),
        "wth_list_dir" => tool_list_dir(state, args),
        "wth_grep" => tool_grep(state, args),
        "wth_ask" => tool_wth_ask(state, args),
        _ => Err(format!(
            "未知工具: {name}（可用: {}）",
            TOOL_NAMES.join(", ")
        )),
    };
    match text {
        Ok(text) => json!({
            "content": [{ "type": "text", "text": text }],
            "isError": false,
        }),
        Err(e) => json!({
            "content": [{ "type": "text", "text": e }],
            "isError": true,
        }),
    }
}

/// 路径围栏：相对路径解析进 `root`，拒绝绝对路径与 `..` 逃逸。
pub fn contained_path(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    let rel = if raw.is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(raw)
    };
    if rel.is_absolute() {
        return Err(format!("拒绝绝对路径: {raw}（仅允许工作区内相对路径）"));
    }
    let joined = root.join(&rel);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("路径不存在或不可访问: {raw}（{e}）"))?;
    let root_canonical = root
        .canonicalize()
        .map_err(|e| format!("工作区根不可访问: {e}"))?;
    if !canonical.starts_with(&root_canonical) {
        return Err(format!("拒绝访问：{raw} 位于工作区之外"));
    }
    Ok(canonical)
}

const READ_DEFAULT_MAX_BYTES: usize = 200_000;

fn tool_read_file(state: &ServerState, args: &Value) -> Result<String, String> {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or("缺少 path 参数")?;
    let max_bytes = args
        .get("max_bytes")
        .and_then(Value::as_u64)
        .unwrap_or(READ_DEFAULT_MAX_BYTES as u64) as usize;
    let full = contained_path(&state.root, path)?;
    if full.is_dir() {
        return Err(format!("{path} 是目录；请使用 wth_list_dir"));
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("读取失败: {e}"))?;
    let truncated = bytes.len() > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes)];
    let text = String::from_utf8_lossy(slice);
    Ok(if truncated {
        format!(
            "{text}\n\n[已截断：文件共 {} 字节，仅返回前 {max_bytes} 字节]",
            bytes.len()
        )
    } else {
        text.to_string()
    })
}

fn tool_list_dir(state: &ServerState, args: &Value) -> Result<String, String> {
    let path = args.get("path").and_then(Value::as_str).unwrap_or(".");
    let full = contained_path(&state.root, path)?;
    let mut entries: Vec<String> = std::fs::read_dir(&full)
        .map_err(|e| format!("列目录失败: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| {
            let kind = if e.path().is_dir() { "dir" } else { "file" };
            format!("[{kind}] {}", e.file_name().to_string_lossy())
        })
        .collect();
    entries.sort();
    Ok(if entries.is_empty() {
        "(空目录)".to_string()
    } else {
        entries.join("\n")
    })
}

/// 检索时跳过的目录名。
const GREP_SKIP_DIRS: &[&str] = &[".git", "target", "node_modules", "dist", ".wth"];
/// 单文件大小上限（超过按二进制跳过）。
const GREP_MAX_FILE_BYTES: u64 = 1_000_000;
/// 默认命中上限。
const GREP_DEFAULT_MAX_RESULTS: usize = 50;

fn tool_grep(state: &ServerState, args: &Value) -> Result<String, String> {
    let pattern = args
        .get("pattern")
        .and_then(Value::as_str)
        .ok_or("缺少 pattern 参数")?
        .to_lowercase();
    if pattern.is_empty() {
        return Err("pattern 不能为空".into());
    }
    let sub = args.get("path").and_then(Value::as_str).unwrap_or(".");
    let base = contained_path(&state.root, sub)?;
    let max_results = args
        .get("max_results")
        .and_then(Value::as_u64)
        .unwrap_or(GREP_DEFAULT_MAX_RESULTS as u64) as usize;

    let mut hits: Vec<String> = Vec::new();
    let mut files_scanned = 0usize;
    let mut stack = vec![base.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !GREP_SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                    stack.push(path);
                }
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() == 0 || meta.len() > GREP_MAX_FILE_BYTES {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue; // 二进制/非 UTF-8 跳过
            };
            files_scanned += 1;
            let rel = path
                .strip_prefix(&state.root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&pattern) {
                    hits.push(format!("{rel}:{}: {}", i + 1, line.trim()));
                    if hits.len() >= max_results {
                        hits.push(format!(
                            "[已达 {max_results} 条上限；已扫描 {files_scanned} 个文件]"
                        ));
                        return Ok(hits.join("\n"));
                    }
                }
            }
        }
    }
    Ok(if hits.is_empty() {
        format!("未命中（已扫描 {files_scanned} 个文件）")
    } else {
        hits.join("\n")
    })
}

/// `wth_ask` 可执行文件解析顺序：`WTH_ASK_BIN` env（测试/定制）→ PATH 上的 `wth`。
fn ask_binary() -> String {
    std::env::var("WTH_ASK_BIN").unwrap_or_else(|_| "wth".to_string())
}

const ASK_DEFAULT_TIMEOUT_SECS: u64 = 300;
const ASK_OUTPUT_CHARS: usize = 8_000;

/// F-07 二阶段: 会话级工具——把 prompt 交给 WTH Agent headless 运行
/// （`wth -p <prompt>`，工作区根为 cwd），返回其输出。
fn tool_wth_ask(state: &ServerState, args: &Value) -> Result<String, String> {
    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or("缺少 prompt 参数")?;
    let timeout = args
        .get("timeout_secs")
        .and_then(Value::as_u64)
        .unwrap_or(ASK_DEFAULT_TIMEOUT_SECS)
        .clamp(10, 1800);
    let bin = ask_binary();
    let mut child = std::process::Command::new(&bin)
        .arg("-p")
        .arg(prompt)
        .current_dir(&state.root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 {bin}: {e}（请确认 wth 在 PATH 中，或设置 WTH_ASK_BIN）"))?;
    // 等待线程：wait_with_output 需要所有权；主循环用 recv_timeout 控制超时。
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let output = rx
        .recv_timeout(std::time::Duration::from_secs(timeout))
        .map_err(|_| {
            tracing::warn!("wth_ask 超时（>{timeout}s）；子进程继续运行至自然结束");
            format!("WTH Agent 运行超时（>{timeout}s）")
        })?
        .map_err(|e| format!("WTH Agent 等待失败: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "WTH Agent 退出码 {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(500)
                .collect::<String>()
        ));
    }
    let text: String = String::from_utf8_lossy(&output.stdout)
        .chars()
        .take(ASK_OUTPUT_CHARS)
        .collect();
    Ok(if text.is_empty() {
        "(WTH Agent 无输出)".to_string()
    } else {
        text
    })
}

/// stdio 服务循环：newline-delimited JSON-RPC。阻塞直到 stdin 关闭。
pub fn run_stdio_server(root: PathBuf) -> Result<(), String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("工作区根不可访问: {e}"))?;
    let state = ServerState { root };
    eprintln!(
        "{SERVER_NAME} mcp-serve ready: root={} tools={}",
        state.root.display(),
        TOOL_NAMES.join(",")
    );
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            // 非法行：RFC 要求可忽略或报错；stdio 下回一条可诊断的解析错误。
            let _ = serde_json::to_writer(
                &mut out,
                &json!({
                    "jsonrpc": "2.0", "id": null,
                    "error": { "code": -32700, "message": "解析错误：非合法 JSON 行" },
                }),
            );
            let _ = out.write_all(b"\n");
            continue;
        };
        if let Some(resp) = handle_message(&msg, &state) {
            serde_json::to_writer(&mut out, &resp).map_err(|e| format!("写出失败: {e}"))?;
            out.write_all(b"\n").map_err(|e| format!("写出失败: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace() -> (tempfile::TempDir, ServerState) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("hello.rs"),
            "fn main() {\n    println!(\"你好 WTH\");\n}\n",
        )
        .unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(
            dir.path().join("sub").join("notes.md"),
            "# 笔记\n搜索目标内容在这里。\n",
        )
        .unwrap();
        let state = ServerState {
            root: dir.path().to_path_buf(),
        };
        (dir, state)
    }

    #[test]
    fn initialize_returns_capabilities() {
        let (_dir, state) = temp_workspace();
        let resp = handle_message(
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
                     "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "test" } } }),
            &state,
        )
        .unwrap();
        assert_eq!(resp["result"]["protocolVersion"], MCP_PROTOCOL_VERSION);
        assert_eq!(resp["result"]["serverInfo"]["name"], SERVER_NAME);
        assert!(resp["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn notifications_and_unknown_methods() {
        let (_dir, state) = temp_workspace();
        // 通知：无 id → 无响应
        assert!(
            handle_message(
                &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
                &state
            )
            .is_none()
        );
        // 未知方法（带 id）→ -32601
        let resp = handle_message(
            &json!({ "jsonrpc": "2.0", "id": 2, "method": "no/such" }),
            &state,
        )
        .unwrap();
        assert_eq!(resp["error"]["code"], -32601);
        // ping
        let resp = handle_message(
            &json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }),
            &state,
        )
        .unwrap();
        assert_eq!(resp["result"], json!({}));
    }

    #[test]
    fn tools_list_matches_dispatch() {
        let (_dir, state) = temp_workspace();
        let resp = handle_message(
            &json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }),
            &state,
        )
        .unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, TOOL_NAMES);
    }

    #[test]
    fn read_file_and_containment() {
        let (_dir, state) = temp_workspace();
        let out = call_tool(&state, "wth_read_file", &json!({ "path": "hello.rs" }));
        assert_eq!(out["isError"], false);
        assert!(
            out["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("你好 WTH")
        );

        // 绝对路径拒绝
        let out = call_tool(
            &state,
            "wth_read_file",
            &json!({ "path": "C:/Windows/win.ini" }),
        );
        assert_eq!(out["isError"], true);
        // .. 逃逸拒绝（规范化后出根）
        let out = call_tool(
            &state,
            "wth_read_file",
            &json!({ "path": "sub/../../outside.txt" }),
        );
        assert_eq!(out["isError"], true);
        // 未知工具
        let out = call_tool(&state, "wth_nothing", &json!({}));
        assert_eq!(out["isError"], true);
    }

    #[test]
    fn list_dir_and_grep() {
        let (_dir, state) = temp_workspace();
        let out = call_tool(&state, "wth_list_dir", &json!({}));
        let text = out["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("[dir] sub"));
        assert!(text.contains("[file] hello.rs"));

        let out = call_tool(&state, "wth_grep", &json!({ "pattern": "搜索目标" }));
        let text = out["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("notes.md:2"), "grep hit: {text}");

        let out = call_tool(&state, "wth_grep", &json!({ "pattern": "不存在的内容xyz" }));
        assert!(
            out["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("未命中")
        );
    }

    #[test]
    fn stdio_loop_round_trip() {
        // 端到端：喂三行请求，读三行响应。
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "内容").unwrap();
        let state = ServerState {
            root: dir.path().to_path_buf(),
        };
        let lines = vec![
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }).to_string(),
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": { "name": "wth_read_file", "arguments": { "path": "a.txt" } } })
            .to_string(),
        ];
        let mut responses = Vec::new();
        for line in lines {
            let msg: Value = serde_json::from_str(&line).unwrap();
            if let Some(resp) = handle_message(&msg, &state) {
                responses.push(resp);
            }
        }
        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0]["id"], 1);
        assert_eq!(responses[1]["id"], 2);
        assert!(
            responses[1]["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("内容")
        );
    }
}
