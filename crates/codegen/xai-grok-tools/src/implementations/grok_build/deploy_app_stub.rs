//! Stub surface when the deploy feature is off.

use crate::types::tool::{ToolKind, ToolNamespace};

/// Placeholder config — deploy is unavailable in this build.
#[derive(Debug, Clone, Default)]
pub enum AppBuilderDeployerConfig {
    #[default]
    Disabled,
}

impl AppBuilderDeployerConfig {
    pub fn is_enabled(&self) -> bool {
        false
    }
}

pub const DEPLOY_APP_TOOL_NAME: &str = "deploy_app";

/// F-12: Disabled 状态下的占位工具——注册进注册表以满足 toolset 引用，
/// 调用时返回明确的"未启用"错误（而不是工具缺失导致 finalize 失败）。
#[derive(Debug, Default)]
pub struct DeployAppStubTool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct DeployAppInput {}

impl crate::types::tool_metadata::ToolMetadata for DeployAppStubTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Execute
    }
    fn tool_namespace(&self) -> ToolNamespace {
        ToolNamespace::GrokBuild
    }
    fn description_template(&self) -> &str {
        r#"Deploy the current app to the managed app-builder service.

Other details:
    - The deploy feature is NOT enabled in this build; calling it always
      returns an explicit "feature disabled" error."#
    }
}

impl xai_tool_runtime::Tool for DeployAppStubTool {
    type Args = DeployAppInput;
    type Output = DeployAppOutput;
    fn id(&self) -> xai_tool_protocol::ToolId {
        xai_tool_protocol::ToolId::new(DEPLOY_APP_TOOL_NAME).expect("valid tool id")
    }
    fn description(
        &self,
        _ctx: &::xai_tool_runtime::ListToolsContext,
    ) -> xai_tool_types::ToolDescription {
        xai_tool_types::ToolDescription::new(
            DEPLOY_APP_TOOL_NAME,
            crate::types::tool_metadata::ToolMetadata::description_template(self),
        )
    }
    fn capabilities(&self) -> xai_tool_protocol::ToolCapabilities {
        xai_tool_protocol::ToolCapabilities {
            is_read_only: true,
            tool_scope: Some(xai_tool_protocol::ToolScope::Read),
            ..Default::default()
        }
    }
    async fn run(
        &self,
        _ctx: xai_tool_runtime::ToolCallContext,
        _input: DeployAppInput,
    ) -> Result<DeployAppOutput, xai_tool_runtime::ToolError> {
        Ok(DeployAppOutput::Error(
            "deploy_app 未启用：本构建不包含应用部署特性（AppBuilderDeployerConfig::Disabled）"
                .to_string(),
        ))
    }
}

/// 占位工具输出。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub enum DeployAppOutput {
    Error(String),
}

impl xai_tool_runtime::ToolOutput for DeployAppOutput {}
