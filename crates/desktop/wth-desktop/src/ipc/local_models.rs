//! F-01: 本地模型一等公民 —— Ollama / vLLM 端点自动发现与注册。
//!
//! 启动时探测本机常见端口（Ollama 11434、vLLM 8000），把可用模型注册为
//! `local-*` Provider；没有可用云端默认 Provider 时自动把默认切换到本地
//! 模型，实现"装好 Ollama 即开箱即用、零 API Key"。设计依据见
//! `docs/WTH-优化PRD.md` F-01 / G3。

use serde::Serialize;
use std::time::Duration;

use crate::settings::{save_settings, DesktopSettings, ProviderConfig};

/// Ollama 默认服务地址（原生 API 根）。
pub const OLLAMA_NATIVE_URL: &str = "http://localhost:11434";
/// vLLM 默认服务地址（OpenAI 兼容根）。
pub const VLLM_BASE_URL: &str = "http://localhost:8000";

/// 端点探测超时：本机回环应当毫秒级返回，超时即视为不可用。
const DETECT_TIMEOUT: Duration = Duration::from_millis(900);

#[derive(Debug, Clone, Serialize)]
pub struct LocalEndpoint {
    /// `ollama` 或 `vllm`
    pub kind: String,
    /// OpenAI 兼容 base_url（已含 `/v1`）
    pub base_url: String,
    /// 可用对话模型 id（已过滤 embedding 类模型）
    pub models: Vec<String>,
}

/// 探测本机 Ollama 与 vLLM 端点，返回可用模型列表。
pub async fn detect_local_endpoints() -> Vec<LocalEndpoint> {
    let client = reqwest::Client::builder()
        .timeout(DETECT_TIMEOUT)
        .build()
        .unwrap_or_default();

    let mut endpoints = Vec::new();
    if let Some(endpoint) = detect_ollama(&client).await {
        endpoints.push(endpoint);
    }
    if let Some(endpoint) = detect_vllm(&client).await {
        endpoints.push(endpoint);
    }
    endpoints
}

/// 探测 Ollama：`GET {OLLAMA_NATIVE_URL}/api/tags` → `{"models":[{"name":...}]}`。
async fn detect_ollama(client: &reqwest::Client) -> Option<LocalEndpoint> {
    let resp = client
        .get(format!("{OLLAMA_NATIVE_URL}/api/tags"))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    let models = json
        .get("models")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    m.get("name").and_then(serde_json::Value::as_str).map(String::from)
                })
                .filter(|name| !is_embedding_model(name))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if models.is_empty() {
        return None;
    }
    Some(LocalEndpoint {
        kind: "ollama".into(),
        base_url: format!("{OLLAMA_NATIVE_URL}/v1"),
        models,
    })
}

/// 探测 vLLM：`GET {VLLM_BASE_URL}/v1/models`（OpenAI 兼容模型列表）。
async fn detect_vllm(client: &reqwest::Client) -> Option<LocalEndpoint> {
    let resp = client
        .get(format!("{VLLM_BASE_URL}/v1/models"))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    let models = json
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    m.get("id").and_then(serde_json::Value::as_str).map(String::from)
                })
                .filter(|name| !is_embedding_model(name))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if models.is_empty() {
        return None;
    }
    Some(LocalEndpoint {
        kind: "vllm".into(),
        base_url: VLLM_BASE_URL.into(),
        models,
    })
}

/// Ollama 的 embedding 模型（bge/nomic-embed 等）不能对话，过滤掉。
fn is_embedding_model(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("embed") || n.contains("bge-") || n.starts_with("bge/") || n.contains("rerank")
}

/// Provider id 前缀：本地模型 Provider 一律 `local-<kind>`。
fn local_provider_id(kind: &str) -> String {
    format!("local-{kind}")
}

fn local_provider_name(kind: &str) -> String {
    match kind {
        "ollama" => "Ollama（本机）".into(),
        "vllm" => "vLLM（本机）".into(),
        other => format!("本地模型（{other}）"),
    }
}

/// 把探测到的端点注册为 Provider（已存在同 id 时跳过）。
///
/// 当前的默认 Provider 不可用（缺失/停用/无 Key 且非本地）时，把默认
/// 指向新注册的本地 Provider。返回是否有变更。
pub fn register_local_providers(settings: &mut DesktopSettings, endpoints: &[LocalEndpoint]) -> bool {
    let mut changed = false;
    for endpoint in endpoints {
        let id = local_provider_id(&endpoint.kind);
        if settings.providers.iter().any(|p| p.id == id) {
            continue;
        }
        settings.providers.push(ProviderConfig {
            id: id.clone(),
            name: local_provider_name(&endpoint.kind),
            kind: "openai-compatible".into(),
            base_url: endpoint.base_url.clone(),
            model: endpoint.models.first().cloned().unwrap_or_default(),
            enabled: true,
            builtin: false,
            local: true,
            price_input: None,
            price_output: None,
        });
        changed = true;
        if !default_provider_usable(settings) {
            settings.default_provider_id = Some(id);
        }
    }
    changed
}

/// 默认 Provider 是否"当前即可用"：存在、启用，且要么是本地模型
/// （无需 Key），要么已配置了 API Key。
pub fn default_provider_usable(settings: &DesktopSettings) -> bool {
    settings
        .default_provider_id
        .as_deref()
        .and_then(|id| settings.providers.iter().find(|p| p.id == id && p.enabled))
        .map(|p| {
            p.local
                || crate::credentials::read_secret("provider", &p.id)
                    .ok()
                    .flatten()
                    .is_some_and(|key| !key.is_empty())
        })
        .unwrap_or(false)
}

/// 探测 + 注册 + 落盘的一站式入口（供启动任务与设置页按钮共用）。
pub async fn detect_register_and_persist(
    settings: &std::sync::RwLock<DesktopSettings>,
    settings_path: &std::sync::RwLock<std::path::PathBuf>,
) -> Result<Vec<LocalEndpoint>, String> {
    let endpoints = detect_local_endpoints().await;
    if endpoints.is_empty() {
        return Ok(endpoints);
    }
    let mut guard = settings.write().map_err(|e| e.to_string())?;
    if register_local_providers(&mut guard, &endpoints) {
        let path = settings_path.read().map_err(|e| e.to_string())?.clone();
        let snapshot = guard.clone();
        drop(guard);
        if let Err(e) = save_settings(&path, &snapshot) {
            tracing::warn!("本地模型 Provider 落盘失败: {e}");
        } else {
            let kinds = endpoints
                .iter()
                .map(|e| e.kind.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            tracing::info!("已自动注册本地模型 Provider: {kinds}");
        }
    }
    Ok(endpoints)
}

/// Tauri 命令：设置页"检测本地模型"按钮调用，返回探测结果。
#[tauri::command]
pub async fn local_providers_detect(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<LocalEndpoint>, String> {
    detect_register_and_persist(&state.settings, &state.settings_path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn embedding_names() -> Vec<&'static str> {
        vec![
            "bge-m3",
            "nomic-embed-text:latest",
            "qwen2.5:7b",
            "deepseek-r1:8b",
            "text-rerank",
        ]
    }

    #[test]
    fn embedding_models_are_filtered() {
        let kept: Vec<_> = embedding_names()
            .into_iter()
            .filter(|n| !is_embedding_model(n))
            .collect();
        assert_eq!(kept, vec!["qwen2.5:7b", "deepseek-r1:8b"]);
    }

    #[test]
    fn register_local_providers_sets_default_when_unusable() {
        let mut settings = DesktopSettings::default();
        // 全新安装：默认 Provider 是内置 agnes（无 Key），不可用。
        assert!(!default_provider_usable(&settings));
        let endpoints = vec![LocalEndpoint {
            kind: "ollama".into(),
            base_url: "http://localhost:11434/v1".into(),
            models: vec!["qwen2.5:7b".into()],
        }];
        assert!(register_local_providers(&mut settings, &endpoints));
        assert!(settings.providers.iter().any(|p| p.id == "local-ollama"));
        assert_eq!(settings.default_provider_id.as_deref(), Some("local-ollama"));
        // 幂等：再次注册不产生变更。
        assert!(!register_local_providers(&mut settings, &endpoints));
    }

    #[test]
    fn register_local_providers_keeps_usable_default() {
        let mut settings = DesktopSettings::default();
        // 用户已配置带 Key 的云端默认 Provider（本地凭据在测试环境无法
        // 读取，退化为检查 local 标记 —— 这里直接造一个 local Provider）。
        settings.providers.push(ProviderConfig {
            id: "my-local".into(),
            name: "Local".into(),
            kind: "openai-compatible".into(),
            base_url: "http://localhost:1234/v1".into(),
            model: "m".into(),
            enabled: true,
            builtin: false,
            local: true,
            price_input: None,
            price_output: None,
        });
        settings.default_provider_id = Some("my-local".into());
        let endpoints = vec![LocalEndpoint {
            kind: "vllm".into(),
            base_url: VLLM_BASE_URL.into(),
            models: vec!["Qwen3-32B".into()],
        }];
        assert!(register_local_providers(&mut settings, &endpoints));
        assert_eq!(
            settings.default_provider_id.as_deref(),
            Some("my-local"),
            "默认 Provider 可用时不抢占"
        );
    }
}
