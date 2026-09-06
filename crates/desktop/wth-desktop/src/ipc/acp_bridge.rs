//! A-01（PRD）步骤 1：桌面端作为 ACP 客户端接入 CLI Agent 内核。
//!
//! 桌面端通过 [`xai_grok_shell::leader::connect_or_spawn`] 连接（或按需拉起）
//! shell leader 进程，以 ACP（agent-client-protocol）消息驱动会话，把
//! `session/update` 通知映射为既有的 `agent:stream` 事件（
//! [`StreamPayload`]），把 `session/request_permission` 请求桥接到既有的
//! 审批 UI。自研循环保留为回退：`settings.kernel_agent` 开关控制路由。
//!
//! 本模块刻意只做"协议形状 + 事件映射"的纯函数 + 一个薄运行时外壳，
//! 便于单测验证协议正确性（PRD A-01 验收的第一片）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot, RwLock};

use crate::ipc::agent::{AgentStreamChunk, StreamPayload};
use xai_grok_shell::leader::{connect_or_spawn, ClientCapabilities, ClientMode, LeaderEnvUrls};

/// ACP 协议版本（agent-client-protocol 0.10.x）。
const ACP_PROTOCOL_VERSION: u32 = 1;

/// 客户端标识（leader 侧用于区分 TUI / IDE / 桌面）。
const CLIENT_TYPE: &str = "wth-desktop";

/// 待响应的权限请求：`(请求 id, 原始 params, 用户决议通道)`。
type PendingPermission = (u64, Value, oneshot::Sender<bool>);

/// 内核会话句柄：请求出口 + 待响应 RPC 表 + 权限桥接表。
pub struct AcpKernel {
    /// 出站 JSON-RPC 文本（writer 任务泵到 LeaderConnection）。
    request_tx: mpsc::UnboundedSender<String>,
    next_id: Arc<AtomicU64>,
    /// 待响应 RPC（id → 回传通道）。
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    /// 待决议权限（toolCallId → (req_id, params, 决议通道)）。
    pub permissions: Arc<Mutex<HashMap<String, PendingPermission>>>,
    /// 当前 ACP 会话 id（session/new 成功后填充）。
    pub session_id: Arc<RwLock<Option<String>>>,
    /// leader 报告的版本（诊断用）。
    pub leader_version: Arc<RwLock<Option<String>>>,
}

impl AcpKernel {
    /// 连接（或拉起）leader 并完成 ACP 握手与会话创建。
    ///
    /// `kernel_agent_path` 非空时经 `WTH_LEADER_BIN` 传给 leader 二进制
    /// 解析逻辑（shell 侧 A-01 新增），用于指向本机构建的 `wth` 可执行文件。
    pub async fn connect(
        window: tauri::Window,
        workspace_root: &std::path::Path,
        edit_mode: &str,
        kernel_agent_path: Option<&str>,
    ) -> Result<AcpKernel, String> {
        if let Some(path) = kernel_agent_path.filter(|p| !p.trim().is_empty()) {
            // SAFETY: 桌面端低频调用（用户在设置里改路径后重连时）；进程内
            // 其余读取方（leader 二进制解析）在 connect_or_spawn 内同步执行，
            // 与本写入严格先后，不与其他线程的环境变量读改并发竞争。
            // SAFETY: rare, user-triggered reconnect; the only concurrent
            // reader (leader binary resolution) runs strictly after this
            // write inside connect_or_spawn.
            unsafe { std::env::set_var("WTH_LEADER_BIN", path.trim()) };
        }
        let env_urls = LeaderEnvUrls {
            grok_ws_url: String::new(),
            grok_ws_origin: String::new(),
        };
        let capabilities = ClientCapabilities {
            yolo_mode: edit_mode.eq_ignore_ascii_case("yolo"),
            auto_mode: edit_mode.eq_ignore_ascii_case("auto"),
            client_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            ..Default::default()
        };
        let mut conn = connect_or_spawn(CLIENT_TYPE, ClientMode::Stdio, &env_urls, capabilities)
            .await
            .map_err(|e| format!("ACP 连接 leader 失败: {e}"))?;

        let next_id = Arc::new(AtomicU64::new(1));
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> = Arc::default();
        let permissions: Arc<Mutex<HashMap<String, PendingPermission>>> = Arc::default();
        let (request_tx, mut request_rx) = mpsc::unbounded_channel::<String>();

        let kernel = Self {
            request_tx: request_tx.clone(),
            next_id: next_id.clone(),
            pending: pending.clone(),
            permissions: permissions.clone(),
            session_id: Arc::new(RwLock::new(None)),
            leader_version: Arc::new(RwLock::new(
                conn.registration().leader_binary_version.clone(),
            )),
        };

        // 单一 pump 任务独占连接：select! 同时服务出站请求与入站消息。
        {
            let window = window.clone();
            let session_id = kernel.session_id.clone();
            let pending = pending.clone();
            let permissions = permissions.clone();
            let pump_tx = request_tx.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        outbound = request_rx.recv() => match outbound {
                            Some(payload) => {
                                if conn.send(payload).is_err() {
                                    break;
                                }
                            }
                            None => break,
                        },
                        inbound = conn.recv() => match inbound {
                            Some(raw) => {
                                if !route_message(
                                    &raw,
                                    &window,
                                    &pending,
                                    &permissions,
                                    &session_id,
                                    &pump_tx,
                                ) {
                                    break;
                                }
                            }
                            None => break,
                        },
                    }
                }
            });
        }

        // 握手：initialize → session/new。
        let init_result = kernel.request(build_initialize(kernel.alloc_id()), true).await?;
        if let Some(info) = init_result.get("agentInfo").and_then(|v| v.get("version")).and_then(Value::as_str) {
            *kernel.leader_version.write().await = Some(info.to_string());
        }
        let session = kernel
            .request(build_session_new(kernel.alloc_id(), workspace_root), true)
            .await?;
        let sid = session
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| "ACP session/new 响应缺少 sessionId".to_string())?
            .to_string();
        *kernel.session_id.write().await = Some(sid);

        Ok(kernel)
    }

    fn alloc_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn send_raw(&self, payload: Value) -> Result<(), String> {
        serde_json::to_string(&payload)
            .map_err(|e| e.to_string())
            .and_then(|s| self.request_tx.send(s).map_err(|_| "ACP 连接已关闭".into()))
    }

    /// 发送请求并等待响应（`with_wait=false` 用于通知，不等待）。
    async fn request(&self, payload: Value, with_wait: bool) -> Result<Value, String> {
        let id = payload.get("id").and_then(Value::as_u64).unwrap_or(0);
        if !with_wait {
            self.send_raw(payload)?;
            return Ok(Value::Null);
        }
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.send_raw(payload)?;
        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(result)) => {
                if let Some(err) = result.get("error") {
                    return Err(format!("ACP 请求失败: {err}"));
                }
                Ok(result.get("result").cloned().unwrap_or(Value::Null))
            }
            Ok(Err(_)) => Err("ACP 请求通道关闭".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err("ACP 请求超时（30s）".into())
            }
        }
    }

    /// 发送用户消息；内核以 `session/update` 流式回传（reader 任务已映射）。
    pub async fn send_prompt(&self, text: &str) -> Result<(), String> {
        let session_id = self.session_id.read().await.clone().ok_or("ACP 会话未建立")?;
        let payload = build_prompt(self.alloc_id(), &session_id, text);
        // prompt 的响应携带 stopReason；等待完成即"本轮结束"。
        self.request(payload, true).await.map(|_| ())
    }

    /// 中止当前轮（session/cancel 通知）。
    pub fn cancel(&self) -> Result<(), String> {
        let session_id = self
            .session_id
            .try_read()
            .ok()
            .and_then(|g| g.clone())
            .ok_or("ACP 会话未建立")?;
        self.send_raw(build_cancel(&session_id))
    }

    /// 决议权限请求（审批 UI 回调），向内核回发所选 outcome。
    pub async fn respond_permission(&self, tool_call_id: &str, approved: bool) -> Result<(), String> {
        let (req_id, params) = {
            let mut map = self.permissions.lock().unwrap();
            let (req_id, params, tx) = map
                .remove(tool_call_id)
                .ok_or_else(|| "未找到对应的待审批权限请求".to_string())?;
            let _ = tx.send(approved);
            (req_id, params)
        };
        // 依据原始请求中的选项列表挑 outcome：允许取首个 allow 类，拒绝取首个 reject 类。
        let outcome_kind = if approved { "allow" } else { "reject" };
        let option_id = params
            .get("options")
            .and_then(Value::as_array)
            .and_then(|opts| {
                opts.iter()
                    .find(|o| {
                        o.get("kind")
                            .and_then(Value::as_str)
                            .is_some_and(|k| k.starts_with(outcome_kind))
                    })
                    .or_else(|| opts.first())
            })
            .and_then(|o| o.get("optionId"))
            .and_then(Value::as_str)
            .unwrap_or(if approved { "allow_once" } else { "reject_once" })
            .to_string();
        self.send_raw(build_permission_response(
            req_id,
            &params
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            &option_id,
        ))
    }
}

/// 路由一条入站消息。返回 `false` 表示连接关闭。
fn route_message(
    raw: &str,
    window: &tauri::Window,
    pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    permissions: &Arc<Mutex<HashMap<String, PendingPermission>>>,
    session_id: &Arc<RwLock<Option<String>>>,
    request_tx: &mpsc::UnboundedSender<String>,
) -> bool {
    let Ok(msg) = serde_json::from_str::<Value>(raw) else {
        return true; // 忽略无法解析的行（leader 心跳等）
    };
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    match method {
        "session/update" => {
            let sid = msg
                .pointer("/params/sessionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if let Some(update) = msg.pointer("/params/update") {
                for payload in map_session_update(update) {
                    let _ = window.emit(
                        "agent:stream",
                        AgentStreamChunk {
                            session_id: sid.clone(),
                            payload,
                        },
                    );
                }
            }
            let _ = session_id;
            true
        }
        "session/request_permission" => {
            let req_id = msg.get("id").and_then(Value::as_u64).unwrap_or(0);
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            let tool_call_id = params
                .pointer("/toolCall/toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let (tx, _rx) = oneshot::channel::<bool>();
            permissions
                .lock()
                .unwrap()
                .insert(tool_call_id.clone(), (req_id, params.clone(), tx));
            let _ = window.emit(
                "agent:approval",
                json!({
                    "session_id": params.get("sessionId").and_then(Value::as_str).unwrap_or(""),
                    "tool_id": tool_call_id,
                    "tool_name": params.pointer("/toolCall/title").and_then(Value::as_str).unwrap_or("tool"),
                    "arguments": params.pointer("/toolCall/rawInput").cloned().unwrap_or(Value::Null),
                }),
            );
            let _ = request_tx;
            true
        }
        _ => {
            // 响应（带 id 的成功/错误）投递给等待方。
            if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                if let Some(tx) = pending.lock().unwrap().remove(&id) {
                    let _ = tx.send(msg);
                }
            }
            true
        }
    }
}

/// `session/update` 的 update 对象 → 前端事件负载（纯函数，可单测）。
pub fn map_session_update(update: &Value) -> Vec<StreamPayload> {
    let kind = update.get("sessionUpdate").and_then(Value::as_str).unwrap_or("");
    match kind {
        "agent_message_chunk" | "user_message_chunk" => vec![StreamPayload::TextDelta {
            delta: update
                .pointer("/content/text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        }],
        "agent_thought_chunk" => {
            // 思考流暂不透出（前端无对应渲染位），保留映射点。
            vec![]
        }
        "tool_call" => vec![StreamPayload::ToolCallStart {
            tool_id: update
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            tool_name: update.get("title").and_then(Value::as_str).unwrap_or("tool").to_string(),
            arguments: update.get("rawInput").cloned().unwrap_or(Value::Null),
            // 内核侧已按权限模式把关；需要审批的请求走 session/request_permission。
            needs_approval: false,
        }],
        "tool_call_update" => {
            let status = update.get("status").and_then(Value::as_str).unwrap_or("");
            if matches!(status, "completed" | "failed") {
                vec![StreamPayload::ToolCallEnd {
                    tool_id: update
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    result: update
                        .get("content")
                        .cloned()
                        .unwrap_or_else(|| json!({ "status": status })),
                }]
            } else {
                vec![]
            }
        }
        "plan" | "available_commands_update" | "current_mode_update" => vec![],
        _ => vec![],
    }
}

// ─── 请求构造（纯函数，形状对齐 agent-client-protocol 0.10） ────────────────

pub fn build_initialize(id: u64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": ACP_PROTOCOL_VERSION,
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": true },
            },
            "clientInfo": { "name": CLIENT_TYPE, "version": env!("CARGO_PKG_VERSION") },
        }
    })
}

pub fn build_session_new(id: u64, cwd: &std::path::Path) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "session/new",
        "params": {
            "cwd": cwd.display().to_string(),
            "mcpServers": [],
        }
    })
}

pub fn build_prompt(id: u64, session_id: &str, text: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "session/prompt",
        "params": {
            "sessionId": session_id,
            "prompt": [ { "type": "text", "text": text } ],
        }
    })
}

pub fn build_cancel(session_id: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "session/cancel",
        "params": { "sessionId": session_id },
    })
}

pub fn build_permission_response(id: u64, session_id: &str, option_id: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "outcome": { "outcome": "selected", "optionId": option_id, "sessionId": session_id },
        }
    })
}

// ─── 运行时入口（供 agent_send / 审批命令复用） ─────────────────────────────

/// 确保内核桥接可用：已连接则复用，否则按设置建立连接。
pub async fn ensure_connected(
    state: &crate::state::AppState,
    window: &tauri::Window,
) -> Result<Arc<AcpKernel>, String> {
    {
        let guard = state.acp.lock().await;
        if let Some(kernel) = guard.as_ref() {
            return Ok(Arc::new(snapshot_handle(kernel)));
        }
    }
    let (edit_mode, kernel_agent_path) = {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        (settings.edit_mode.clone(), settings.kernel_agent_path.clone())
    };
    let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    let kernel = AcpKernel::connect(
        window.clone(),
        &workspace_root,
        &edit_mode,
        kernel_agent_path.as_deref(),
    )
    .await?;
    let handle = Arc::new(kernel);
    *state.acp.lock().await = Some(snapshot_handle(&handle));
    Ok(handle)
}

/// 复制句柄的轻量快照（连接由 pump 任务持有，克隆只共享通道与状态）。
/// AcpKernel 字段均为 Arc/通道，手动逐字段复制以避免引入 Clone derive 对
/// LeaderConnection 的错误假设。
pub fn snapshot_handle(kernel: &AcpKernel) -> AcpKernel {
    AcpKernel {
        request_tx: kernel.request_tx.clone(),
        next_id: kernel.next_id.clone(),
        pending: kernel.pending.clone(),
        permissions: kernel.permissions.clone(),
        session_id: kernel.session_id.clone(),
        leader_version: kernel.leader_version.clone(),
    }
}

/// 连接状态（诊断命令，设置 → 诊断页可用）。
#[tauri::command]
pub async fn acp_status(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Value, String> {
    let guard = state.acp.lock().await;
    match guard.as_ref() {
        Some(kernel) => {
            let sid = kernel.session_id.read().await.clone();
            let ver = kernel.leader_version.read().await.clone();
            Ok(json!({
                "connected": true,
                "session_id": sid,
                "leader_version": ver,
            }))
        }
        None => Ok(json!({ "connected": false })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_request_shape() {
        let req = build_initialize(1);
        assert_eq!(req["jsonrpc"], "2.0");
        assert_eq!(req["method"], "initialize");
        assert_eq!(req["params"]["protocolVersion"], 1);
        assert_eq!(req["params"]["clientInfo"]["name"], "wth-desktop");
    }

    #[test]
    fn session_new_and_prompt_shapes() {
        let req = build_session_new(2, std::path::Path::new("D:/repo"));
        assert_eq!(req["method"], "session/new");
        assert_eq!(req["params"]["cwd"], "D:/repo");
        assert_eq!(req["params"]["mcpServers"], json!([]));

        let req = build_prompt(3, "s-1", "hello");
        assert_eq!(req["method"], "session/prompt");
        assert_eq!(req["params"]["sessionId"], "s-1");
        assert_eq!(req["params"]["prompt"][0]["text"], "hello");
    }

    #[test]
    fn message_chunk_maps_to_text_delta() {
        let update = json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "你好" },
        });
        let payloads = map_session_update(&update);
        match &payloads[..] {
            [StreamPayload::TextDelta { delta }] => assert_eq!(delta, "你好"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn tool_call_lifecycle_maps_to_start_and_end() {
        let start = map_session_update(&json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "t-1",
            "title": "read_file",
            "rawInput": { "path": "a.rs" },
        }));
        match &start[..] {
            [StreamPayload::ToolCallStart { tool_id, tool_name, needs_approval, .. }] => {
                assert_eq!(tool_id, "t-1");
                assert_eq!(tool_name, "read_file");
                assert!(!needs_approval);
            }
            other => panic!("unexpected: {other:?}"),
        }

        let end = map_session_update(&json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "t-1",
            "status": "completed",
            "content": [{ "type": "content", "content": { "type": "text", "text": "ok" } }],
        }));
        match &end[..] {
            [StreamPayload::ToolCallEnd { tool_id, result }] => {
                assert_eq!(tool_id, "t-1");
                assert!(result.is_array());
            }
            other => panic!("unexpected: {other:?}"),
        }

        // 进行中的 update 不产生事件。
        assert!(map_session_update(&json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "t-1",
            "status": "pending",
        }))
        .is_empty());
    }

    #[test]
    fn unknown_kinds_are_ignored() {
        assert!(map_session_update(&json!({ "sessionUpdate": "plan" })).is_empty());
        assert!(map_session_update(&json!({})).is_empty());
    }

    #[test]
    fn permission_response_uses_selected_outcome() {
        let resp = build_permission_response(9, "s-1", "allow_once");
        assert_eq!(resp["id"], 9);
        assert_eq!(resp["result"]["outcome"]["outcome"], "selected");
        assert_eq!(resp["result"]["outcome"]["optionId"], "allow_once");
    }
}
