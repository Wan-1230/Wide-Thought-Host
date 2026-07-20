//! IPC commands for agent interaction.
//!
//! Calls OpenAI-compatible chat completions API with streaming (SSE).
//! API key and endpoint are configured through the frontend settings.

use crate::state::{AgentHandle, AppState};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

/// Incoming message from the frontend.
#[derive(Debug, Deserialize)]
pub struct AgentMessage {
    pub session_id: String,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub model: Option<String>,
    /// API configuration from frontend settings
    #[serde(default)]
    pub api_config: ApiConfig,
    /// Conversation history (previous messages for multi-turn)
    #[serde(default)]
    pub history: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ApiConfig {
    #[serde(default = "default_api_base")]
    pub api_base: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_api_base() -> String {
    "https://api.openai.com/v1".into()
}
fn default_model() -> String {
    "gpt-4.1".into()
}

#[derive(Debug, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub path: Option<String>,
    pub content: Option<String>,
    pub mime_type: String,
}

// ─── Streaming payload ─────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AgentStreamChunk {
    pub session_id: String,
    #[serde(flatten)]
    pub payload: StreamPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamPayload {
    TextDelta { delta: String },
    ToolCallStart { tool_id: String, tool_name: String, arguments: serde_json::Value },
    ToolCallEnd { tool_id: String, result: serde_json::Value },
    Done { usage: Option<UsageInfo> },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageInfo {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

// ─── Commands ──────────────────────────────────────────

#[tauri::command]
pub async fn agent_send(
    state: State<'_, AppState>,
    window: tauri::Window,
    message: AgentMessage,
) -> Result<(), String> {
    let session_id = message.session_id.clone();
    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel::<()>();

    {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.current = Some(session_id.clone());
        agents.sessions.insert(session_id.clone(), AgentHandle {
            id: session_id.clone(),
            title: format!("Session {}", &session_id[..8.min(session_id.len())]),
            running: true,
            abort_tx: Some(abort_tx),
        });
    }

    let agent_state = state.inner().agents.clone();
    let window_clone = window.clone();
    let sid = session_id.clone();

    tokio::spawn(async move {
        let result = run_agent(sid.clone(), message, window_clone, abort_rx).await;
        if let Ok(mut agents) = agent_state.lock() {
            if let Some(handle) = agents.sessions.get_mut(&sid) {
                handle.running = false;
            }
        }
        if let Err(e) = result {
            let _ = window.emit("agent:stream", AgentStreamChunk {
                session_id: sid.clone(),
                payload: StreamPayload::Error { message: e },
            });
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn agent_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = agents.sessions.get_mut(&session_id) {
        if let Some(tx) = handle.abort_tx.take() {
            let _ = tx.send(());
        }
        handle.running = false;
    }
    Ok(())
}

// ─── Core: Streaming LLM call ─────────────────────────

async fn run_agent(
    session_id: String,
    message: AgentMessage,
    window: tauri::Window,
    abort_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let api_base = message
        .api_config
        .api_base
        .trim_end_matches('/')
        .to_string();
    let api_key = message.api_config.api_key.trim().to_string();
    let model = message.api_config.model.clone();

    if api_key.is_empty() {
        return Err("请先在设置中配置 API Key".into());
    }

    let url = format!("{}/chat/completions", api_base);

    // Build messages array: system + history + current user message
    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "system",
        "content": "你是 Wide Thought Host，一个专业的 AI 编码助手。请用中文回答问题，代码注释尽量用中文。"
    })];

    for h in &message.history {
        messages.push(serde_json::json!({
            "role": h.role,
            "content": h.content
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": message.content
    }));

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let resp = match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => {
            if !r.status().is_success() {
                let status = r.status();
                let err_body = r.text().await.unwrap_or_default();
                return Err(format!("API 错误 ({}): {}", status, err_body));
            }
            r
        }
        Err(e) => return Err(format!("请求失败: {}", e)),
    };

    let sid = session_id.clone();
    let win = window.clone();

    let handle = tokio::spawn(async move {
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    let _ = win.emit("agent:stream", AgentStreamChunk {
                        session_id: sid.clone(),
                        payload: StreamPayload::Error { message: format!("流读取错误: {}", e) },
                    });
                    return;
                }
            };

            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete SSE lines
            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() { continue; }
                if line == "data: [DONE]" {
                    let _ = win.emit("agent:stream", AgentStreamChunk {
                        session_id: sid.clone(),
                        payload: StreamPayload::Done { usage: None },
                    });
                    return;
                }
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(choices) = parsed["choices"].as_array() {
                            for choice in choices {
                                if let Some(delta) = choice["delta"]["content"].as_str() {
                                    if !delta.is_empty() {
                                        let _ = win.emit("agent:stream", AgentStreamChunk {
                                            session_id: sid.clone(),
                                            payload: StreamPayload::TextDelta { delta: delta.to_string() },
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let _ = win.emit("agent:stream", AgentStreamChunk {
            session_id: sid.clone(),
            payload: StreamPayload::Done { usage: None },
        });
    });

    let abort_handle = handle.abort_handle();
    let abort_sid = session_id.clone();
    tokio::select! {
        _ = abort_rx => {
            let _ = window.emit("agent:stream", AgentStreamChunk {
                session_id: abort_sid,
                payload: StreamPayload::Error { message: "已中止".into() },
            });
            abort_handle.abort();
            Ok(())
        }
        result = async { handle.await.map_err(|e| format!("流处理错误: {}", e)) } => {
            result
        }
    }
}
