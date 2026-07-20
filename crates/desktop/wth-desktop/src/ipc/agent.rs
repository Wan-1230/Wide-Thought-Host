//! IPC commands for agent interaction.
//!
//! Bridges the Tauri frontend with wth-agent / xai-grok-shell runtime.

use crate::state::{AgentHandle, AppState};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

/// Incoming message from the frontend.
#[derive(Debug, Deserialize)]
pub struct AgentMessage {
    /// Session identifier
    pub session_id: String,
    /// User message content
    pub content: String,
    /// Optional file attachments (base64 or paths)
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    /// Model override for this message
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub path: Option<String>,
    pub content: Option<String>,
    pub mime_type: String,
}

/// Outgoing streaming chunk to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AgentStreamChunk {
    pub session_id: String,
    #[serde(flatten)]
    pub payload: StreamPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamPayload {
    /// A text delta from the assistant
    TextDelta { delta: String },
    /// A tool call has started
    ToolCallStart {
        tool_id: String,
        tool_name: String,
        arguments: serde_json::Value,
    },
    /// A tool call completed
    ToolCallEnd {
        tool_id: String,
        result: serde_json::Value,
    },
    /// The assistant response is complete
    Done { usage: Option<UsageInfo> },
    /// An error occurred
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageInfo {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

/// Send a message to the agent and stream the response back.
///
/// The frontend receives `agent:stream` events for each chunk.
#[tauri::command]
pub async fn agent_send(
    state: State<'_, AppState>,
    window: tauri::Window,
    message: AgentMessage,
) -> Result<(), String> {
    let session_id = message.session_id.clone();

    // Set up abort channel
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

    // Spawn the agent execution in background
    let agent_state = state.inner().agents.clone();
    let window_clone = window.clone();
    let sid = session_id.clone();

    tokio::spawn(async move {
        let result = run_agent(sid.clone(), message, window_clone, abort_rx).await;

        // Mark agent as not running
        if let Ok(mut agents) = agent_state.lock() {
            if let Some(handle) = agents.sessions.get_mut(&sid) {
                handle.running = false;
            }
        }

        if let Err(e) = result {
            tracing::error!("Agent run error for session {}: {}", sid, e);
        }
    });

    Ok(())
}

/// Abort a running agent session.
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

/// Internal: execute the agent with streaming.
async fn run_agent(
    session_id: String,
    message: AgentMessage,
    window: tauri::Window,
    _abort_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    tokio::select! {
        _ = _abort_rx => {
            // Agent was aborted
            let _ = window.emit("agent:stream", AgentStreamChunk {
                session_id: session_id.clone(),
                payload: StreamPayload::Error {
                    message: "Agent aborted by user".into(),
                },
            });
            Ok(())
        }
        result = async {
            // TODO: Integrate with wth-agent / xai-grok-shell Agent runtime
            // For now, emit placeholder streaming chunks
            let chunks = vec![
                StreamPayload::TextDelta {
                    delta: format!("Processing: \"{}\"\n\n", message.content),
                },
                StreamPayload::TextDelta {
                    delta: "I am Wide Thought Host, your AI agent. ".into(),
                },
                StreamPayload::TextDelta {
                    delta: "The desktop integration is under active development.".into(),
                },
                StreamPayload::Done {
                    usage: Some(UsageInfo {
                        prompt_tokens: 42,
                        completion_tokens: 15,
                        total_tokens: 57,
                    }),
                },
            ];

            for chunk in chunks {
                let _ = window.emit("agent:stream", AgentStreamChunk {
                    session_id: session_id.clone(),
                    payload: chunk,
                });
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
            Ok::<_, String>(())
        } => { result }
    }
}
