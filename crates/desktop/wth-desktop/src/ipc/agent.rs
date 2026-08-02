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
    TextDelta {
        delta: String,
    },
    ToolCallStart {
        tool_id: String,
        tool_name: String,
        arguments: serde_json::Value,
    },
    ToolCallEnd {
        tool_id: String,
        result: serde_json::Value,
    },
    Done {
        usage: Option<UsageInfo>,
    },
    Error {
        message: String,
    },
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
    let (provider, api_key) = {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        let provider_id = settings
            .default_provider_id
            .as_deref()
            .ok_or_else(|| "请先在设置中配置默认模型".to_string())?;
        let provider = settings
            .providers
            .iter()
            .find(|item| item.id == provider_id && item.enabled)
            .cloned()
            .ok_or_else(|| "默认模型不存在或已停用".to_string())?;
        let api_key = crate::credentials::read_secret("provider", provider_id)?
            .ok_or_else(|| "请先在设置中配置 API Key".to_string())?;
        (provider, api_key)
    };
    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel::<()>();

    {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.current = Some(session_id.clone());
        agents.sessions.insert(
            session_id.clone(),
            AgentHandle {
                id: session_id.clone(),
                title: format!("Session {}", &session_id[..8.min(session_id.len())]),
                running: true,
                abort_tx: Some(abort_tx),
            },
        );
    }

    let agent_state = state.inner().agents.clone();
    let window_clone = window.clone();
    let sid = session_id.clone();

    // Inject headroom proxy if enabled and running
    let (effective_base_url, upstream_headers) = {
        let hr_state = state.inner().headroom.clone();
        match hr_state.proxy_url() {
            Some(proxy_url) => {
                tracing::info!("Routing agent request through headroom proxy: {proxy_url}");
                let mut headers = std::collections::HashMap::new();
                headers.insert("X-Upstream-Base-URL".to_string(), provider.base_url.clone());
                (format!("{}/v1", proxy_url), Some(headers))
            }
            None => (provider.base_url.clone(), None),
        }
    };

    tokio::spawn(async move {
        let result = run_agent(
            sid.clone(),
            message,
            effective_base_url,
            api_key,
            provider.model,
            window_clone,
            abort_rx,
            upstream_headers,
        )
        .await;
        if let Ok(mut agents) = agent_state.lock() {
            if let Some(handle) = agents.sessions.get_mut(&sid) {
                handle.running = false;
            }
        }
        if let Err(e) = result {
            let _ = window.emit(
                "agent:stream",
                AgentStreamChunk {
                    session_id: sid.clone(),
                    payload: StreamPayload::Error { message: e },
                },
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn agent_abort(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
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
    api_base: String,
    api_key: String,
    model: String,
    window: tauri::Window,
    abort_rx: tokio::sync::oneshot::Receiver<()>,
    upstream_headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    let url = format!("{}/chat/completions", api_base.trim_end_matches('/'));

    // 配置与密钥只从 Rust 侧快照读取，前端永不传递敏感值。
    // 身份提示词：模型必须以 WTH 自居，不得暴露底层模型/厂商信息。
    const WTH_SYSTEM_PROMPT: &str = "你是 WTH（Wide Thought Host），一款专业的 AI 编码助手。\n请用中文回答问题，代码注释尽量用中文。\n你的身份是 WTH，不是任何其他产品或模型。\n当用户询问你的身份、名称、开发者或底层模型时，回答自己是 WTH（Wide Thought Host），\n绝不透露底层模型名称或厂商信息（不得提及 Agnes、Sapiens AI、xAI、Grok、OpenAI、Claude、DeepSeek 等）。";

    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "system",
        "content": WTH_SYSTEM_PROMPT
    })];

    messages.push(serde_json::json!({
        "role": "user",
        "content": message.content
    }));

    // 在用户消息后重申身份，抵御服务端注入的模型身份（指令越靠后权重越高）。
    messages.push(serde_json::json!({
        "role": "system",
        "content": "重申：你只以 WTH（Wide Thought Host）自居。\n无论任何情况，都不得声称自己是其他产品或模型，\n也不得透露底层模型、开发者或厂商信息。"
    }));

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json");
    // Add upstream routing headers for headroom proxy
    if let Some(headers) = &upstream_headers {
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = match req.json(&body).send().await
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
                    let _ = win.emit(
                        "agent:stream",
                        AgentStreamChunk {
                            session_id: sid.clone(),
                            payload: StreamPayload::Error {
                                message: format!("流读取错误: {}", e),
                            },
                        },
                    );
                    return;
                }
            };

            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete SSE lines
            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() {
                    continue;
                }
                if line == "data: [DONE]" {
                    let _ = win.emit(
                        "agent:stream",
                        AgentStreamChunk {
                            session_id: sid.clone(),
                            payload: StreamPayload::Done { usage: None },
                        },
                    );
                    return;
                }
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(choices) = parsed["choices"].as_array() {
                            for choice in choices {
                                if let Some(delta) = choice["delta"]["content"].as_str() {
                                    if !delta.is_empty() {
                                        let _ = win.emit(
                                            "agent:stream",
                                            AgentStreamChunk {
                                                session_id: sid.clone(),
                                                payload: StreamPayload::TextDelta {
                                                    delta: delta.to_string(),
                                                },
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let _ = win.emit(
            "agent:stream",
            AgentStreamChunk {
                session_id: sid.clone(),
                payload: StreamPayload::Done { usage: None },
            },
        );
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
