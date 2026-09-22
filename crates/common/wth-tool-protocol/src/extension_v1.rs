//! Extension Protocol v1 — 最小契约（F-07）。
//!
//! 定义第三方 sidecar 与宿主之间的 JSON-RPC 方法面：
//! - `ext/handshake`：能力协商，校验 manifest 声明
//! - `ext/intercept`：输入 / 工具调用 / 权限决策（continue|block|replace）
//! - `ext/status`：结构化状态卡片（可选）
//!
//! 安全：安装即信任；宿主对 replace 结果做 schema 重校验；
//! 凭据在日志与错误面 redact。完整 interceptor 热路径默认不启用。

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;

/// 插件在 manifest 中声明的能力。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub name: String,
    pub version: String,
    pub api_version: String,
    #[serde(default)]
    pub intercepts: Vec<String>,
    #[serde(default)]
    pub slots: Vec<String>,
    #[serde(default)]
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeRequest {
    pub protocol_version: u32,
    pub host: String,
    pub host_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeResponse {
    pub accepted: bool,
    pub plugin: String,
    pub protocol_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 拦截点：与 Reasonix 对齐的命名（子集）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterceptPoint {
    /// 用户输入进入 agent 前
    Input,
    /// 工具调用执行前
    ToolCall,
    /// 权限决策前
    Permission,
}

impl InterceptPoint {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::ToolCall => "tool_call",
            Self::Permission => "permission",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptRequest {
    pub point: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    pub payload: Value,
}

/// 拦截结论。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum InterceptDecision {
    Continue,
    Block { reason: String },
    Replace { payload: Value },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptResponse {
    pub decision: InterceptDecision,
}

/// 宿主侧：校验 replace 后的 payload 是否仍是合法形状。
/// 当前最小实现：必须仍是 object/array/string，禁止 null。
pub fn validate_replace(point: InterceptPoint, value: &Value) -> Result<(), String> {
    match value {
        Value::Null => Err(format!("{}: null payload rejected", point.as_str())),
        Value::Object(_) | Value::Array(_) | Value::String(_) => Ok(()),
        Value::Number(_) | Value::Bool(_) => {
            // 工具参数等需要结构体，标量仅允许在 input 文本场景
            if matches!(point, InterceptPoint::Input) {
                Ok(())
            } else {
                Err(format!("{}: scalar payload rejected", point.as_str()))
            }
        }
    }
}

/// 校验 handshake：协议版本 + apiVersion 前缀。
pub fn accept_handshake(req: &HandshakeRequest, manifest: &ExtensionManifest) -> HandshakeResponse {
    let name = manifest.name.clone();
    let mut reason = None;
    let mut accepted = true;
    if req.protocol_version != PROTOCOL_VERSION {
        accepted = false;
        reason = Some(format!(
            "unsupported protocol_version {} (host={})",
            req.protocol_version, PROTOCOL_VERSION
        ));
    } else if manifest.api_version != "wth.io/extension/v1" {
        accepted = false;
        reason = Some(format!("unsupported apiVersion {}", manifest.api_version));
    }
    HandshakeResponse {
        accepted,
        plugin: name,
        protocol_version: PROTOCOL_VERSION,
        reason,
    }
}

/// 能力冲突检测：同一 replacement slot 只允许一个 owner。
pub fn detect_slot_collisions(manifests: &[ExtensionManifest]) -> Vec<String> {
    use std::collections::HashMap;
    let mut owners: HashMap<&str, &str> = HashMap::new();
    let mut collisions = Vec::new();
    for m in manifests {
        for slot in &m.slots {
            match owners.get(slot.as_str()) {
                Some(prev) if *prev != m.name.as_str() => {
                    collisions.push(format!(
                        "slot '{slot}' claimed by both '{prev}' and '{}'",
                        m.name
                    ));
                }
                _ => {
                    owners.insert(slot.as_str(), m.name.as_str());
                }
            }
        }
    }
    collisions
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn handshake_accepts_v1() {
        let manifest = ExtensionManifest {
            name: "demo".into(),
            version: "0.1.0".into(),
            api_version: "wth.io/extension/v1".into(),
            ..Default::default()
        };
        let req = HandshakeRequest {
            protocol_version: 1,
            host: "wth-desktop".into(),
            host_version: "2.1.0".into(),
        };
        let resp = accept_handshake(&req, &manifest);
        assert!(resp.accepted);
        assert_eq!(resp.plugin, "demo");
    }

    #[test]
    fn handshake_rejects_wrong_api() {
        let manifest = ExtensionManifest {
            name: "demo".into(),
            version: "0.1.0".into(),
            api_version: "reasonix.io/plugin/v2".into(),
            ..Default::default()
        };
        let req = HandshakeRequest {
            protocol_version: 1,
            host: "wth".into(),
            host_version: "1".into(),
        };
        assert!(!accept_handshake(&req, &manifest).accepted);
    }

    #[test]
    fn replace_null_rejected() {
        assert!(validate_replace(InterceptPoint::ToolCall, &Value::Null).is_err());
        assert!(validate_replace(InterceptPoint::Input, &json!({"text":"ok"})).is_ok());
    }

    #[test]
    fn slot_collision_detected() {
        let a = ExtensionManifest {
            name: "a".into(),
            version: "1".into(),
            api_version: "wth.io/extension/v1".into(),
            slots: vec!["system_prompt".into()],
            ..Default::default()
        };
        let b = ExtensionManifest {
            name: "b".into(),
            version: "1".into(),
            api_version: "wth.io/extension/v1".into(),
            slots: vec!["system_prompt".into()],
            ..Default::default()
        };
        let c = detect_slot_collisions(&[a, b]);
        assert_eq!(c.len(), 1);
    }
}
