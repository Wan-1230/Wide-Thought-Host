//! P-02: 本地审计日志 — 追加写 JSONL，记录批准/拒绝与高危工具调用。
//!
//! 路径：`<app_data_dir>/audit.jsonl`。每行一个事件，含时间戳、会话、
//! 工具、参数摘要与决定。默认保留全部（用户可手动删除）；不包含
//! API Key 或文件完整内容。

use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub ts: String,
    pub kind: String,
    pub session_id: String,
    pub tool: String,
    /// 工具参数摘要（截断，避免写入大段文件内容）
    pub args_summary: String,
    pub decision: String,
    pub risk: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// 截断并压平参数为单行摘要。
pub fn summarize_args(arguments: &serde_json::Value) -> String {
    let raw = arguments.to_string();
    const MAX: usize = 400;
    if raw.chars().count() > MAX {
        let truncated: String = raw.chars().take(MAX).collect();
        format!("{truncated}…")
    } else {
        raw
    }
}

/// 追加一条审计记录。失败只打日志，不影响主流程。
pub fn append_audit(path: &Path, event: &AuditEvent) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(line) = serde_json::to_string(event) else {
        return;
    };
    match OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut f) => {
            let _ = writeln!(f, "{line}");
        }
        Err(e) => tracing::warn!("audit log write failed: {e}"),
    }
}

/// 记录一次工具审批决策。
pub fn record_approval(
    path: &Path,
    session_id: &str,
    tool: &str,
    arguments: &serde_json::Value,
    approved: bool,
    dangerous: bool,
) {
    let event = AuditEvent {
        ts: chrono::Utc::now().to_rfc3339(),
        kind: if dangerous {
            "dangerous_tool_decision".into()
        } else {
            "tool_approval".into()
        },
        session_id: session_id.to_string(),
        tool: tool.to_string(),
        args_summary: summarize_args(arguments),
        decision: if approved { "allow" } else { "deny" }.into(),
        risk: if dangerous { "high" } else { "normal" }.into(),
        note: None,
    };
    append_audit(path, &event);
}

/// O-01: 结构化运行事件（会话级，JSONL）。供诊断与后续指标聚合。
#[derive(Debug, Clone, Serialize)]
pub struct RunEvent {
    pub schema_version: u32,
    pub seq: u64,
    pub ts: String,
    pub session_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<serde_json::Value>,
}

/// 追加一条运行事件。
pub fn append_run_event(path: &Path, event: &RunEvent) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(line) = serde_json::to_string(event) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// 便捷：写 run 事件（seq 用时间戳毫秒近似，避免额外状态）。
pub fn log_run_event(path: &Path, session_id: &str, kind: &str, detail: Option<serde_json::Value>) {
    let seq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    append_run_event(
        path,
        &RunEvent {
            schema_version: 1,
            seq,
            ts: chrono::Utc::now().to_rfc3339(),
            session_id: session_id.to_string(),
            kind: kind.to_string(),
            detail,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn summarize_truncates_long_args() {
        let long = "x".repeat(1000);
        let v = json!({ "content": long });
        let s = summarize_args(&v);
        assert!(s.chars().count() <= 401);
    }

    #[test]
    fn append_writes_jsonl() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.jsonl");
        record_approval(&path, "s1", "bash", &json!({"command":"ls"}), true, false);
        record_approval(
            &path,
            "s1",
            "bash",
            &json!({"command":"rm -rf /"}),
            false,
            true,
        );
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.contains("dangerous_tool_decision"));
        assert!(text.contains("rm -rf"));
    }
}
