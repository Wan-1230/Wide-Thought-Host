//! IPC commands for agent interaction.
//!
//! 流式调用 OpenAI 兼容的 chat/completions API，并在单次请求内完成
//! “模型声明工具 → 按权限模式确认 → 执行工具 → 回填结果”的多轮循环，
//! 直到模型产出最终回答或达到最大迭代轮数。

use crate::ipc::hooks;
use crate::ipc::tools::{self, ApprovalRequest};
use crate::state::{AgentHandle, AppState};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, State};
use tokio::sync::{mpsc, oneshot};

/// Incoming message from the frontend.
#[derive(Debug, Deserialize)]
pub struct AgentMessage {
    pub session_id: String,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    /// 本次请求附带的系统指令（技能 SKILL.md 等），仅单次请求生效
    #[serde(default)]
    pub system_instruction: Option<String>,
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
        /// 是否需要用户确认（前端据此显示允许/拒绝按钮）
        needs_approval: bool,
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

/// Agent 运行覆盖项（子智能体委派使用）。
#[derive(Debug, Clone, Default)]
pub struct AgentRunOverrides {
    /// 追加在 WTH 身份提示词之后的子智能体系统提示词
    pub system_prompt: Option<String>,
    /// 覆盖模型（空 = 跟随默认模型）
    pub model: Option<String>,
    /// 允许的工具名白名单（空 = 全部；MCP 工具始终放行）
    pub allowed_tools: Option<Vec<String>>,
    /// 后台运行：需要确认的工具自动拒绝（不回退执行）
    pub headless: bool,
}

// ─── Commands ──────────────────────────────────────────

#[tauri::command]
pub async fn agent_send(
    state: State<'_, AppState>,
    window: tauri::Window,
    message: AgentMessage,
) -> Result<(), String> {
    let session_id = message.session_id.clone();
    let (provider, api_key, workspace_root, edit_mode, reasoning_effort) = {
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
        let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
        (
            provider,
            api_key,
            workspace_root,
            settings.edit_mode.clone(),
            settings.reasoning_effort.clone(),
        )
    };
    let (abort_tx, abort_rx) = mpsc::channel(1);

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
    let approvals = state.inner().approvals.clone();
    let settings_ref = state.inner().settings.clone();
    let settings_path = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let mcp_manager = state.inner().mcp.clone();
    let window_clone = window.clone();
    let sid = session_id.clone();

    // Inject headroom proxy if enabled and running
    let (effective_base_url, upstream_headers) = {
        let hr_state = state.inner().headroom.clone();
        match hr_state.proxy_url() {
            Some(proxy_url) => {
                tracing::info!("Routing agent request through headroom proxy: {proxy_url}");
                let mut headers = HashMap::new();
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
            workspace_root,
            edit_mode,
            reasoning_effort,
            approvals,
            settings_ref,
            settings_path,
            mcp_manager,
            AgentRunOverrides::default(),
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
            let _ = tx.try_send(());
        }
        handle.running = false;
    }
    Ok(())
}

/// 用户批准某个待确认的工具调用。
#[tauri::command]
pub async fn agent_approve_tool(
    state: State<'_, AppState>,
    session_id: String,
    tool_call_id: String,
) -> Result<(), String> {
    send_approval(&state, &session_id, &tool_call_id, true)
}

/// 用户拒绝某个待确认的工具调用。
#[tauri::command]
pub async fn agent_deny_tool(
    state: State<'_, AppState>,
    session_id: String,
    tool_call_id: String,
) -> Result<(), String> {
    send_approval(&state, &session_id, &tool_call_id, false)
}

fn send_approval(
    state: &AppState,
    session_id: &str,
    tool_call_id: &str,
    approved: bool,
) -> Result<(), String> {
    let mut map = state.approvals.lock().map_err(|e| e.to_string())?;
    if let Some(list) = map.pending.get_mut(session_id) {
        if let Some(pos) = list.iter().position(|r| r.tool_call_id == tool_call_id) {
            let req = list.remove(pos);
            let _ = req.tx.send(approved);
            // Hooks：工具审批决议（fire-and-forget，失败不影响审批流程）
            if let (Ok(settings), Ok(workspace)) = (state.settings.read(), state.workspace_root.read()) {
                let trigger = if approved { "tool_approved" } else { "tool_denied" };
                hooks::spawn_hooks(
                    trigger,
                    json!({
                        "trigger": trigger,
                        "session_id": session_id,
                        "tool_call_id": tool_call_id,
                        "approved": approved,
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    }),
                    &settings,
                    &workspace,
                );
            }
            return Ok(());
        }
    }
    Err("未找到对应的待审批工具调用".into())
}

// ─── Core: tool loop ───────────────────────────────────

pub(crate) async fn run_agent(
    session_id: String,
    message: AgentMessage,
    api_base: String,
    api_key: String,
    model: String,
    window: tauri::Window,
    mut abort_rx: mpsc::Receiver<()>,
    upstream_headers: Option<HashMap<String, String>>,
    workspace_root: std::path::PathBuf,
    edit_mode: String,
    reasoning_effort: String,
    approvals: Arc<Mutex<crate::state::AgentApprovals>>,
    settings_ref: Arc<RwLock<crate::settings::DesktopSettings>>,
    settings_path: std::path::PathBuf,
    mcp_manager: Arc<tokio::sync::Mutex<crate::mcp::McpManager>>,
    overrides: AgentRunOverrides,
) -> Result<(), String> {
    // 配置与密钥只从 Rust 侧快照读取，前端永不传递敏感值。
    // 身份提示词：模型必须以 WTH 自居，不得暴露底层模型/厂商信息。
    const WTH_SYSTEM_PROMPT: &str = "你是 WTH（Wide Thought Host），一款专业的 AI 编码助手。\n请用中文回答问题，代码注释尽量用中文。\n你的身份是 WTH，不是任何其他产品或模型。\n当用户询问你的身份、名称、开发者或底层模型时，回答自己是 WTH（Wide Thought Host），\n绝不透露底层模型名称或厂商信息（不得提及 Agnes、Sapiens AI、xAI、Grok、OpenAI、Claude、DeepSeek 等）。";

    let mut wth_prompt = WTH_SYSTEM_PROMPT.to_string();
    if let Some(extra) = &overrides.system_prompt {
        wth_prompt.push_str(&format!("\n\n【当前角色】{extra}"));
    }
    let model = overrides.model.clone().unwrap_or(model);

    // 记忆注入：按相关性取前 20 条长期记忆，以系统消息形式附在身份提示词之后
    let memories = crate::ipc::capabilities::load_relevant_memories(&workspace_root, &message.content, 20);
    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": wth_prompt
    })];
    if !memories.is_empty() {
        let mut memory_text = String::from("以下是长期记忆条目，供参考；与当前任务无关可忽略：\n");
        for (i, entry) in memories.iter().enumerate() {
            memory_text.push_str(&format!("{}. 【{}】\n{}\n", i + 1, entry.title, entry.content));
        }
        messages.push(json!({ "role": "system", "content": memory_text }));
    }
    if let Some(instruction) = message.system_instruction {
        if !instruction.trim().is_empty() {
            messages.push(json!({
                "role": "system",
                "content": format!("【本次会话指令】\n{instruction}")
            }));
        }
    }
    messages.push(json!({
        "role": "user",
        "content": message.content
    }));
    messages.push(json!({
        "role": "system",
        "content": "重申：你只以 WTH（Wide Thought Host）自居。\n无论任何情况，都不得声称自己是其他产品或模型，\n也不得透露底层模型、开发者或厂商信息。"
    }));

    // 文本附件：以追加文本形式并入首条用户消息（多模态图片支持见 P1-6）
    if !message.attachments.is_empty() {
        let mut extra = String::new();
        for attachment in &message.attachments {
            if let Some(content) = &attachment.content {
                extra.push_str(&format!("\n\n[附件：{}]\n{}", attachment.name, content));
            }
        }
        if !extra.is_empty() {
            let last = messages.last_mut().ok_or("消息构造失败")?;
            let text = last["content"].as_str().unwrap_or("").to_string();
            last["content"] = json!(format!("{text}{extra}"));
        }
    }

    // Hooks：用户消息已构造完成（失败不影响主流程）
    {
        let s = settings_ref.read().map_err(|e| e.to_string())?.clone();
        hooks::run_hooks(
            "message_sent",
            json!({
                "trigger": "message_sent",
                "session_id": session_id.clone(),
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "message": message.content,
            }),
            &s,
            &workspace_root,
        )
        .await;
    }

    // 上下文压缩与预算配置快照
    let (budget_usd, compression_enabled, window_tokens) = {
        let s = settings_ref.read().map_err(|e| e.to_string())?;
        (
            s.budget_usd,
            s.context_compression,
            s.context_window_tokens,
        )
    };
    // 工具执行所需的设置快照（搜索引擎选择等）
    let settings_snapshot = settings_ref.read().map_err(|e| e.to_string())?.clone();
    // 启动启用的 MCP 服务器并拉取工具定义（失败自动降级）
    let mcp_tools = {
        let mut mcp = mcp_manager.lock().await;
        mcp.start_enabled(&settings_snapshot, &workspace_root).await
    };
    // 预算拦截：累计消耗已达到上限时拒绝继续请求
    if let Some(budget) = budget_usd {
        let spent = settings_ref
            .read()
            .map_err(|e| e.to_string())?
            .usage_stats
            .total_cost_usd;
        if spent >= budget {
            return Err(format!(
                "已达预算上限（累计 ${spent:.2} ≥ ${budget:.2}）。请前往“设置 → 预算”调整上限，或清除用量统计。"
            ));
        }
    }

    let mut usage_accum: Option<UsageInfo> = None;
    let mut compressed = false;

    for _iteration in 0..tools::MAX_TOOL_ITERATIONS {
        // 上下文压缩：接近窗口上限时，把早期对话压缩为摘要，保留最近消息
        if compression_enabled && !compressed {
            let threshold = (window_tokens as usize).saturating_mul(4);
            let total_len: usize = messages.iter().map(|m| m.to_string().len()).sum();
            if total_len > threshold && messages.len() > 6 {
                let (kept, history) = split_messages(&messages);
                if !history.is_empty() {
                    let summary =
                        summarize_history(&api_base, &api_key, &model, &history, &upstream_headers)
                            .await?;
                    let kept_count = kept.len();
                    let history_count = history.len();
                    let mut next: Vec<Value> = vec![json!({
                        "role": "system",
                        "content": format!("以下是更早对话的摘要（已被自动压缩）：\n{summary}")
                    })];
                    next.extend(kept);
                    messages = next;
                    compressed = true;
                    tracing::info!("Context compressed: kept {kept_count} messages, summarized {history_count}");
                }
            }
        }
        let mut all_tools = tools::build_tools();
        if let Some(allowed) = &overrides.allowed_tools {
            all_tools.retain(|t| {
                let name = t["function"]["name"].as_str().unwrap_or("").to_string();
                allowed.contains(&name) || name.starts_with("mcp__")
            });
        }
        all_tools.extend(mcp_tools.clone());
        let mut body = json!({
            "model": model,
            "messages": messages,
            "stream": true,
            "tools": all_tools,
            "tool_choice": "auto",
        });
        // P0-4：reasoning_effort 参数透传（非默认值时带上，避免干扰不支持的端点）
        if reasoning_effort != "high" {
            body["reasoning_effort"] = json!(reasoning_effort);
        }

        let url = format!("{}/chat/completions", api_base.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let mut req = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json");
        if let Some(headers) = &upstream_headers {
            for (k, v) in headers {
                req = req.header(k.as_str(), v.as_str());
            }
        }
        let resp = match req.json(&body).send().await {
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

        let (assistant_msg, tool_calls, usage) =
            collect_stream(resp, &window, &session_id, &mut abort_rx).await?;
        if let Some(u) = usage {
            usage_accum = Some(match usage_accum {
                Some(prev) => UsageInfo {
                    prompt_tokens: prev.prompt_tokens + u.prompt_tokens,
                    completion_tokens: prev.completion_tokens + u.completion_tokens,
                    total_tokens: prev.total_tokens + u.total_tokens,
                },
                None => u,
            });
        }

        messages.push(assistant_msg);

        if tool_calls.is_empty() {
            break;
        }

        for tc in &tool_calls {
            let needs = tools::needs_approval(&tc.name, &tc.arguments, &edit_mode);
            let _ = window.emit(
                "agent:stream",
                AgentStreamChunk {
                    session_id: session_id.clone(),
                    payload: StreamPayload::ToolCallStart {
                        tool_id: tc.id.clone(),
                        tool_name: tc.name.clone(),
                        arguments: tc.arguments.clone(),
                        needs_approval: needs,
                    },
                },
            );

            let approved = if needs {
                if overrides.headless {
                    // 后台运行无法交互确认，自动拒绝
                    false
                } else {
                    match wait_for_approval(
                    &approvals,
                    &window,
                    &session_id,
                    tc,
                    &mut abort_rx,
                )
                .await
                {
                        Ok(v) => v,
                        Err(e) => return Err(e),
                    }
                }
            } else {
                true
            };

            // 白名单运行时校验：模型不得调用允许范围外的工具
            if let Some(allowed) = &overrides.allowed_tools {
                if !allowed.contains(&tc.name) && !tc.name.starts_with("mcp__") {
                    let blocked = json!({ "error": "该工具不在当前子智能体的允许范围内，已拒绝" });
                    let _ = window.emit(
                        "agent:stream",
                        AgentStreamChunk {
                            session_id: session_id.clone(),
                            payload: StreamPayload::ToolCallEnd {
                                tool_id: tc.id.clone(),
                                result: blocked.clone(),
                            },
                        },
                    );
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": blocked.to_string(),
                    }));
                    continue;
                }
            }

            let (model_result, full_before, full_after) = if approved {
                let exec = if tc.name.starts_with("mcp__") {
                    tokio::select! {
                        r = async {
                            let mut mcp = mcp_manager.lock().await;
                            mcp.call(&tc.name, &tc.arguments)
                                .await
                                .map(tools::ToolOutput::plain)
                        } => r,
                        _ = abort_rx.recv() => return Err("已中止".into()),
                    }
                } else {
                    tokio::select! {
                        r = tools::execute_tool(&tc.name, &tc.arguments, &workspace_root, &settings_snapshot) => r,
                        _ = abort_rx.recv() => return Err("已中止".into()),
                    }
                };
                match exec {
                    Ok(output) => (output.model_result, output.full_before, output.full_after),
                    Err(e) => (json!({ "error": e }), None, None),
                }
            } else {
                (
                    json!({ "denied": true, "message": "用户拒绝了该操作" }),
                    None,
                    None,
                )
            };

            // 修改前后全文只随事件发给前端（diff 展示 / 撤销），不进模型上下文。
            let mut display_result = model_result.clone();
            if let Some(before) = &full_before {
                display_result["before_full"] = json!(before);
            }
            if let Some(after) = &full_after {
                display_result["after_full"] = json!(after);
            }
            let _ = window.emit(
                "agent:stream",
                AgentStreamChunk {
                    session_id: session_id.clone(),
                    payload: StreamPayload::ToolCallEnd {
                        tool_id: tc.id.clone(),
                        result: display_result,
                    },
                },
            );

            messages.push(json!({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": model_result.to_string(),
            }));
        }
    }

    // 更新用量统计（今日/本周/累计）并持久化
    if let Some(u) = &usage_accum {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let mut s = settings_ref.write().map_err(|e| e.to_string())?;
        let cost = u.total_tokens as f64 / 1_000_000.0 * s.price_per_million_tokens;
        let stats = &mut s.usage_stats;
        if stats.last_updated.as_deref() != Some(today.as_str()) {
            stats.today_tokens = 0;
            stats.today_cost_usd = 0.0;
        }
        if !is_same_week(stats.last_updated.as_deref(), Some(&today)) {
            stats.week_tokens = 0;
            stats.week_cost_usd = 0.0;
        }
        stats.last_updated = Some(today);
        stats.total_tokens = stats.total_tokens.saturating_add(u.total_tokens);
        stats.total_cost_usd += cost;
        stats.today_tokens = stats.today_tokens.saturating_add(u.total_tokens);
        stats.today_cost_usd += cost;
        stats.week_tokens = stats.week_tokens.saturating_add(u.total_tokens);
        stats.week_cost_usd += cost;
        let persisted = s.clone();
        drop(s);
        let _ = crate::settings::save_settings(&settings_path, &persisted);
    }

    // Hooks：响应完成（Done 事件前；失败不影响主流程）
    {
        let s = settings_ref.read().map_err(|e| e.to_string())?.clone();
        hooks::run_hooks(
            "agent_response_done",
            json!({
                "trigger": "agent_response_done",
                "session_id": session_id.clone(),
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "status": "done",
            }),
            &s,
            &workspace_root,
        )
        .await;
    }

    let _ = window.emit(
        "agent:stream",
        AgentStreamChunk {
            session_id,
            payload: StreamPayload::Done {
                usage: usage_accum,
            },
        },
    );
    Ok(())
}

// ─── Context compression & usage helpers ───────────────

/// 划分消息：保留全部 system 消息与最后 10 条对话消息，中间部分作为待压缩历史。
fn split_messages(messages: &[Value]) -> (Vec<Value>, Vec<Value>) {
    let mut kept: Vec<Value> = Vec::new();
    let mut history: Vec<Value> = Vec::new();
    let mut tail: Vec<Value> = Vec::new();
    let total = messages.len();
    for (i, m) in messages.iter().enumerate() {
        let role = m["role"].as_str().unwrap_or("");
        if role == "system" {
            kept.push(m.clone());
        } else if total - i <= 10 {
            tail.push(m.clone());
        } else {
            history.push(m.clone());
        }
    }
    if history.is_empty() {
        return (messages.to_vec(), Vec::new());
    }
    kept.extend(tail);
    (kept, history)
}

/// 调用模型把一段对话历史压缩为中文摘要（非流式）。
async fn summarize_history(
    api_base: &str,
    api_key: &str,
    model: &str,
    history: &[Value],
    upstream_headers: &Option<HashMap<String, String>>,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", api_base.trim_end_matches('/'));
    let history_json = serde_json::to_string(history).unwrap_or_default();
    let body = json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "请把以下对话历史压缩为简洁的中文摘要，保留关键决策、文件路径、错误信息、待办事项与结论。只输出摘要本身，不要任何前言。"
            },
            {
                "role": "user",
                "content": format!("对话历史（JSON 数组，每条含 role/content 或 tool 调用）：\n{}", history_json)
            }
        ],
        "stream": false,
    });
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json");
    if let Some(headers) = upstream_headers {
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("压缩请求失败: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("压缩请求错误 ({}): {}", status, err_body));
    }
    let parsed: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析压缩响应失败: {e}"))?;
    parsed["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "压缩响应缺少内容".into())
}

/// 判断两个 YYYY-MM-DD 日期是否在同一 ISO 周。
fn is_same_week(a: Option<&str>, b: Option<&str>) -> bool {
    use chrono::Datelike;
    let parse = |s: &str| -> Option<chrono::NaiveDate> {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
    };
    match (a.and_then(parse), b.and_then(parse)) {
        (Some(x), Some(y)) => {
            x.iso_week().year() == y.iso_week().year()
                && x.iso_week().week() == y.iso_week().week()
        }
        _ => true, // 缺省视为同一周，避免误重置
    }
}


// ─── Approval wait ─────────────────────────────────────

async fn wait_for_approval(
    approvals: &Arc<Mutex<crate::state::AgentApprovals>>,
    window: &tauri::Window,
    session_id: &str,
    tc: &CollectedToolCall,
    abort_rx: &mut mpsc::Receiver<()>,
) -> Result<bool, String> {
    let (tx, rx) = oneshot::channel();
    {
        let mut map = approvals.lock().map_err(|e| e.to_string())?;
        map.pending.entry(session_id.to_string()).or_default().push(ApprovalRequest {
            tool_call_id: tc.id.clone(),
            tx,
        });
    }
    let _ = window.emit(
        "agent:approval",
        json!({
            "session_id": session_id,
            "tool_id": tc.id,
            "tool_name": tc.name,
            "arguments": tc.arguments,
        }),
    );
    tokio::select! {
        r = rx => r.map_err(|_| "审批通道已关闭".into()),
        _ = abort_rx.recv() => Err("已中止".into()),
        _ = tokio::time::sleep(std::time::Duration::from_secs(300)) => Err("审批等待超时（5 分钟）".into()),
    }
}

// ─── Stream collection ─────────────────────────────────

struct CollectedToolCall {
    id: String,
    name: String,
    arguments: Value,
}

fn parse_usage(v: &Value) -> Option<UsageInfo> {
    if v.get("total_tokens").is_none() && v.get("prompt_tokens").is_none() {
        return None;
    }
    Some(UsageInfo {
        prompt_tokens: v["prompt_tokens"].as_u64().unwrap_or(0),
        completion_tokens: v["completion_tokens"].as_u64().unwrap_or(0),
        total_tokens: v["total_tokens"].as_u64().unwrap_or(0),
    })
}

/// 读取 SSE 流，实时回传文本增量，并在结束时返回：
/// 完整的 assistant 消息、已收集的工具调用列表、usage（若服务端返回）。
async fn collect_stream(
    resp: reqwest::Response,
    window: &tauri::Window,
    session_id: &str,
    abort_rx: &mut mpsc::Receiver<()>,
) -> Result<(Value, Vec<CollectedToolCall>, Option<UsageInfo>), String> {
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut assistant_content = String::new();
    // 按 index 对齐的工具调用片段
    let mut raw_calls: Vec<RawToolCall> = Vec::new();
    let mut usage: Option<UsageInfo> = None;
    let mut done = false;

    loop {
        let chunk = tokio::select! {
            r = stream.next() => r,
            _ = abort_rx.recv() => return Err("已中止".into()),
        };
        let Some(chunk_result) = chunk else { break };
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => return Err(format!("流读取错误: {}", e)),
        };

        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }
            if line == "data: [DONE]" {
                done = true;
                break;
            }
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    if let Some(u) = parsed.get("usage") {
                        if let Some(parsed_usage) = parse_usage(u) {
                            usage = Some(parsed_usage);
                        }
                    }
                    if let Some(choices) = parsed["choices"].as_array() {
                        for choice in choices {
                            if let Some(delta) = choice["delta"]["content"].as_str() {
                                if !delta.is_empty() {
                                    assistant_content.push_str(delta);
                                    let _ = window.emit(
                                        "agent:stream",
                                        AgentStreamChunk {
                                            session_id: session_id.to_string(),
                                            payload: StreamPayload::TextDelta {
                                                delta: delta.to_string(),
                                            },
                                        },
                                    );
                                }
                            }
                            if let Some(tcs) = choice["delta"]["tool_calls"].as_array() {
                                for tc in tcs {
                                    let index = tc["index"].as_u64().unwrap_or(0) as usize;
                                    while raw_calls.len() <= index {
                                        raw_calls.push(RawToolCall::default());
                                    }
                                    if let Some(id) = tc["id"].as_str() {
                                        raw_calls[index].id = Some(id.to_string());
                                    }
                                    if let Some(name) = tc["function"]["name"].as_str() {
                                        raw_calls[index].name = Some(name.to_string());
                                    }
                                    if let Some(args) = tc["function"]["arguments"].as_str() {
                                        raw_calls[index].arguments.push_str(args);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if done {
            break;
        }
    }

    // 组装 assistant 消息（含完整 tool_calls）
    let completed: Vec<CollectedToolCall> = raw_calls
        .into_iter()
        .filter(|tc| tc.id.is_some() || tc.name.is_some())
        .map(|tc| CollectedToolCall {
            id: tc.id.unwrap_or_default(),
            name: tc.name.unwrap_or_default(),
            arguments: serde_json::from_str(&tc.arguments).unwrap_or(Value::Null),
        })
        .collect();

    let mut assistant = json!({ "role": "assistant", "content": assistant_content });
    if !completed.is_empty() {
        assistant["tool_calls"] = Value::Array(
            completed
                .iter()
                .map(|tc| {
                    json!({
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": tc.arguments.to_string(),
                        }
                    })
                })
                .collect(),
        );
        if assistant_content.is_empty() {
            assistant["content"] = Value::Null;
        }
    }

    Ok((assistant, completed, usage))
}

#[derive(Default)]
struct RawToolCall {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
}

