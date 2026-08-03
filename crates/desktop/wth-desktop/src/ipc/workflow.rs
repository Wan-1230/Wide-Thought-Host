//! G7: 多 Agent 任务编排 — DAG 工作流执行引擎。
//!
//! 工作流由节点（子智能体 + 输入模板 + 依赖 + 条件）组成，
//! 按拓扑序调度：无依赖节点并行执行，依赖满足后进入下一轮。
//! 节点输出（子智能体最终回复）供后续节点通过 {{prev_output:node_id}} 引用。

use crate::settings::{SubagentConfig, WorkflowConfig, WorkflowNode};
use crate::state::{AgentHandle, AppState};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunResult {
    pub node_id: String,
    pub node_name: String,
    pub status: String,
    pub output: String,
    pub sub_session_id: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowRunDto {
    pub run_id: String,
    pub config_id: String,
    pub config_name: String,
    pub results: Vec<WorkflowRunResult>,
    pub status: String,
}

/// 列出全部工作流定义。
#[tauri::command]
pub async fn workflow_list(state: State<'_, AppState>) -> Result<Vec<WorkflowConfig>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    Ok(settings.workflows.clone())
}

/// 新增或更新工作流定义。
#[tauri::command]
pub async fn workflow_save(
    mut config: WorkflowConfig,
    state: State<'_, AppState>,
) -> Result<WorkflowConfig, String> {
    if config.name.trim().is_empty() {
        return Err("工作流名称不能为空".into());
    }
    if config.id.trim().is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
    }
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        if let Some(existing) = settings.workflows.iter_mut().find(|w| w.id == config.id) {
            *existing = config.clone();
        } else {
            settings.workflows.push(config.clone());
        }
    }
    crate::settings::persist_state_settings(&state)?;
    Ok(config)
}

/// 删除工作流定义。
#[tauri::command]
pub async fn workflow_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.workflows.retain(|w| w.id != id);
    }
    crate::settings::persist_state_settings(&state)
}

/// 执行工作流：按拓扑序调度节点，进度通过 `workflow:progress` 事件回传，
/// 完成后通过 `workflow:done` 回传结果摘要。返回 run_id。
#[tauri::command]
pub async fn workflow_run(
    config_id: String,
    input: String,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    let input = input.trim().to_string();
    if input.is_empty() {
        return Err("工作流输入不能为空".into());
    }
    let config = {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        settings
            .workflows
            .iter()
            .find(|w| w.id == config_id)
            .cloned()
            .ok_or_else(|| "工作流不存在".to_string())?
    };
    if config.nodes.is_empty() {
        return Err("工作流没有节点".into());
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let results_dir = xai_grok_config::wth_home().join("workflow-runs");
    let _ = std::fs::create_dir_all(&results_dir);

    // 快照执行所需状态
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let default_provider_id = settings
        .default_provider_id
        .as_deref()
        .ok_or_else(|| "请先在设置中配置默认模型".to_string())?
        .to_string();
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == default_provider_id && p.enabled)
        .cloned()
        .ok_or_else(|| "默认模型不存在或已停用".to_string())?;
    let api_key = crate::credentials::read_secret("provider", &default_provider_id)?
        .ok_or_else(|| "请先在设置中配置 API Key".to_string())?;
    let workspace_root = state.workspace_root.read().map_err(|e| e.to_string())?.clone();
    let edit_mode = settings.edit_mode.clone();
    let reasoning_effort = settings.reasoning_effort.clone();
    let subagents = settings.subagents.clone();

    let agent_state = state.inner().agents.clone();
    let approvals = state.inner().approvals.clone();
    let settings_ref = state.inner().settings.clone();
    let settings_path = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let mcp_manager = state.inner().mcp.clone();
    let sessions = state.inner().sessions.clone();
    let sessions_path = state
        .sessions_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let nodes = config.nodes.clone();
    let config_name = config.name.clone();
    let window_clone = window.clone();

    // 后台执行引擎
    let run_id_clone = run_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut completed: HashMap<String, WorkflowRunResult> = HashMap::new();
        let mut remaining: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
        let mut rounds = 0;
        let max_rounds = nodes.len() + 1;

        while !remaining.is_empty() && rounds < max_rounds {
            rounds += 1;
            // 本轮可执行节点：所有依赖已满足
            let ready: Vec<WorkflowNode> = nodes
                .iter()
                .filter(|n| remaining.contains(&n.id) && deps_satisfied(n, &completed))
                .cloned()
                .collect();
            if ready.is_empty() {
                break; // 环或不可达节点：中止
            }

            let mut join = tokio::task::JoinSet::new();
            for node in ready {
                let node_id = node.id.clone();
                let node_name = node.name.clone();
                let subagent = subagents.iter().find(|s| s.id == node.subagent_id).cloned();
                let node_input = render_input(&node, &input, &completed);
                let provider = provider.clone();
                let api_key = api_key.clone();
                let workspace_root = workspace_root.clone();
                let edit_mode = edit_mode.clone();
                let reasoning_effort = reasoning_effort.clone();
                let window = window_clone.clone();
                let abort_rx = tokio::sync::mpsc::channel(1).1;
                let approvals = approvals.clone();
                let settings_ref = settings_ref.clone();
                let settings_path = settings_path.clone();
                let mcp_manager = mcp_manager.clone();
                let sessions = sessions.clone();
                let sessions_path = sessions_path.clone();
                let agent_state = agent_state.clone();

                join.spawn(async move {
                    // 子会话
                    let sub_session_id = uuid::Uuid::new_v4().to_string();
                    let now = chrono::Utc::now().to_rfc3339();
                    let info = crate::ipc::session::SessionInfo {
                        id: sub_session_id.clone(),
                        title: format!("工作流：{node_name}"),
                        created_at: now.clone(),
                        updated_at: now,
                        message_count: 1,
                        model: provider.model.clone(),
                        pinned: false,
                    };
                    {
                        let mut sessions = sessions.lock().unwrap();
                        sessions.push(info);
                    }
                    {
                        let sessions = sessions.lock().unwrap();
                        crate::ipc::session::save_sessions(&sessions_path, &sessions);
                    }
                    {
                        let mut agents = agent_state.lock().unwrap();
                        agents.sessions.insert(
                            sub_session_id.clone(),
                            AgentHandle {
                                id: sub_session_id.clone(),
                                title: format!("工作流：{node_name}"),
                                running: true,
                                abort_tx: None,
                            },
                        );
                    }

                    let Some(subagent) = subagent else {
                        let r = WorkflowRunResult {
                            node_id: node_id.clone(),
                            node_name: node_name.clone(),
                            status: "error".into(),
                            output: String::new(),
                            sub_session_id: sub_session_id.clone(),
                            error: Some("子智能体不存在".into()),
                        };
                        return (node_id, node_name, r);
                    };

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

                    let result = crate::ipc::agent::run_agent(
                        sub_session_id.clone(),
                        crate::ipc::agent::AgentMessage {
                            session_id: sub_session_id.clone(),
                            content: node_input,
                            attachments: vec![],
                            system_instruction: None,
                            history: vec![],
                        },
                        provider.base_url.clone(),
                        api_key,
                        provider.model.clone(),
                        window.clone(),
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

                    let r = match result {
                        Ok(output) => WorkflowRunResult {
                            node_id: node_id.clone(),
                            node_name: node_name.clone(),
                            status: "done".into(),
                            output: output.chars().take(8000).collect(),
                            sub_session_id: sub_session_id.clone(),
                            error: None,
                        },
                        Err(e) => WorkflowRunResult {
                            node_id: node_id.clone(),
                            node_name: node_name.clone(),
                            status: "error".into(),
                            output: String::new(),
                            sub_session_id: sub_session_id.clone(),
                            error: Some(e),
                        },
                    };
                    (node_id, node_name, r)
                });
            }

            while let Some(joined) = join.join_next().await {
                if let Ok((node_id, node_name, result)) = joined {
                    let status = result.status.clone();
                    let error = result.error.clone().unwrap_or_default();
                    completed.insert(node_id.clone(), result.clone());
                    remaining.remove(&node_id);
                    let _ = window_clone.emit(
                        "workflow:progress",
                        serde_json::json!({
                            "run_id": run_id_clone,
                            "config_id": config_id,
                            "node_id": node_id,
                            "node_name": node_name,
                            "status": status,
                            "error": error,
                        }),
                    );
                }
            }
        }

        // 汇总结果
        let mut results: Vec<WorkflowRunResult> = completed.values().cloned().collect();
        results.sort_by(|a, b| {
            let idx = |id: &str| nodes.iter().position(|n| n.id == id).unwrap_or(usize::MAX);
            idx(&a.node_id).cmp(&idx(&b.node_id))
        });
        let done_count = results.iter().filter(|r| r.status == "done").count();
        let status = if done_count > 0 { "done" } else { "failed" };
        let summary: Vec<String> = results
            .iter()
            .map(|r| {
                format!(
                    "【{}】{}\n{}",
                    r.node_name,
                    r.status,
                    r.output.chars().take(400).collect::<String>()
                )
            })
            .collect();
        let payload = serde_json::json!({
            "run_id": run_id_clone,
            "config_id": config_id,
            "config_name": config_name,
            "status": status,
            "results": results,
        });
        let _ = window_clone.emit("workflow:done", &payload);

        // 落盘运行结果（便于追溯）
        let path = results_dir.join(format!("{run_id_clone}.json"));
        let _ = std::fs::write(path, serde_json::to_string_pretty(&payload).unwrap_or_default());
    });

    Ok(run_id)
}

/// 依赖是否满足：condition 为空要求全部依赖成功；"on_failure" 要求至少一个依赖失败。
fn deps_satisfied(node: &WorkflowNode, completed: &HashMap<String, WorkflowRunResult>) -> bool {
    if node.depends_on.is_empty() {
        return true;
    }
    if node.condition == "on_failure" {
        return node.depends_on.iter().any(|dep| {
            completed
                .get(dep)
                .map(|r| r.status == "error")
                .unwrap_or(false)
        });
    }
    node.depends_on.iter().all(|dep| {
        completed
            .get(dep)
            .map(|r| r.status == "done")
            .unwrap_or(false)
    })
}

/// 渲染节点输入：{{input}} → 工作流输入；{{prev_output:node_id}} → 依赖节点输出。
fn render_input(
    node: &WorkflowNode,
    input: &str,
    completed: &HashMap<String, WorkflowRunResult>,
) -> String {
    let mut out = node.input_template.clone();
    out = out.replace("{{input}}", input);
    for (dep_id, result) in completed {
        out = out.replace(
            &format!("{{{{prev_output:{dep_id}}}}}"),
            &result.output,
        );
    }
    if out.trim().is_empty() {
        out = input.to_string();
    }
    out
}

/// 供前端预览使用：返回可执行的节点引用（校验子智能体是否存在）。
#[tauri::command]
pub async fn workflow_validate(
    config_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    let config = settings
        .workflows
        .iter()
        .find(|w| w.id == config_id)
        .ok_or_else(|| "工作流不存在".to_string())?;
    let mut problems = Vec::new();
    for node in &config.nodes {
        if !settings.subagents.iter().any(|s| s.id == node.subagent_id) {
            problems.push(format!("节点「{}」引用了不存在的子智能体", node.name));
        }
    }
    Ok(problems)
}

#[cfg(test)]
mod tests {
    use super::{deps_satisfied, render_input};
    use crate::settings::{WorkflowConfig, WorkflowNode};
    use std::collections::HashMap;

    fn node(id: &str, deps: Vec<&str>, condition: &str) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            subagent_id: "sub".into(),
            name: id.into(),
            input_template: String::new(),
            depends_on: deps.into_iter().map(String::from).collect(),
            condition: condition.into(),
        }
    }

    #[test]
    fn deps_satisfied_requires_all_done() {
        let n = node("c", vec!["a", "b"], "");
        let mut completed = HashMap::new();
        assert!(!deps_satisfied(&n, &completed));
        completed.insert("a".into(), super::WorkflowRunResult {
            node_id: "a".into(), node_name: "a".into(), status: "done".into(),
            output: String::new(), sub_session_id: String::new(), error: None,
        });
        assert!(!deps_satisfied(&n, &completed));
        completed.insert("b".into(), super::WorkflowRunResult {
            node_id: "b".into(), node_name: "b".into(), status: "done".into(),
            output: String::new(), sub_session_id: String::new(), error: None,
        });
        assert!(deps_satisfied(&n, &completed));
    }

    #[test]
    fn deps_on_failure_requires_error() {
        let n = node("rescue", vec!["a"], "on_failure");
        let mut completed = HashMap::new();
        completed.insert("a".into(), super::WorkflowRunResult {
            node_id: "a".into(), node_name: "a".into(), status: "done".into(),
            output: String::new(), sub_session_id: String::new(), error: None,
        });
        assert!(!deps_satisfied(&n, &completed));
        completed.insert("a".into(), super::WorkflowRunResult {
            node_id: "a".into(), node_name: "a".into(), status: "error".into(),
            output: String::new(), sub_session_id: String::new(), error: Some("x".into()),
        });
        assert!(deps_satisfied(&n, &completed));
    }

    #[test]
    fn render_input_replaces_variables() {
        let mut n = node("s", vec![], "");
        n.input_template = "输入：{{input}}；上一轮：{{prev_output:a}}".into();
        let mut completed = HashMap::new();
        completed.insert("a".into(), super::WorkflowRunResult {
            node_id: "a".into(), node_name: "a".into(), status: "done".into(),
            output: "审查结论".into(), sub_session_id: String::new(), error: None,
        });
        let out = render_input(&n, "任务", &completed);
        assert_eq!(out, "输入：任务；上一轮：审查结论");
    }

    #[test]
    fn workflow_round_trip() {
        let config = WorkflowConfig {
            id: "w1".into(),
            name: "测试".into(),
            description: String::new(),
            nodes: vec![node("a", vec![], "")],
        };
        let json = serde_json::to_string(&config).unwrap();
        let back: WorkflowConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "w1");
        assert_eq!(back.nodes.len(), 1);
    }
}