//! 桌面设置、模型提供商和工作区管理。

use crate::{credentials, state::AppState};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::State;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

fn default_language() -> String {
    "zh-CN".into()
}
fn default_close_action() -> String {
    "tray".into()
}
fn default_theme() -> String {
    "light".into()
}
fn default_session_display() -> String {
    "standard".into()
}
fn default_font_scale() -> String {
    "medium".into()
}
fn default_font_family() -> String {
    "sans".into()
}
fn default_reasoning_effort() -> String {
    "high".into()
}
fn default_edit_mode() -> String {
    "auto".into()
}
fn default_web_search_engine() -> String {
    // F-08: DuckDuckGo 无需 API Key，与"隐私优先"产品主张一致。
    "duckduckgo".into()
}

/// 默认快捷键表（action → 按键组合）。
pub fn default_shortcuts() -> HashMap<String, String> {
    let mut map = HashMap::new();
    map.insert("toggle_window".into(), "Alt+W".into());
    map.insert("command_palette".into(), "Ctrl+K".into());
    map.insert("new_session".into(), "Ctrl+N".into());
    map.insert("open_settings".into(), "Ctrl+,".into());
    map.insert("toggle_terminal".into(), "Ctrl+Shift+T".into());
    map.insert("toggle_theme".into(), "Ctrl+D".into());
    map.insert("send_message".into(), "Ctrl+Enter".into());
    map
}

/// 预置的常用子智能体：开箱即用，用户可删除或修改。
/// `model` 留空表示跟随默认模型；`tools` 为允许子智能体使用的工具。
pub fn default_subagents() -> Vec<SubagentConfig> {
    vec![
        SubagentConfig {
            id: "builtin-code-review".into(),
            name: "代码审查员".into(),
            description: "审查代码变更，发现潜在缺陷、安全风险与改进点".into(),
            system_prompt: "你是一名资深代码审查员。请仔细审查提供的代码或 diff，重点检查：逻辑错误与边界条件、安全问题（注入、越权、敏感信息泄露）、错误处理缺失、性能隐患与可维护性问题。按严重程度分级（严重/建议/可选）给出结论，每条问题附具体位置与修改建议，语言简洁、结论明确。".into(),
            model: String::new(),
            tools: vec!["shell".into(), "git".into()],
            enabled: true,
        },
        SubagentConfig {
            id: "builtin-test-writer".into(),
            name: "测试工程师".into(),
            description: "为代码编写单元测试与集成测试，覆盖关键路径与边界".into(),
            system_prompt: "你是一名测试工程师。分析被测代码的功能、关键路径与边界条件，编写清晰、可维护的测试用例（单元测试为主，必要时补充集成测试）。测试应覆盖正常路径、异常输入与边界值，命名清晰，并在完成后运行测试确保全部通过。".into(),
            model: String::new(),
            tools: vec!["shell".into(), "git".into()],
            enabled: true,
        },
        SubagentConfig {
            id: "builtin-refactor".into(),
            name: "重构专家".into(),
            description: "重构代码以提升可读性、可维护性与性能，保持行为不变".into(),
            system_prompt: "你是一名代码重构专家。识别重复代码、过高的复杂度、糟糕的命名与过长函数等问题，提出并实施保持行为不变的重构方案。遵循最小改动原则，分小步进行，每步可独立验证，重构后运行测试确认无回归。".into(),
            model: String::new(),
            tools: vec!["shell".into(), "git".into()],
            enabled: true,
        },
        SubagentConfig {
            id: "builtin-doc-writer".into(),
            name: "文档撰写员".into(),
            description: "编写与更新项目文档、README 与代码注释".into(),
            system_prompt: "你是一名技术文档撰写员。用清晰、简洁、结构化的中文编写项目文档与代码注释，遵循项目既有的文档风格。说明用途、使用方式与示例，示例必须可运行，避免冗余与空话。".into(),
            model: String::new(),
            tools: vec!["shell".into()],
            enabled: true,
        },
        SubagentConfig {
            id: "builtin-security-audit".into(),
            name: "安全审计员".into(),
            description: "审计代码中的安全漏洞与风险点".into(),
            system_prompt: "你是一名应用安全审计员。重点检查注入（SQL/命令/模板）、XSS、越权访问、敏感信息硬编码与泄露、不安全反序列化、依赖漏洞等风险。对每个发现给出位置、攻击场景、影响面与修复建议，并说明优先级。".into(),
            model: String::new(),
            tools: vec!["shell".into(), "git".into()],
            enabled: true,
        },
        SubagentConfig {
            id: "builtin-perf-optimizer".into(),
            name: "性能优化师".into(),
            description: "定位并优化性能瓶颈，提升响应速度与资源效率".into(),
            system_prompt: "你是一名性能优化专家。通过代码分析与必要的性能剖析定位瓶颈（时间/内存/IO），优先优化影响最大的部分。任何优化必须以数据或测试佐证收益，避免过度优化与可读性损失，优化后运行测试确认无回归。".into(),
            model: String::new(),
            tools: vec!["shell".into(), "git".into()],
            enabled: true,
        },
    ]
}

/// 提示词模板：内置 5 个常用模板 + 用户自定义，支持 {{变量}} 占位。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    #[serde(default)]
    pub builtin: bool,
}

impl Default for PromptTemplate {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            content: String::new(),
            builtin: false,
        }
    }
}

/// 内置提示词模板（开箱即用，用户可编辑/删除）。
pub fn default_prompt_templates() -> Vec<PromptTemplate> {
    vec![
        PromptTemplate {
            id: "builtin-code-review".into(),
            name: "代码审查".into(),
            description: "审查代码变更，定位缺陷与改进点".into(),
            content: "请对以下代码进行审查，重点检查：逻辑错误与边界条件、安全问题、错误处理缺失、性能隐患、可维护性问题。按严重程度分级（严重/建议/可选），每条附具体位置与修改建议。\n\n{{file}}".into(),
            builtin: true,
        },
        PromptTemplate {
            id: "builtin-bug-analysis".into(),
            name: "Bug 分析".into(),
            description: "定位并解释 Bug 根因，给出修复方案".into(),
            content: "请分析以下问题：\n1. 复现步骤与现象\n2. 可能的根因（结合 {{workspace}} 中的相关代码）\n3. 修复方案与验证步骤\n\n{{file}}".into(),
            builtin: true,
        },
        PromptTemplate {
            id: "builtin-refactor".into(),
            name: "重构建议".into(),
            description: "识别重复与复杂度，给出重构方案".into(),
            content: "请对以下代码提出重构建议：识别重复代码、过高复杂度、糟糕命名与过长函数，遵循最小改动原则给出分步方案，每步可独立验证。\n\n{{file}}".into(),
            builtin: true,
        },
        PromptTemplate {
            id: "builtin-weekly-report".into(),
            name: "周报".into(),
            description: "根据本周变更生成结构化周报".into(),
            content: "请根据以下信息生成一份简洁的中文周报：本周完成事项、遇到的问题与解决、下周计划。语言简洁，分点列出。\n\n{{workspace}}".into(),
            builtin: true,
        },
        PromptTemplate {
            id: "builtin-learning-summary".into(),
            name: "学习总结".into(),
            description: "总结知识点并给出练习建议".into(),
            content: "请将以下内容整理成学习总结：核心概念、关键要点、易错点、练习建议。使用结构化 Markdown。\n\n{{file}}".into(),
            builtin: true,
        },
    ]
}

/// 工作流节点：子智能体 + 输入模板 + 依赖 + 条件（G7）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkflowNode {
    pub id: String,
    pub subagent_id: String,
    pub name: String,
    /// 输入模板，支持 {{input}}（工作流输入）与 {{prev_output}}（上一节点输出）
    pub input_template: String,
    /// 依赖节点 id 列表
    pub depends_on: Vec<String>,
    /// 执行条件：空 = 依赖全部成功后执行；"on_failure" = 依赖失败后执行
    pub condition: String,
    /// F-09: 失败自动重试次数（0 = 不重试，默认 1 次重试）
    pub retry: u32,
    /// F-09: 单次尝试超时（秒）；None = 不限时
    pub timeout_secs: Option<u64>,
    /// F-09: 节点输出（传递给下游与落盘）的最大字符数，默认 8000
    pub output_limit: Option<usize>,
}

impl Default for WorkflowNode {
    fn default() -> Self {
        Self {
            id: String::new(),
            subagent_id: String::new(),
            name: String::new(),
            input_template: String::new(),
            depends_on: Vec::new(),
            condition: String::new(),
            retry: 1,
            timeout_secs: None,
            output_limit: None,
        }
    }
}

/// 工作流定义（DAG）：节点列表 + 依赖关系（G7）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkflowConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub nodes: Vec<WorkflowNode>,
}

impl Default for WorkflowConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            nodes: Vec::new(),
        }
    }
}

/// 内置"审查流水线"工作流模板：代码审查 → 安全审查 → 文档审查 → 汇总。
pub fn default_workflows() -> Vec<WorkflowConfig> {
    vec![WorkflowConfig {
        id: "builtin-review-pipeline".into(),
        name: "审查流水线".into(),
        description: "代码审查 → 安全审查 → 文档审查，并行执行后汇总结论".into(),
        nodes: vec![
            WorkflowNode {
                id: "review".into(),
                subagent_id: "builtin-code-review".into(),
                name: "代码审查".into(),
                input_template: "请审查以下需求与代码：\n{{input}}".into(),
                depends_on: vec![],
                condition: String::new(),
                retry: 1,
                timeout_secs: None,
                output_limit: None,
            },
            WorkflowNode {
                id: "security".into(),
                subagent_id: "builtin-security-audit".into(),
                name: "安全审查".into(),
                input_template: "请对以下需求进行安全审计：\n{{input}}".into(),
                depends_on: vec![],
                condition: String::new(),
                retry: 1,
                timeout_secs: None,
                output_limit: None,
            },
            WorkflowNode {
                id: "docs".into(),
                subagent_id: "builtin-doc-writer".into(),
                name: "文档审查".into(),
                input_template: "请评估以下需求对应的文档完整性：\n{{input}}".into(),
                depends_on: vec![],
                condition: String::new(),
                retry: 1,
                timeout_secs: None,
                output_limit: None,
            },
            WorkflowNode {
                id: "summary".into(),
                subagent_id: "builtin-code-review".into(),
                name: "结果汇总".into(),
                input_template: "请汇总以下三个维度的审查结论，输出统一的行动清单：\n\n【代码审查】\n{{prev_output:review}}\n\n【安全审查】\n{{prev_output:security}}\n\n【文档审查】\n{{prev_output:docs}}".into(),
                depends_on: vec!["review".into(), "security".into(), "docs".into()],
                condition: String::new(),
                retry: 1,
                timeout_secs: None,
                output_limit: None,
            },
        ],
    }]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SubagentConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub model: String,
    pub tools: Vec<String>,
    pub enabled: bool,
}

impl Default for SubagentConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            system_prompt: String::new(),
            model: String::new(),
            tools: Vec::new(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopSettings {
    pub schema_version: u32,
    pub language: String,
    pub close_action: String,
    pub sound_enabled: bool,
    pub theme: String,
    pub font_scale: String,
    pub font_family: String,
    pub custom_font_family: Option<String>,
    pub session_display: String,
    pub terminal_shell: Option<String>,
    pub active_workspace: Option<String>,
    pub recent_workspaces: Vec<String>,
    pub default_provider_id: Option<String>,
    pub providers: Vec<ProviderConfig>,
    pub feature_toggles: HashMap<String, bool>,
    pub legacy_migration_complete: bool,
    pub github_user: Option<GitHubProfile>,
    pub subagents: Vec<SubagentConfig>,
    pub reasoning_effort: String,
    pub edit_mode: String,
    pub budget_usd: Option<f64>,
    pub show_system_events: bool,
    pub web_search_engine: String,
    pub headroom_enabled: bool,
    pub headroom_port: u16,
    /// 接近上下文窗口时自动压缩早期对话
    pub context_compression: bool,
    /// 模型上下文窗口（Token），用于估算压缩阈值
    pub context_window_tokens: u32,
    /// 每百万 Token 的统一估算单价（USD），用于预算与用量统计
    pub price_per_million_tokens: f64,
    /// 输出 Token 单价（USD/百万）。U-02：输入/输出分价计费；为 None 时
    /// 回退旧的统一单价算法（兼容既有 settings.json）。
    #[serde(default)]
    pub price_per_million_output_tokens: Option<f64>,
    /// 用量统计（跨会话累计）
    pub usage_stats: UsageStats,
    /// 快捷键映射（action → 按键组合），缺省项回退默认
    pub shortcuts: HashMap<String, String>,
    /// 首次启动引导是否已完成（G5）
    pub onboarding_completed: bool,
    /// 提示词模板库（G10）
    pub prompt_templates: Vec<PromptTemplate>,
    /// 工作流定义（G7）
    pub workflows: Vec<WorkflowConfig>,
    /// 网络配置（G12）：代理模式 / 请求超时 / 自动重试
    pub network: NetworkConfig,
    /// A-01: 优先使用 CLI Agent 内核（ACP）处理会话；连接失败自动回退自研循环。
    #[serde(default)]
    pub kernel_agent: bool,
    /// A-01: 内核可执行文件路径（WTH_LEADER_BIN 覆盖），为空走默认解析。
    #[serde(default)]
    pub kernel_agent_path: Option<String>,
    /// F-05: 测试验证循环 —— 每轮代码修改完成后在工作区根目录自动执行的
    /// 测试命令（如 `cargo test`）；为空则禁用自动验证。
    #[serde(default)]
    pub test_cmd: Option<String>,
    /// F-05: 测试失败后自动修复的最大轮数（默认 3）。
    #[serde(default)]
    pub verify_max_rounds: u32,
    /// F-08: SearXNG 实例地址（自托管，如 http://localhost:8080），选择 searxng 引擎时必填。
    #[serde(default)]
    pub searxng_url: Option<String>,
    /// F-06: 模型 fallback 链 —— 按 id 顺序排列的备用 Provider；主 Provider
    /// 请求失败（5xx/429/网络错误）时依次降级。仅主会话生效。
    #[serde(default)]
    pub fallback_provider_ids: Vec<String>,
    /// F-06 三阶段: 上下文压缩摘要使用的模型（角色路由——用更便宜的小模型
    /// 做摘要）。None = 跟随当前会话模型。
    #[serde(default)]
    pub summary_model: Option<String>,
    /// A-03 二阶段: shell 命令内存限额（MB）。None = 不限额（默认，
    /// 避免 cargo/rustc 重构建被误伤）。
    #[serde(default)]
    pub bash_memory_limit_mb: Option<u64>,
    /// 自动压缩触发比例（占上下文窗口的百分比，30–85）。默认 70，
    /// 与 CLI 内核 CompactionPolicy 对齐。
    #[serde(default = "default_compaction_ratio")]
    pub compaction_ratio_percent: u32,
}

fn default_compaction_ratio() -> u32 {
    70
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            language: default_language(),
            close_action: default_close_action(),
            sound_enabled: false,
            theme: default_theme(),
            font_scale: default_font_scale(),
            font_family: default_font_family(),
            custom_font_family: None,
            session_display: default_session_display(),
            terminal_shell: None,
            active_workspace: None,
            recent_workspaces: Vec::new(),
            default_provider_id: Some("agnes-default".into()),
            providers: vec![ProviderConfig {
                id: "agnes-default".into(),
                name: "Agnes AI (内置)".into(),
                kind: "openai-compatible".into(),
                base_url: "https://api.agnes-ai.cn/v1".into(),
                model: "agnes-3.0-flash".into(),
                enabled: true,
                builtin: true,
                local: false,
                price_input: None,
                price_output: None,
            }],
            feature_toggles: HashMap::new(),
            legacy_migration_complete: false,
            github_user: None,
            subagents: default_subagents(),
            reasoning_effort: default_reasoning_effort(),
            edit_mode: default_edit_mode(),
            budget_usd: None,
            show_system_events: true,
            web_search_engine: default_web_search_engine(),
            headroom_enabled: false,
            headroom_port: 8787,
            context_compression: true,
            context_window_tokens: 128_000,
            price_per_million_tokens: 2.0,
            price_per_million_output_tokens: None,
            usage_stats: UsageStats::default(),
            shortcuts: default_shortcuts(),
            onboarding_completed: false,
            prompt_templates: default_prompt_templates(),
            workflows: default_workflows(),
            network: NetworkConfig::default(),
            kernel_agent: false,
            kernel_agent_path: None,
            test_cmd: None,
            verify_max_rounds: 3,
            searxng_url: None,
            fallback_provider_ids: Vec::new(),
            summary_model: None,
            bash_memory_limit_mb: None,
            compaction_ratio_percent: default_compaction_ratio(),
        }
    }
}

/// 用量统计（由 agent 运行后累计，持久化到 settings.json）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageStats {
    pub total_tokens: u64,
    pub total_cost_usd: f64,
    pub today_tokens: u64,
    pub today_cost_usd: f64,
    pub week_tokens: u64,
    pub week_cost_usd: f64,
    /// 最近一次更新的日期（YYYY-MM-DD，用于跨天重置今日统计）
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubProfile {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub enabled: bool,
    /// 内置模型标记：由应用自带（如默认模型），不在设置界面展示。
    #[serde(default)]
    pub builtin: bool,
    /// 本地模型标记：Ollama / vLLM 等本机端点，无需 API Key 即可调用。
    #[serde(default)]
    pub local: bool,
    /// F-06: 该模型输入 Token 单价（USD/百万）；None 用全局价。
    #[serde(default)]
    pub price_input: Option<f64>,
    /// F-06: 该模型输出 Token 单价（USD/百万）；None 用全局价（或全局分价）。
    #[serde(default)]
    pub price_output: Option<f64>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: "openai-compatible".into(),
            base_url: String::new(),
            model: String::new(),
            enabled: true,
            builtin: false,
            local: false,
            price_input: None,
            price_output: None,
        }
    }
}

/// 网络配置（G12）：代理模式、请求超时与自动重试。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct NetworkConfig {
    /// 代理模式：off（关闭）/ system（系统代理）/ custom（自定义代理）
    pub proxy_mode: String,
    /// 自定义代理地址（proxy_mode = custom 时生效），如 http://127.0.0.1:7890
    pub proxy_url: Option<String>,
    /// 请求超时（秒），连接阶段超时；流式响应不设整体超时
    pub request_timeout_secs: u64,
    /// 是否启用自动重试（仅对连接失败与 5xx 生效）
    pub retry_enabled: bool,
    /// 最大重试次数（0~3）
    pub retry_max: u32,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            proxy_mode: "off".into(),
            proxy_url: None,
            request_timeout_secs: 15,
            retry_enabled: true,
            retry_max: 2,
        }
    }
}

impl NetworkConfig {
    /// 按配置构建 HTTP 客户端（G12）：代理模式 + 连接超时。
    /// 流式响应不设整体超时，只限制连接阶段，避免长流被切断。
    pub fn build_client(&self) -> Result<reqwest::Client, String> {
        let mut builder = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(self.request_timeout_secs.max(1)));
        match self.proxy_mode.as_str() {
            "off" => {
                builder = builder.no_proxy();
            }
            "custom" => {
                if let Some(proxy_url) = &self.proxy_url {
                    if !proxy_url.trim().is_empty() {
                        let proxy = reqwest::Proxy::all(proxy_url)
                            .map_err(|e| format!("代理地址无效：{e}"))?;
                        builder = builder.proxy(proxy);
                    }
                }
            }
            // "system"：不设置 proxy，reqwest 默认读取系统代理
            _ => {}
        }
        builder.build().map_err(|e| format!("HTTP 客户端构建失败：{e}"))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderSummary {
    #[serde(flatten)]
    pub config: ProviderConfig,
    pub has_api_key: bool,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct ProviderUpsertInput {
    #[serde(flatten)]
    pub config: ProviderConfig,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub active: bool,
}

pub fn load_settings(path: &Path) -> DesktopSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn validate(settings: &DesktopSettings) -> Result<(), String> {
    if !matches!(settings.language.as_str(), "zh-CN" | "en-US") {
        return Err("不支持的界面语言".into());
    }
    if !matches!(settings.close_action.as_str(), "tray" | "quit") {
        return Err("关闭行为必须是 tray 或 quit".into());
    }
    if !matches!(settings.theme.as_str(), "light" | "dark") {
        return Err("主题必须是 light 或 dark".into());
    }
    if !matches!(settings.font_scale.as_str(), "small" | "medium" | "large") {
        return Err("字体缩放无效".into());
    }
    if !matches!(settings.font_family.as_str(), "sans" | "system" | "serif" | "custom") {
        return Err("字体族无效".into());
    }
    if !matches!(settings.reasoning_effort.as_str(), "low" | "medium" | "high" | "max") {
        return Err("推理力度无效".into());
    }
    if !matches!(settings.edit_mode.as_str(), "plan" | "review" | "auto" | "yolo") {
        return Err("编辑模式无效".into());
    }
    if !matches!(
        settings.web_search_engine.as_str(),
        "duckduckgo" | "bing" | "searxng" | "tavily" | "brave" | "perplexity"
    ) {
        return Err("搜索引擎无效".into());
    }
    if !matches!(settings.session_display.as_str(), "standard" | "compact") {
        return Err("会话展示模式无效".into());
    }
    if settings.context_window_tokens == 0 {
        return Err("上下文窗口大小必须大于 0".into());
    }
    if settings.price_per_million_tokens < 0.0 {
        return Err("Token 单价不能为负数".into());
    }
    if settings
        .price_per_million_output_tokens
        .is_some_and(|p| p < 0.0)
    {
        return Err("输出 Token 单价不能为负数".into());
    }
    Ok(())
}

pub fn save_settings(path: &Path, settings: &DesktopSettings) -> Result<(), String> {
    validate(settings)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(settings).map_err(|e| format!("序列化设置失败：{e}"))?;
    std::fs::write(&tmp, json).map_err(|e| format!("写入临时设置失败：{e}"))?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("替换旧设置失败：{e}"))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("提交设置失败：{e}"))
}

pub fn persist_state_settings(state: &AppState) -> Result<(), String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?.clone();
    let path = state
        .settings_path
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    save_settings(&path, &settings)
}

/// 设置服务级 API Key（如 Tavily 搜索），写入 Windows 凭据管理器。
#[tauri::command]
pub async fn set_service_api_key(service: String, api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    crate::credentials::write_secret("service", &service, key)
}

/// 清除服务级 API Key。
#[tauri::command]
pub async fn clear_service_api_key(service: String) -> Result<(), String> {
    crate::credentials::delete_secret("service", &service)
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<DesktopSettings, String> {
    state
        .settings
        .read()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn settings_update(
    mut settings: DesktopSettings,
    state: State<'_, AppState>,
) -> Result<DesktopSettings, String> {
    settings.schema_version = SETTINGS_SCHEMA_VERSION;
    validate(&settings)?;
    {
        let mut guard = state.settings.write().map_err(|e| e.to_string())?;
        *guard = settings.clone();
    }
    persist_state_settings(&state)?;
    Ok(settings)
}

#[tauri::command]
pub async fn provider_list(state: State<'_, AppState>) -> Result<Vec<ProviderSummary>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    Ok(settings
        .providers
        .iter()
        .cloned()
        .map(|config| {
            let has_api_key = credentials::read_secret("provider", &config.id)
                .ok()
                .flatten()
                .is_some();
            let is_default = settings.default_provider_id.as_deref() == Some(config.id.as_str());
            ProviderSummary {
                config,
                has_api_key,
                is_default,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn provider_upsert(
    input: ProviderUpsertInput,
    state: State<'_, AppState>,
) -> Result<ProviderSummary, String> {
    let config = input.config;
    if config.id.trim().is_empty()
        || config.name.trim().is_empty()
        || config.base_url.trim().is_empty()
        || config.model.trim().is_empty()
    {
        return Err("提供商名称、地址和模型不能为空".into());
    }
    url::Url::parse(&config.base_url).map_err(|_| "API 地址不是有效 URL".to_string())?;
    if let Some(key) = input.api_key.as_deref().filter(|v| !v.trim().is_empty()) {
        credentials::write_secret("provider", &config.id, key.trim())?;
    }
    let is_default = {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        if let Some(existing) = settings.providers.iter_mut().find(|p| p.id == config.id) {
            *existing = config.clone();
        } else {
            settings.providers.push(config.clone());
        }
        if settings.default_provider_id.is_none() {
            settings.default_provider_id = Some(config.id.clone());
        }
        settings.default_provider_id.as_deref() == Some(config.id.as_str())
    };
    persist_state_settings(&state)?;
    Ok(ProviderSummary {
        has_api_key: credentials::read_secret("provider", &config.id)?.is_some(),
        config,
        is_default,
    })
}

#[tauri::command]
pub async fn provider_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.providers.retain(|provider| provider.id != id);
        if settings.default_provider_id.as_deref() == Some(id.as_str()) {
            settings.default_provider_id = settings.providers.first().map(|p| p.id.clone());
        }
    }
    credentials::delete_secret("provider", &id)?;
    persist_state_settings(&state)
}

#[tauri::command]
pub async fn provider_set_default(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        if !settings.providers.iter().any(|p| p.id == id && p.enabled) {
            return Err("提供商不存在或已停用".into());
        }
        settings.default_provider_id = Some(id);
    }
    persist_state_settings(&state)
}

#[tauri::command]
pub async fn provider_test(id: String, state: State<'_, AppState>) -> Result<String, String> {
    let provider = {
        let settings = state.settings.read().map_err(|e| e.to_string())?;
        settings
            .providers
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "提供商不存在".to_string())?
    };
    // 本地模型（Ollama / vLLM）通常无需 API Key
    let key = credentials::read_secret("provider", &provider.id)?.filter(|k| !k.trim().is_empty());
    if key.is_none() && !provider.local {
        return Err("尚未配置 API Key".into());
    }
    let endpoint = format!("{}/models", provider.base_url.trim_end_matches('/'));
    let network = state.settings.read().map_err(|e| e.to_string())?.network.clone();
    let client = network.build_client()?;
    let request = match (&key, provider.kind.as_str()) {
        (Some(k), "anthropic") => client
            .get(endpoint)
            .header("x-api-key", k.as_str())
            .header("anthropic-version", "2023-06-01"),
        (Some(k), _) => client.get(endpoint).bearer_auth(k),
        (None, _) => client.get(endpoint),
    };
    let response = request.send().await.map_err(|e| format!("连接失败：{e}"))?;
    if response.status().is_success() {
        Ok(format!("连接成功（HTTP {}）", response.status()))
    } else {
        Err(format!("服务返回 HTTP {}", response.status()))
    }
}

fn workspace_info(path: &Path, active: bool) -> WorkspaceInfo {
    WorkspaceInfo {
        path: path.to_string_lossy().to_string(),
        name: if active {
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("工作区")
                .to_string()
        } else {
            "不在工作区中工作".to_string()
        },
        exists: path.is_dir(),
        active,
    }
}

#[tauri::command]
pub async fn workspace_get(state: State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    let root = state
        .workspace_root
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let active = state
        .settings
        .read()
        .map_err(|e| e.to_string())?
        .active_workspace
        .is_some();
    Ok(workspace_info(&root, active))
}

#[tauri::command]
pub async fn workspace_recent(state: State<'_, AppState>) -> Result<Vec<WorkspaceInfo>, String> {
    let settings = state.settings.read().map_err(|e| e.to_string())?;
    let active = settings.active_workspace.as_deref();
    Ok(settings
        .recent_workspaces
        .iter()
        .map(PathBuf::from)
        .map(|path| {
            let is_active = active == Some(path.to_string_lossy().as_ref());
            workspace_info(&path, is_active)
        })
        .collect())
}

#[tauri::command]
pub async fn workspace_select(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceInfo, String> {
    let canonical = dunce::canonicalize(&path).map_err(|e| format!("工作区不存在：{e}"))?;
    if !canonical.is_dir() {
        return Err("所选路径不是目录".into());
    }
    let value = canonical.to_string_lossy().to_string();
    {
        *state.workspace_root.write().map_err(|e| e.to_string())? = canonical.clone();
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.active_workspace = Some(value.clone());
        settings.recent_workspaces.retain(|item| item != &value);
        settings.recent_workspaces.insert(0, value);
        settings.recent_workspaces.truncate(10);
    }
    persist_state_settings(&state)?;
    Ok(workspace_info(&canonical, true))
}

#[tauri::command]
pub async fn workspace_clear(state: State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    let fallback = dirs::home_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    {
        *state.workspace_root.write().map_err(|e| e.to_string())? = fallback.clone();
        let mut settings = state.settings.write().map_err(|e| e.to_string())?;
        settings.active_workspace = None;
    }
    persist_state_settings(&state)?;
    Ok(workspace_info(&fallback, false))
}

#[tauri::command]
pub async fn workspace_git_branch(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let workspace = state
        .workspace_root
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let mut current = workspace.as_path();
    let repo_root = loop {
        if current.join(".git").exists() {
            break Some(current.to_path_buf());
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break None,
        }
    };
    let Some(repo_root) = repo_root else {
        return Ok(None);
    };

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output();
    match output {
        Ok(result) if result.status.success() => {
            let branch = String::from_utf8_lossy(&result.stdout).trim().to_string();
            Ok((!branch.is_empty()).then_some(branch))
        }
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::NetworkConfig;

    #[test]
    fn network_config_defaults_are_safe() {
        let n = NetworkConfig::default();
        assert_eq!(n.proxy_mode, "off");
        assert_eq!(n.request_timeout_secs, 15);
        assert!(n.retry_enabled);
        assert_eq!(n.retry_max, 2);
        // 关闭模式下不应配置代理
        let client = n.build_client().unwrap();
        let _ = client; // 构建成功即可
    }
    use super::{DesktopSettings, default_shortcuts, default_subagents, load_settings, save_settings, validate};

    #[test]
    fn settings_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = DesktopSettings::default();
        settings.theme = "dark".into();
        save_settings(&path, &settings).unwrap();
        let loaded = load_settings(&path);
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.language, "zh-CN");
        assert_eq!(loaded.schema_version, 1);
    }

    #[test]
    fn load_settings_missing_file_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let settings = load_settings(&path);
        assert_eq!(settings.default_provider_id.as_deref(), Some("agnes-default"));
        assert!(!settings.providers.is_empty());
    }

    #[test]
    fn load_settings_corrupt_json_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not valid json").unwrap();
        let settings = load_settings(&path);
        assert_eq!(settings.theme, "light");
    }

    #[test]
    fn save_settings_rejects_invalid_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = DesktopSettings::default();
        settings.language = "fr-FR".into();
        assert!(save_settings(&path, &settings).is_err());
        settings.language = "zh-CN".into();
        settings.edit_mode = "bogus".into();
        assert!(save_settings(&path, &settings).is_err());
    }

    #[test]
    fn validate_accepts_default_settings() {
        let settings = DesktopSettings::default();
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn default_subagents_contains_core_roles() {
        let agents = default_subagents();
        assert!(agents.len() >= 6);
        assert!(agents.iter().any(|a| a.id == "builtin-code-review"));
        assert!(agents.iter().any(|a| a.id == "builtin-security-audit"));
        assert!(agents.iter().all(|a| a.enabled));
    }

    #[test]
    fn default_shortcuts_cover_required_actions() {
        let shortcuts = default_shortcuts();
        for action in ["toggle_window", "command_palette", "new_session", "send_message"] {
            assert!(shortcuts.contains_key(action), "缺少快捷键 {action}");
        }
    }

    #[test]
    fn default_workflows_contain_review_pipeline() {
        let workflows = super::default_workflows();
        assert!(!workflows.is_empty());
        let pipeline = workflows.iter().find(|w| w.id == "builtin-review-pipeline").unwrap();
        assert!(pipeline.nodes.len() >= 4);
        // 汇总节点依赖前三个并行节点
        let summary = pipeline.nodes.iter().find(|n| n.id == "summary").unwrap();
        assert_eq!(summary.depends_on.len(), 3);
    }

    #[test]
    fn default_prompt_templates_present() {
        let templates = super::default_prompt_templates();
        assert!(templates.len() >= 5);
        assert!(templates.iter().all(|t| t.builtin));
        assert!(templates.iter().any(|t| t.id == "builtin-code-review"));
    }

    #[test]
    fn onboarding_defaults_to_false() {
        let settings = DesktopSettings::default();
        assert!(!settings.onboarding_completed);
    }

    #[test]
    fn usage_stats_defaults_to_zero() {
        let settings = DesktopSettings::default();
        assert_eq!(settings.usage_stats.total_tokens, 0);
        assert_eq!(settings.usage_stats.total_cost_usd, 0.0);
        assert!(settings.usage_stats.last_updated.is_none());
    }
}
