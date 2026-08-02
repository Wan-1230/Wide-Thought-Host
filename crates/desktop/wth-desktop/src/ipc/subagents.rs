//! 子智能体 CRUD 命令。

use crate::{settings::SubagentConfig, state::{AgentHandle, AppState}};
use tauri::{Emitter, State};

#[tauri::command]
pub async fn subagent_list(state: State<'_, AppState>) -> Result<Vec<SubagentConfig>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    Ok(settings.subagents.clone())
}

#[tauri::command]
pub async fn subagent_add(
    mut config: SubagentConfig,
    state: State<'_, AppState>,
) -> Result<SubagentConfig, String> {
    if config.name.trim().is_empty() {
        return Err("子智能体名称不能为空".into());
    }
    if config.id.trim().is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
    }
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        if let Some(existing) = settings.subagents.iter_mut().find(|s| s.id == config.id) {
            *existing = config.clone();
        } else {
            settings.subagents.push(config.clone());
        }
    }
    crate::settings::persist_state_settings(&state)?;
    Ok(config)
}

#[tauri::command]
pub async fn subagent_remove(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.subagents.retain(|s| s.id != id);
    }
    crate::settings::persist_state_settings(&state)
}

#[tauri::command]
pub async fn subagent_toggle(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        let agent = settings
            .subagents
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| "子智能体不存在".to_string())?;
        agent.enabled = enabled;
    }
    crate::settings::persist_state_settings(&state)
}

/// 委派子智能体执行任务：创建独立子会话，后台运行 Agent 工具循环，
/// 结果通过 `agent:subagent_result` 事件回传主会话。
#[tauri::command]
pub async fn subagent_run(
    state: State<'_, AppState>,
    window: tauri::Window,
    subagent_id: String,
    task: String,
    parent_session_id: String,
) -> Result<String, String> {
    let task = task.trim().to_string();
    if task.is_empty() {
        return Err("任务内容不能为空".into());
    }
    let (subagent, provider, api_key, workspace_root, edit_mode, reasoning_effort) = {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        let subagent = settings
            .subagents
            .iter()
            .find(|s| s.id == subagent_id)
            .cloned()
            .ok_or_else(|| "子智能体不存在".to_string())?;
        if !subagent.enabled {
            return Err("该子智能体已停用".into());
        }
        let provider_id = settings
            .default_provider_id
            .as_deref()
            .ok_or_else(|| "请先在设置中配置默认模型".to_string())?;
        let provider = settings
            .providers
            .iter()
            .find(|p| p.id == provider_id && p.enabled)
            .cloned()
            .ok_or_else(|| "默认模型不存在或已停用".to_string())?;
        let api_key = crate::credentials::read_secret("provider", provider_id)?
            .ok_or_else(|| "请先在设置中配置 API Key".to_string())?;
        let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
        (
            subagent,
            provider,
            api_key,
            workspace_root,
            settings.edit_mode.clone(),
            settings.reasoning_effort.clone(),
        )
    };

    // 创建子会话（独立于主会话，可随时切换查看完整过程）
    let sub_session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let info = crate::ipc::session::SessionInfo {
        id: sub_session_id.clone(),
        title: format!("委派：{}", subagent.name),
        created_at: now.clone(),
        updated_at: now,
        message_count: 1,
        model: provider.model.clone(),
        pinned: false,
    };
    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.push(info);
    }
    let sessions_path = state
        .sessions_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        crate::ipc::session::save_sessions(&sessions_path, &sessions);
    }

    // 注册 agent 句柄（支持中止）
    let (abort_tx, abort_rx) = tokio::sync::mpsc::channel(1);
    {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.sessions.insert(
            sub_session_id.clone(),
            AgentHandle {
                id: sub_session_id.clone(),
                title: format!("委派：{}", subagent.name),
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
    let sid = sub_session_id.clone();
    let sub_name = subagent.name.clone();
    let parent = parent_session_id.clone();

    let overrides = crate::ipc::agent::AgentRunOverrides {
        system_prompt: Some(subagent.system_prompt.clone()),
        model: if subagent.model.trim().is_empty() {
            None
        } else {
            Some(subagent.model.trim().to_string())
        },
        allowed_tools: if subagent.tools.is_empty() {
            None
        } else {
            Some(subagent.tools.clone())
        },
        headless: true,
    };

    tokio::spawn(async move {
        let result = crate::ipc::agent::run_agent(
            sid.clone(),
            crate::ipc::agent::AgentMessage {
                session_id: sid.clone(),
                content: task,
                attachments: vec![],
                system_instruction: None,
                history: vec![],
            },
            provider.base_url.clone(),
            api_key,
            provider.model.clone(),
            window_clone.clone(),
            abort_rx,
            None,
            workspace_root,
            edit_mode,
            reasoning_effort,
            approvals,
            settings_ref,
            settings_path,
            mcp_manager,
            overrides,
        )
        .await;
        if let Ok(mut agents) = agent_state.lock() {
            if let Some(handle) = agents.sessions.get_mut(&sid) {
                handle.running = false;
            }
        }
        // 委派结果事件：主会话展示完成状态
        let payload = match result {
            Ok(()) => serde_json::json!({
                "parent_session_id": parent,
                "sub_session_id": sid,
                "subagent_name": sub_name,
                "status": "done"
            }),
            Err(e) => serde_json::json!({
                "parent_session_id": parent,
                "sub_session_id": sid,
                "subagent_name": sub_name,
                "status": "error",
                "error": e
            }),
        };
        let _ = window_clone.emit("agent:subagent_result", payload);
    });

    Ok(sub_session_id)
}