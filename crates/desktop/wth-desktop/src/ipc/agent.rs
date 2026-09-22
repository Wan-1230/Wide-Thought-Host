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
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};

/// 前端回传的历史对话消息（多轮上下文）。
#[derive(Debug, Clone, Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
}

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
    /// 历史对话（当前消息之前的 user/assistant 对），保持多轮上下文
    #[serde(default)]
    pub history: Vec<HistoryMessage>,
}

#[derive(Debug, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub path: Option<String>,
    pub content: Option<String>,
    pub mime_type: String,
    /// 图片类附件的 base64 data URL（多模态）
    #[serde(default)]
    pub data_url: Option<String>,
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
    /// U-03: 长任务阶段提示（working / checking / verifying），无业务载荷。
    Phase {
        phase: String,
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
    // A-01: 内核桥接开关 —— 开启时优先经 ACP 驱动 CLI Agent 内核（工具
    // 调用、审批、技能走内核全量生态），失败自动回退自研循环。
    let kernel_enabled = state
        .settings
        .read()
        .map(|s| s.kernel_agent)
        .unwrap_or(false);
    if kernel_enabled {
        match super::acp_bridge::ensure_connected(&state, &window).await {
            Ok(kernel) => {
                // ensure_connected 已落句柄，中止/审批在 prompt 进行中可用。
                let result = kernel.send_prompt(&message.content).await;
                match result {
                    Ok(()) => {
                        let _ = window.emit(
                            "agent:stream",
                            AgentStreamChunk {
                                session_id: session_id.clone(),
                                payload: StreamPayload::Done { usage: None },
                            },
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        let _ = window.emit(
                            "agent:stream",
                            AgentStreamChunk {
                                session_id: session_id.clone(),
                                payload: StreamPayload::Error {
                                    message: actionable_error(&e),
                                },
                            },
                        );
                        return Ok(());
                    }
                }
            }
            Err(e) => {
                tracing::warn!("内核桥接不可用，回退自研循环: {e}");
            }
        }
    }
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
        // 本地模型（Ollama / vLLM，F-01）无需 API Key；云端 Provider 必须
        // 已在凭据管理器中配置 Key。
        let api_key = if provider.local {
            String::new()
        } else {
            crate::credentials::read_secret("provider", provider_id)?.ok_or_else(|| {
                "请先在设置中配置 API Key，或在设置 → 模型与 API 中检测并使用本地模型（Ollama/vLLM）"
                    .to_string()
            })?
        };
        let workspace_root = state
            .workspace_root
            .read()
            .map_err(|e| e.to_string())?
            .clone();
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
    let log_buffer = state.inner().log_buffer.clone();
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

    // F-06: 解析 fallback 链（设置中的备用 Provider 顺序）
    let fallback_chain: Vec<FallbackEndpoint> = {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        resolve_fallback_chain(&settings, &provider.id)?
    };

    tokio::spawn(async move {
        let result = run_agent(
            sid.clone(),
            message,
            effective_base_url,
            api_key,
            provider.model,
            fallback_chain,
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
            crate::state::push_log(&log_buffer, "ERROR", &format!("会话 {sid} 运行失败：{e}"));
            let _ = window.emit(
                "agent:stream",
                AgentStreamChunk {
                    session_id: sid.clone(),
                    payload: StreamPayload::Error {
                        message: actionable_error(&e),
                    },
                },
            );
        } else {
            crate::state::push_log(&log_buffer, "INFO", &format!("会话 {sid} 完成"));
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn agent_abort(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    // A-01: 内核会话取消（session/cancel 通知）。
    if let Ok(guard) = state.acp.try_lock()
        && let Some(kernel) = guard.as_ref()
    {
        let _ = kernel.cancel();
    }
    let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = agents.sessions.get_mut(&session_id) {
        if let Some(tx) = handle.abort_tx.take() {
            let _ = tx.try_send(());
        }
        handle.running = false;
    }
    Ok(())
}

// ─── F-05: 测试验证循环 ─────────────────────────────────────────────────────

/// 验证命令超时（10 分钟，长测试套件友好）。
const VERIFY_TIMEOUT_SECS: u64 = 600;
/// 回注模型的失败输出截断长度。
const VERIFY_OUTPUT_CHARS: usize = 4_000;

/// 在工作区根目录执行验证命令；退出码非 0 返回失败输出（尾部截断）。
async fn run_verification(cwd: &std::path::Path, cmd: &str) -> Result<(), String> {
    let shell = if cfg!(windows) { "cmd" } else { "sh" };
    let shell_args: Vec<&str> = if cfg!(windows) {
        vec!["/C", cmd]
    } else {
        vec!["-c", cmd]
    };
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(VERIFY_TIMEOUT_SECS),
        tokio::process::Command::new(shell)
            .args(&shell_args)
            .current_dir(cwd)
            .output(),
    )
    .await
    .map_err(|_| format!("验证命令超时（{VERIFY_TIMEOUT_SECS}s）: {cmd}"))?
    .map_err(|e| format!("验证命令启动失败: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    let tail: String = {
        let chars: Vec<char> = text.chars().collect();
        let start = chars.len().saturating_sub(VERIFY_OUTPUT_CHARS);
        chars[start..].iter().collect()
    };
    Err(format!(
        "exit code: {:?}
{}",
        output.status.code(),
        tail.trim()
    ))
}

/// 手动运行验证命令（诊断/演示用；自动循环见 agent_send 主流程）。
#[tauri::command]
pub async fn verify_run(state: State<'_, AppState>, cmd: String) -> Result<String, String> {
    let ws = state
        .workspace_root
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    run_verification(&ws, cmd.trim())
        .await
        .map(|_| "✅ 测试通过".to_string())
}

// ─── F-06: 模型调度（fallback 链） ──────────────────────────────────────────

/// fallback 链上的一个端点（主端点降级候选）。
#[derive(Debug, Clone)]
pub struct FallbackEndpoint {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
    pub price_input: Option<f64>,
    pub price_output: Option<f64>,
}

/// 当前请求使用的端点（含计价覆盖）。
#[derive(Debug, Clone)]
struct ActiveEndpoint {
    api_base: String,
    api_key: String,
    model: String,
    price_input: Option<f64>,
    price_output: Option<f64>,
}

/// F-06: 按设置解析 fallback 链（跳过停用/主端点自身/无 Key 的云端备用）。
pub(crate) fn resolve_fallback_chain(
    settings: &crate::settings::DesktopSettings,
    exclude_provider_id: &str,
) -> Result<Vec<FallbackEndpoint>, String> {
    let mut chain = Vec::new();
    for fid in &settings.fallback_provider_ids {
        let Some(p) = settings
            .providers
            .iter()
            .find(|p| p.id == *fid && p.enabled)
        else {
            continue;
        };
        if p.id == exclude_provider_id {
            continue; // 主端点自身不重复入链
        }
        let key = if p.local {
            String::new()
        } else {
            crate::credentials::read_secret("provider", &p.id)?.unwrap_or_default()
        };
        if !p.local && key.is_empty() {
            continue; // 无 Key 的云端备用没有意义
        }
        chain.push(FallbackEndpoint {
            api_base: p.base_url.clone(),
            api_key: key,
            model: p.model.clone(),
            price_input: p.price_input,
            price_output: p.price_output,
        });
    }
    Ok(chain)
}

fn endpoint_of(e: &FallbackEndpoint) -> ActiveEndpoint {
    ActiveEndpoint {
        api_base: e.api_base.clone(),
        api_key: e.api_key.clone(),
        model: e.model.clone(),
        price_input: e.price_input,
        price_output: e.price_output,
    }
}

/// 可降级错误：传输失败与 5xx/429；4xx（配置/权限类）不降级。
fn is_fallback_eligible(err: &str) -> bool {
    if err.starts_with("请求失败") {
        return true; // 传输层错误（重试耗尽）
    }
    if let Some(rest) = err.strip_prefix("API 错误 (") {
        if let Some(code) = rest.split(')').next().and_then(|c| c.parse::<u16>().ok()) {
            return code == 429 || code >= 500;
        }
    }
    false
}

/// 错误摘要（事件流展示用）。
fn short_err(err: &str) -> String {
    err.chars().take(120).collect()
}

/// 按激活模型覆盖请求体的 model 字段。
fn body_with_model(body: &Value, model: &str) -> Value {
    let mut b = body.clone();
    b["model"] = json!(model);
    b
}

/// 用户批准某个待确认的工具调用。
#[tauri::command]
pub async fn agent_approve_tool(
    state: State<'_, AppState>,
    session_id: String,
    tool_call_id: String,
) -> Result<(), String> {
    // A-01: 内核权限请求（session/request_permission）优先桥接。
    {
        let guard = state.acp.lock().await;
        if let Some(kernel) = guard.as_ref()
            && kernel.respond_permission(&tool_call_id, true).await.is_ok()
        {
            return Ok(());
        }
    }
    send_approval(&state, &session_id, &tool_call_id, true)
}

/// 用户拒绝某个待确认的工具调用。
#[tauri::command]
pub async fn agent_deny_tool(
    state: State<'_, AppState>,
    session_id: String,
    tool_call_id: String,
) -> Result<(), String> {
    // A-01: 内核权限请求（session/request_permission）优先桥接。
    {
        let guard = state.acp.lock().await;
        if let Some(kernel) = guard.as_ref()
            && kernel
                .respond_permission(&tool_call_id, false)
                .await
                .is_ok()
        {
            return Ok(());
        }
    }
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
            if let (Ok(settings), Ok(workspace)) =
                (state.settings.read(), state.workspace_root.read())
            {
                let trigger = if approved {
                    "tool_approved"
                } else {
                    "tool_denied"
                };
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
    // F-06: 备用模型链（主端点 5xx/429/网络错误时按序降级）；空 = 禁用。
    fallback_chain: Vec<FallbackEndpoint>,
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
) -> Result<String, String> {
    // 配置与密钥只从 Rust 侧快照读取，前端永不传递敏感值。
    // 身份提示词：模型必须以 WTH 自居，不得暴露底层模型/厂商信息。
    const WTH_SYSTEM_PROMPT: &str = "你是 WTH（Wide Thought Host），一款专业的 AI 编码助手。\n请用中文回答问题，代码注释尽量用中文。\n你的身份是 WTH，不是任何其他产品或模型。\n当用户询问你的身份、名称、开发者或底层模型时，回答自己是 WTH（Wide Thought Host），\n绝不透露底层模型名称或厂商信息（不得提及 Agnes、Sapiens AI、xAI、Grok、OpenAI、Claude、DeepSeek 等）。";

    let mut wth_prompt = WTH_SYSTEM_PROMPT.to_string();
    if let Some(extra) = &overrides.system_prompt {
        wth_prompt.push_str(&format!("\n\n【当前角色】{extra}"));
    }
    let model = overrides.model.clone().unwrap_or(model);

    // 记忆注入：按相关性取前 20 条长期记忆，以系统消息形式附在身份提示词之后
    let memories =
        crate::ipc::capabilities::load_relevant_memories(&workspace_root, &message.content, 20);
    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": wth_prompt
    })];
    if !memories.is_empty() {
        let mut memory_text = String::from("以下是长期记忆条目，供参考；与当前任务无关可忽略：\n");
        for (i, entry) in memories.iter().enumerate() {
            memory_text.push_str(&format!(
                "{}. 【{}】\n{}\n",
                i + 1,
                entry.title,
                entry.content
            ));
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
    // 历史上下文：按序回填之前的 user/assistant 消息（只保留 text 内容）
    for h in &message.history {
        let role = h.role.as_str();
        if matches!(role, "user" | "assistant") && !h.content.is_empty() {
            messages.push(json!({ "role": role, "content": h.content }));
        }
    }
    // 附件：文本拼接入用户消息；图片转多模态内容块
    let mut user_text = message.content;
    let mut image_blocks: Vec<Value> = Vec::new();
    let mut text_extra = String::new();
    let mut image_count = 0usize;
    for attachment in &message.attachments {
        if let Some(data_url) = &attachment.data_url {
            image_count += 1;
            image_blocks.push(json!({
                "type": "image_url",
                "image_url": { "url": data_url }
            }));
        } else {
            // 优先使用直接传入的 content；否则尝试从 path 读取文件内容
            let resolved = if let Some(content) = &attachment.content {
                content.clone()
            } else if let Some(path) = &attachment.path {
                std::fs::read_to_string(path)
                    .unwrap_or_else(|e| format!("（无法读取附件 {path}: {e}）"))
            } else {
                String::new()
            };
            if !resolved.is_empty() {
                text_extra.push_str(&format!(
                    "\n\n[附件：{}]（{}）\n{}",
                    attachment.name, attachment.mime_type, resolved
                ));
            }
        }
    }
    if !text_extra.is_empty() {
        user_text.push_str(&text_extra);
    }
    if image_blocks.is_empty() {
        messages.push(json!({ "role": "user", "content": user_text }));
    } else {
        let mut content_array = vec![json!({ "type": "text", "text": user_text })];
        content_array.extend(image_blocks);
        messages.push(json!({ "role": "user", "content": content_array }));
        if image_count > 0 {
            tracing::info!("发送 {image_count} 张图片附件（多模态）；若模型不支持视觉将报错提示");
        }
    }
    messages.push(json!({
        "role": "system",
        "content": "重申：你只以 WTH（Wide Thought Host）自居。\n无论任何情况，都不得声称自己是其他产品或模型，\n也不得透露底层模型、开发者或厂商信息。"
    }));

    // Hooks：用户消息已构造完成（失败不影响主流程）
    {
        let s = settings_ref.read().map_err(|e| e.to_string())?.clone();
        hooks::run_hooks(
            "message_sent",
            json!({
                "trigger": "message_sent",
                "session_id": session_id.clone(),
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "message": user_text.clone(),
            }),
            &s,
            &workspace_root,
        )
        .await;
    }

    // 上下文压缩与预算配置快照
    let (budget_usd, compression_enabled, window_tokens, compaction_ratio, summary_model) = {
        let s = settings_ref.read().map_err(|e| e.to_string())?;
        let ratio = s.compaction_ratio_percent.clamp(30, 85);
        (
            s.budget_usd,
            s.context_compression,
            s.context_window_tokens,
            ratio,
            s.summary_model.clone(),
        )
    };
    // F-05: 测试验证循环配置快照
    let (test_cmd, verify_max_rounds) = {
        let s = settings_ref.read().map_err(|e| e.to_string())?;
        (s.test_cmd.clone(), s.verify_max_rounds)
    };
    let mut verification_pending = false;
    let mut verify_round: u32 = 0;
    // G12：网络配置快照（代理 / 超时 / 重试）
    let network = settings_ref
        .read()
        .map_err(|e| e.to_string())?
        .network
        .clone();
    let http_client = build_http_client(&network)?;
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
    // C-02: 单会话预算
    let session_budget = settings_ref
        .read()
        .map_err(|e| e.to_string())?
        .session_budget_usd;
    let mut session_cost = 0.0f64;

    let mut usage_accum: Option<UsageInfo> = None;

    // U-02: 会话内已批准命令免再次确认（危险/敏感操作不入缓存）
    let session_allowlist: std::sync::Arc<std::sync::RwLock<std::collections::HashSet<String>>> =
        std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashSet::new()));

    // S-02: 崩溃续跑 — 启动时写 running 标记，正常结束清除；
    // 异常退出后下次启动可检测到 interrupted 标记。
    let crash_marker = {
        let Ok(app_dir) = window.app_handle().path().app_data_dir() else {
            return Err("无法定位应用数据目录".into());
        };
        let marker = app_dir.join("agent-running.json");
        let payload = serde_json::json!({
            "session_id": session_id,
            "pid": std::process::id(),
            "started_at": chrono::Utc::now().to_rfc3339(),
            "model": model,
        });
        let _ = std::fs::create_dir_all(&app_dir);
        if std::fs::write(&marker, payload.to_string()).is_err() {
            tracing::warn!("failed to write crash marker");
        }
        // O-01: 会话开始事件
        crate::audit::log_run_event(
            &app_dir.join("events.jsonl"),
            &session_id,
            "session_start",
            Some(serde_json::json!({ "model": model })),
        );
        marker
    };
    // 清理标记的 RAII 守卫
    struct CrashGuard(std::path::PathBuf);
    impl Drop for CrashGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _crash_guard = CrashGuard(crash_marker);

    // F-06: 激活端点（主端点失败时沿 fallback 链降级，粘滞生效）。
    // chain_all[0] 为主端点，其余为备用；chain_pos 指向当前使用的位置。
    let mut chain_all: Vec<ActiveEndpoint> = vec![ActiveEndpoint {
        api_base: api_base.clone(),
        api_key: api_key.clone(),
        model: model.clone(),
        price_input: None,
        price_output: None,
    }];
    for e in &fallback_chain {
        chain_all.push(endpoint_of(e));
    }
    let mut chain_pos: usize = 0;
    let mut active = chain_all[0].clone();

    for _iteration in 0..tools::MAX_TOOL_ITERATIONS {
        // 上下文压缩：按窗口比例触发，保留 system + 近尾，压缩早期对话。
        // 允许再次压缩（压缩后仍超阈值时继续），对齐内核 CompactionPolicy。
        if compression_enabled {
            let threshold =
                (window_tokens as usize).saturating_mul(compaction_ratio as usize) / 100;
            // chars ≈ tokens * 3.5，留余量避免在边界抖动
            let threshold_chars = threshold.saturating_mul(7) / 2;
            let total_len: usize = messages.iter().map(|m| m.to_string().len()).sum();
            if total_len > threshold_chars && messages.len() > 8 {
                let (kept, history) = split_messages(&messages);
                if !history.is_empty() {
                    let summary_model_ref = summary_model.as_deref().unwrap_or(&model);
                    // S-04: 压缩失败降级——摘要请求失败时保留原消息继续会话，
                    // 绝不因压缩错误中断本轮工具循环。
                    match summarize_history(
                        &api_base,
                        &api_key,
                        summary_model_ref,
                        &history,
                        &upstream_headers,
                        &network,
                    )
                    .await
                    {
                        Ok(summary) => {
                            let kept_count = kept.len();
                            let history_count = history.len();
                            let mut next: Vec<Value> = vec![json!({
                                "role": "system",
                                "content": format!("以下是更早对话的摘要（已被自动压缩）：\n{summary}")
                            })];
                            next.extend(kept);
                            messages = next;
                            if let Ok(mut s) = settings_ref.write() {
                                s.usage_stats.compaction_count =
                                    s.usage_stats.compaction_count.saturating_add(1);
                            }
                            tracing::info!(
                                "Context compressed: kept {kept_count}, summarized {history_count}, model={summary_model_ref}"
                            );
                        }
                        Err(e) => {
                            if let Ok(mut s) = settings_ref.write() {
                                s.usage_stats.compaction_failures =
                                    s.usage_stats.compaction_failures.saturating_add(1);
                            }
                            tracing::warn!(
                                "Context compression failed (continuing without compact): {e}"
                            );
                        }
                    }
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
        // U-03: 进入模型等待
        let _ = window.emit(
            "agent:stream",
            AgentStreamChunk {
                session_id: session_id.clone(),
                payload: StreamPayload::Phase {
                    phase: "working".into(),
                },
            },
        );
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

        // F-06: 沿激活端点发送；可降级错误（5xx/429/传输错误）按链降级。
        let resp = loop {
            let url = format!("{}/chat/completions", active.api_base.trim_end_matches('/'));
            // P-07: 网络出口白名单
            {
                let allow = settings_ref
                    .read()
                    .map(|s| s.network_allowlist.clone())
                    .unwrap_or_default();
                if !url_allowed(&url, &allow) {
                    return Err(actionable_error(&format!(
                        "目标端点不在网络白名单内：{url}。请到设置中添加允许的域名。"
                    )));
                }
            }
            // G12：代理 / 超时 / 自动重试
            let mut headers: Vec<(String, String)> = vec![
                (
                    "Authorization".to_string(),
                    format!("Bearer {}", active.api_key),
                ),
                ("Content-Type".to_string(), "application/json".to_string()),
            ];
            if let Some(hs) = &upstream_headers {
                for (k, v) in hs {
                    headers.push((k.clone(), v.clone()));
                }
            }
            let body = body_with_model(&body, &active.model);
            match send_json_with_retry(
                &http_client,
                &url,
                &headers,
                &body,
                network.retry_enabled,
                network.retry_max,
            )
            .await
            {
                Ok(r) => break r,
                Err(e) => {
                    if chain_pos + 1 < chain_all.len() && is_fallback_eligible(&e) {
                        chain_pos += 1;
                        active = chain_all[chain_pos].clone();
                        let _ = window.emit(
                            "agent:stream",
                            AgentStreamChunk {
                                session_id: session_id.clone(),
                                payload: StreamPayload::TextDelta {
                                    delta: format!(
                                        "\n[模型调度] 当前端点不可用（{}），切换到备用模型 {}\n",
                                        short_err(&e),
                                        active.model
                                    ),
                                },
                            },
                        );
                        continue;
                    }
                    return Err(e);
                }
            }
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
            // F-05: 本轮发生过代码编辑且配置了测试命令 → 自动运行测试；
            // 失败把输出回注模型进入修复循环（受 verify_max_rounds 约束）。
            if verification_pending && verify_round < verify_max_rounds {
                if let Some(test_cmd) = test_cmd.as_deref().map(str::trim).filter(|c| !c.is_empty())
                {
                    verification_pending = false;
                    verify_round += 1;
                    let _ = window.emit(
                        "agent:stream",
                        AgentStreamChunk {
                            session_id: session_id.clone(),
                            payload: StreamPayload::TextDelta {
                                delta: format!(
                                    "

[验证 第{verify_round}/{verify_max_rounds}轮] 运行 {test_cmd} …
"
                                ),
                            },
                        },
                    );
                    match run_verification(&workspace_root, test_cmd).await {
                        Ok(()) => {
                            let _ = window.emit(
                                "agent:stream",
                                AgentStreamChunk {
                                    session_id: session_id.clone(),
                                    payload: StreamPayload::TextDelta {
                                        delta: "[验证] ✅ 测试通过
"
                                        .to_string(),
                                    },
                                },
                            );
                            break;
                        }
                        Err(failure) => {
                            let _ = window.emit(
                                "agent:stream",
                                AgentStreamChunk {
                                    session_id: session_id.clone(),
                                    payload: StreamPayload::TextDelta {
                                        delta: "[验证] ❌ 测试失败，进入自动修复
"
                                        .to_string(),
                                    },
                                },
                            );
                            messages.push(json!({
                                "role": "user",
                                "content": format!(
                                    "自动测试验证失败（第 {verify_round}/{verify_max_rounds} 轮）。请修复代码；我会在你完成后继续运行该测试。

命令: {test_cmd}

失败输出:
{failure}"
                                ),
                            }));
                            continue;
                        }
                    }
                }
            }
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
                    // U-02: 会话内已允许的同类命令免再次确认（仅非危险命令）
                    let already_allowed = {
                        let cmd_key = if tc.name == "bash" {
                            tc.arguments
                                .get("command")
                                .and_then(|v| v.as_str())
                                .map(|c| format!("bash:{}", c.trim()))
                        } else if tc.name == "file_delete" {
                            tc.arguments
                                .get("path")
                                .and_then(|v| v.as_str())
                                .map(|p| format!("file_delete:{p}"))
                        } else {
                            None
                        };
                        let dangerous = tc.name == "bash"
                            && tools::is_dangerous_shell(
                                tc.arguments
                                    .get("command")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(""),
                            );
                        let sensitive = tc.name == "file_delete"
                            && tools::is_sensitive_path(
                                tc.arguments
                                    .get("path")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(""),
                            );
                        match cmd_key {
                            Some(k) if !dangerous && !sensitive => session_allowlist
                                .read()
                                .map(|s| s.contains(&k))
                                .unwrap_or(false),
                            _ => false,
                        }
                    };
                    if already_allowed {
                        true
                    } else {
                        match wait_for_approval(&approvals, &window, &session_id, tc, &mut abort_rx)
                            .await
                        {
                            Ok(v) => {
                                if v && let Some(key) = session_cmd_key(tc) {
                                    if let Ok(mut set) = session_allowlist.write() {
                                        set.insert(key);
                                    }
                                }
                                v
                            }
                            Err(e) => return Err(e),
                        }
                    }
                }
            } else {
                true
            };

            // P-02: 审计 — 需确认的工具调用写入本地 audit.jsonl
            if needs {
                let dangerous = tc.name == "bash"
                    && tools::is_dangerous_shell(
                        tc.arguments
                            .get("command")
                            .and_then(|v| v.as_str())
                            .unwrap_or(""),
                    );
                if let Some(app_dir) = window.app_handle().path().app_data_dir().ok() {
                    crate::audit::record_approval(
                        &app_dir.join("audit.jsonl"),
                        &session_id,
                        &tc.name,
                        &tc.arguments,
                        approved,
                        dangerous,
                    );
                }
            }

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

            // U-03: 工具批次执行
            let _ = window.emit(
                "agent:stream",
                AgentStreamChunk {
                    session_id: session_id.clone(),
                    payload: StreamPayload::Phase {
                        phase: "checking".into(),
                    },
                },
            );

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
                    Ok(output) => {
                        // F-05: 编辑类工具（含前后全文的 file_edit 与 file_write）
                        // 成功执行后标记待验证。
                        if output.full_before.is_some()
                            || output.full_after.is_some()
                            || matches!(tc.name.as_str(), "file_write" | "file_edit")
                        {
                            verification_pending = true;
                        }
                        if let Ok(mut s) = settings_ref.write() {
                            s.usage_stats.tool_calls_ok =
                                s.usage_stats.tool_calls_ok.saturating_add(1);
                        }
                        (output.model_result, output.full_before, output.full_after)
                    }
                    Err(e) => {
                        if let Ok(mut s) = settings_ref.write() {
                            s.usage_stats.tool_calls_fail =
                                s.usage_stats.tool_calls_fail.saturating_add(1);
                        }
                        (json!({ "error": e }), None, None)
                    }
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
        // U-02/F-06: 输入/输出分价计费 —— 激活模型自带价格优先，其次全局
        // 分价，最后回退全局统一价。
        let (input_price, output_price) = match (active.price_input, active.price_output) {
            (Some(i), Some(o)) => (i, o),
            (i, o) => (
                i.unwrap_or(s.price_per_million_tokens),
                o.unwrap_or_else(|| {
                    s.price_per_million_output_tokens
                        .unwrap_or(s.price_per_million_tokens)
                }),
            ),
        };
        let cost = u.prompt_tokens as f64 / 1_000_000.0 * input_price
            + u.completion_tokens as f64 / 1_000_000.0 * output_price;
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
        // C-01: 模型/会话维度归因
        stats.record_turn(&session_id, &active.model, u.total_tokens, cost);
        session_cost += cost;
        // C-02: 单会话预算超限 — 在写完用量后返回可行动错误
        if let Some(cap) = session_budget
            && cap > 0.0
            && session_cost >= cap
        {
            let _ = window.emit(
                "agent:stream",
                AgentStreamChunk {
                    session_id: session_id.clone(),
                    payload: StreamPayload::Error {
                        message: actionable_error(&format!(
                            "本会话已达预算上限（${session_cost:.2} ≥ ${cap:.2}）。可在设置中调整「单会话预算」。"
                        )),
                    },
                },
            );
        }
        let persisted = s.clone();
        drop(s);
        let _ = crate::settings::save_settings(&settings_path, &persisted);
    }

    // F-02: 任务运行摘要落盘（成本/工具/模型），便于回放与诊断
    {
        if let Ok(app_dir) = window.app_handle().path().app_data_dir() {
            let tasks_dir = app_dir.join("tasks");
            let _ = std::fs::create_dir_all(&tasks_dir);
            let summary = serde_json::json!({
                "session_id": session_id,
                "model": active.model,
                "finished_at": chrono::Utc::now().to_rfc3339(),
                "usage": usage_accum.as_ref().map(|u| serde_json::json!({
                    "prompt_tokens": u.prompt_tokens,
                    "completion_tokens": u.completion_tokens,
                    "total_tokens": u.total_tokens,
                })),
            });
            let name = format!(
                "task-{}-{}.json",
                chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
                &session_id[..session_id.len().min(8)]
            );
            let _ = std::fs::write(tasks_dir.join(name), summary.to_string());
            // O-01: 会话结束事件
            crate::audit::log_run_event(
                &app_dir.join("events.jsonl"),
                &session_id,
                "session_end",
                Some(summary),
            );
        }
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
            payload: StreamPayload::Done { usage: usage_accum },
        },
    );
    // 提取最终回复文本（供工作流编排等场景使用）
    let final_text = messages
        .iter()
        .rev()
        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("assistant"))
        .and_then(|m| m.get("content").and_then(|v| v.as_str()))
        .unwrap_or_default()
        .to_string();
    Ok(final_text)
}

// ─── Context compression & usage helpers ───────────────

/// 划分消息：保留全部 system 消息与近尾（约 16% 非 system 消息，至少 8 条），
/// 中间部分作为待压缩历史。对齐 Reasonix 缓存友好保留策略。
fn split_messages(messages: &[Value]) -> (Vec<Value>, Vec<Value>) {
    let mut kept: Vec<Value> = Vec::new();
    let mut history: Vec<Value> = Vec::new();
    let mut tail: Vec<Value> = Vec::new();
    let total = messages.len();
    // 至少保留 8 条近尾；窗口较大时按 ~16% 保留，避免压缩后丢上下文。
    let keep_tail = {
        let non_system = messages
            .iter()
            .filter(|m| m["role"].as_str() != Some("system"))
            .count();
        (non_system.saturating_mul(16) / 100).max(8)
    };
    for (i, m) in messages.iter().enumerate() {
        let role = m["role"].as_str().unwrap_or("");
        if role == "system" {
            kept.push(m.clone());
        } else if total - i <= keep_tail {
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

/// U-02: 生成会话内免确认缓存键（仅非危险 bash / 非敏感删除）。
fn session_cmd_key(tc: &CollectedToolCall) -> Option<String> {
    match tc.name.as_str() {
        "bash" => {
            let cmd = tc.arguments.get("command")?.as_str()?.trim();
            if tools::is_dangerous_shell(cmd) {
                None
            } else {
                Some(format!("bash:{cmd}"))
            }
        }
        "file_delete" => {
            let path = tc.arguments.get("path")?.as_str()?;
            if tools::is_sensitive_path(path) {
                None
            } else {
                Some(format!("file_delete:{path}"))
            }
        }
        _ => None,
    }
}

/// P-07: 检查 URL 是否命中网络出口白名单。空列表 = 不限制。
fn url_allowed(url: &str, allowlist: &[String]) -> bool {
    if allowlist.is_empty() {
        return true;
    }
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    allowlist.iter().any(|rule| {
        let r = rule.trim().to_ascii_lowercase();
        if r.is_empty() {
            return false;
        }
        host == r || host.ends_with(&format!(".{r}"))
    })
}

/// U-04: 把底层错误映射为可行动提示（前端可直接展示）。
pub fn actionable_error(err: &str) -> String {
    let e = err.to_ascii_lowercase();
    if e.contains("401") || e.contains("unauthorized") || e.contains("invalid api key") {
        format!("{err}\n→ 请到「设置 → 模型」检查 API Key 是否正确或已过期。")
    } else if e.contains("429") || e.contains("rate limit") || e.contains("too many requests") {
        format!("{err}\n→ 请求过于频繁，可稍后重试，或切换到其它 Provider / 本地模型。")
    } else if e.contains("timeout") || e.contains("timed out") {
        format!("{err}\n→ 网络或命令超时。可在「设置」增大工具超时，或检查代理/网络。")
    } else if e.contains("404") && e.contains("model") {
        format!("{err}\n→ 模型 ID 不存在，请在设置中核对 base_url 与 model。")
    } else if e.contains("budget") || e.contains("预算") {
        format!("{err}\n→ 可到「设置 → 预算」调整上限，或清除用量统计。")
    } else if e.contains("connection refused")
        || e.contains("dns")
        || e.contains("connect")
        || e.contains("连接失败")
    {
        format!("{err}\n→ 无法连接端点。请检查 API 地址、代理与本机网络。")
    } else if e.contains("权限") || e.contains("permission") || e.contains("denied") {
        format!("{err}\n→ 权限不足。可在设置中调整编辑模式，或对单次操作选择「允许」。")
    } else {
        err.to_string()
    }
}

#[cfg(test)]
mod actionable_tests {
    use super::*;

    #[test]
    fn maps_auth_and_rate_limit() {
        assert!(actionable_error("401 unauthorized").contains("API Key"));
        assert!(actionable_error("429 too many requests").contains("重试"));
        assert!(actionable_error("connection refused").contains("网络"));
    }
}

/// 构建 HTTP 客户端：复用 NetworkConfig::build_client（G12）。
fn build_http_client(network: &crate::settings::NetworkConfig) -> Result<reqwest::Client, String> {
    network.build_client()
}

/// 发送 JSON 请求并带重试（G12）：仅对连接失败与 5xx 服务端错误重试；
/// 4xx（参数/鉴权错误）不重试，避免重复计费与掩盖配置问题。
async fn send_json_with_retry(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
    body: &Value,
    retry_enabled: bool,
    retry_max: u32,
) -> Result<reqwest::Response, String> {
    let max = if retry_enabled { retry_max.min(3) } else { 0 };
    let mut attempt = 0u32;
    loop {
        let mut req = client.post(url);
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = match req.json(body).send().await {
            Ok(r) => r,
            Err(e) => {
                if attempt < max {
                    attempt += 1;
                    tracing::warn!("请求失败（{e}），第 {attempt}/{max} 次重试");
                    tokio::time::sleep(std::time::Duration::from_secs(attempt as u64)).await;
                    continue;
                }
                return Err(format!("请求失败（已重试 {attempt} 次）: {e}"));
            }
        };
        if resp.status().is_success() {
            return Ok(resp);
        }
        let status = resp.status();
        if status.is_server_error() && attempt < max {
            attempt += 1;
            tracing::warn!("服务端错误 {status}，第 {attempt}/{max} 次重试");
            tokio::time::sleep(std::time::Duration::from_secs(attempt as u64)).await;
            continue;
        }
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("API 错误 ({}): {}", status, err_body));
    }
}

/// 调用模型把一段对话历史压缩为中文摘要（非流式）。
async fn summarize_history(
    api_base: &str,
    api_key: &str,
    model: &str,
    history: &[Value],
    upstream_headers: &Option<HashMap<String, String>>,
    network: &crate::settings::NetworkConfig,
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
    let http_client = build_http_client(network)?;
    let mut headers: Vec<(String, String)> = vec![
        ("Authorization".to_string(), format!("Bearer {}", api_key)),
        ("Content-Type".to_string(), "application/json".to_string()),
    ];
    if let Some(hs) = upstream_headers {
        for (k, v) in hs {
            headers.push((k.clone(), v.clone()));
        }
    }
    let resp = send_json_with_retry(
        &http_client,
        &url,
        &headers,
        &body,
        network.retry_enabled,
        network.retry_max,
    )
    .await
    .map_err(|e| format!("压缩请求失败: {e}"))?;
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
            x.iso_week().year() == y.iso_week().year() && x.iso_week().week() == y.iso_week().week()
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
        map.pending
            .entry(session_id.to_string())
            .or_default()
            .push(ApprovalRequest {
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

#[cfg(test)]
mod fallback_tests {
    // Q-02: F-06 fallback 链的判定与解析单测。

    use super::*;

    #[test]
    fn fallback_eligibility_classification() {
        // 传输错误（重试耗尽）→ 降级
        assert!(is_fallback_eligible(
            "请求失败（已重试 3 次）: connection reset"
        ));
        // 5xx / 429 → 降级
        assert!(is_fallback_eligible("API 错误 (500): boom"));
        assert!(is_fallback_eligible("API 错误 (503): unavailable"));
        assert!(is_fallback_eligible("API 错误 (429): slow down"));
        // 4xx（配置/权限类）→ 不降级，直接报错
        assert!(!is_fallback_eligible("API 错误 (401): bad key"));
        assert!(!is_fallback_eligible("API 错误 (404): no model"));
        assert!(!is_fallback_eligible("API 错误 (400): bad request"));
        // 其他格式 → 不降级
        assert!(!is_fallback_eligible("未知错误"));
    }

    #[test]
    fn body_with_model_overrides_model_field() {
        let body = json!({ "model": "gpt-4.1", "messages": [] });
        let out = body_with_model(&body, "deepseek-chat");
        assert_eq!(out["model"], "deepseek-chat");
        assert!(out["messages"].is_array());
        // 原体不被修改
        assert_eq!(body["model"], "gpt-4.1");
    }

    #[test]
    fn resolve_chain_skips_unusable_providers() {
        use crate::settings::{DesktopSettings, ProviderConfig};
        let mut settings = DesktopSettings::default();
        settings.default_provider_id = Some("main".into());
        // 备用 1：本地模型（无 Key 可用）→ 入链
        settings.providers.push(ProviderConfig {
            id: "local-ollama".into(),
            name: "Ollama".into(),
            kind: "openai-compatible".into(),
            base_url: "http://localhost:11434/v1".into(),
            model: "qwen3:8b".into(),
            enabled: true,
            builtin: false,
            local: true,
            price_input: None,
            price_output: None,
        });
        // 备用 2：无 Key 的云端 → 跳过
        settings.providers.push(ProviderConfig {
            id: "cloud-nokey".into(),
            name: "Cloud".into(),
            kind: "openai-compatible".into(),
            base_url: "https://x.example/v1".into(),
            model: "m".into(),
            enabled: true,
            builtin: false,
            local: false,
            price_input: None,
            price_output: None,
        });
        // 备用 3：主端点自身 → 跳过
        settings.providers.push(ProviderConfig {
            id: "main".into(),
            name: "Main".into(),
            kind: "openai-compatible".into(),
            base_url: "https://main.example/v1".into(),
            model: "m".into(),
            enabled: true,
            builtin: false,
            local: false,
            price_input: None,
            price_output: None,
        });
        settings.fallback_provider_ids = vec![
            "local-ollama".into(),
            "cloud-nokey".into(),
            "main".into(),
            "missing".into(),
        ];
        let chain = resolve_fallback_chain(&settings, "main").unwrap();
        assert_eq!(chain.len(), 1, "只有本地备用入链");
        assert_eq!(chain[0].model, "qwen3:8b");
        assert_eq!(chain[0].api_key, "");
    }
}
