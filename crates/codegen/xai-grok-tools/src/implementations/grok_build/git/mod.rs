//! `git_*` tools — first-class git operations (PRD F-04).
//!
//! Four tools give the model a safe, structured path through the most
//! common git workflow without shelling out through bash:
//!
//! - [`GitStatusTool`] (`git_status`) — working-tree state (read-only)
//! - [`GitDiffTool`] (`git_diff`) — staged/unstaged diffs (read-only)
//! - [`GitLogTool`] (`git_log`) — recent history (read-only)
//! - [`GitCommitTool`] (`git_commit`) — commit staged/all changes (write)
//!
//! v1 implementation runs the `git` CLI (porcelain formats, universally
//! available); migrating the plumbing onto `gix` is tracked in the PRD.
//! Read-only tools are classified `ToolKind::Read` so the permission layer
//! treats them like other inspections; `git_commit` is `ToolKind::Execute`
//! and therefore goes through the normal approval flow.

#[allow(unused_imports)]
use crate::types::resources::SharedResources;
use crate::types::tool::{ToolKind, ToolNamespace};

/// Output cap shared with other inspection tools (see
/// `DEFAULT_TOOL_OUTPUT_BYTES`); git output is text, so this is chars.
const MAX_OUTPUT_CHARS: usize = 40_000;

/// Run `git` in `cwd` and return trimmed stdout. Errors embed stderr so
/// the model can self-correct (e.g. "nothing to commit").
async fn run_git(cwd: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .await
        .map_err(|e| format!("failed to spawn git: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let hint = stderr.trim();
        return Err(if hint.is_empty() {
            format!(
                "git {} failed (exit {:?})",
                args.first().unwrap_or(&""),
                output.status.code()
            )
        } else {
            hint.to_string()
        });
    }
    Ok(truncate_output(stdout.trim()))
}

/// Clip oversized git output and append an explicit truncation notice so
/// the model knows the view is partial.
fn truncate_output(text: &str) -> String {
    if text.chars().count() <= MAX_OUTPUT_CHARS {
        return text.to_string();
    }
    let clipped: String = text.chars().take(MAX_OUTPUT_CHARS).collect();
    format!(
        "{clipped}\n\n[git output truncated at {MAX_OUTPUT_CHARS} characters; narrow the query (e.g. specific paths, fewer commits)]"
    )
}

// ─── git_status ─────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct GitStatusTool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct GitStatusInput {
    #[schemars(description = "Optional path (file or directory) to limit the status query to.")]
    pub path: Option<String>,
}

impl crate::types::tool_metadata::ToolMetadata for GitStatusTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Read
    }
    fn tool_namespace(&self) -> ToolNamespace {
        ToolNamespace::GrokBuild
    }
    fn description_template(&self) -> &str {
        r#"Show the working tree status of the current git repository (branch, staged and unstaged changes, untracked files) in porcelain format.
The optional 'path' parameter limits the query to a file or directory.

Use this before making changes to understand the current state, and after edits to see what changed."#
    }
}

impl xai_tool_runtime::Tool for GitStatusTool {
    type Args = GitStatusInput;
    type Output = GitToolOutput;
    fn id(&self) -> xai_tool_protocol::ToolId {
        xai_tool_protocol::ToolId::new("git_status").expect("valid tool id")
    }
    fn description(
        &self,
        _ctx: &::xai_tool_runtime::ListToolsContext,
    ) -> xai_tool_types::ToolDescription {
        xai_tool_types::ToolDescription::new(
            "git_status",
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
    #[tracing::instrument(name = "tool.git_status", skip_all)]
    async fn run(
        &self,
        ctx: xai_tool_runtime::ToolCallContext,
        input: GitStatusInput,
    ) -> Result<GitToolOutput, xai_tool_runtime::ToolError> {
        use crate::types::tool_metadata::{resolve_cwd, shared_resources};
        let resources = shared_resources(&ctx)?;
        let cwd = resolve_cwd(&ctx, &resources).await?;
        let mut args = vec!["status", "--porcelain=v1", "--branch"];
        if let Some(path) = input.path.as_deref().filter(|p| !p.trim().is_empty()) {
            args.push("--");
            args.push(path.trim());
        }
        match run_git(&cwd, &args).await {
            Ok(out) => Ok(GitToolOutput::Content(out)),
            Err(e) => Ok(GitToolOutput::Error(e)),
        }
    }
}

// ─── git_diff ───────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct GitDiffTool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct GitDiffInput {
    #[schemars(description = "Show staged changes instead of unstaged ones (--staged).")]
    pub staged: Option<bool>,
    #[schemars(description = "Optional path (file or directory) to limit the diff to.")]
    pub path: Option<String>,
}

impl crate::types::tool_metadata::ToolMetadata for GitDiffTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Read
    }
    fn tool_namespace(&self) -> ToolNamespace {
        ToolNamespace::GrokBuild
    }
    fn description_template(&self) -> &str {
        r#"Show unstaged changes as a unified diff (pass staged=true for staged changes).
The optional 'path' parameter limits the diff to a file or directory.

Use this to review exact modifications before committing."#
    }
}

impl xai_tool_runtime::Tool for GitDiffTool {
    type Args = GitDiffInput;
    type Output = GitToolOutput;
    fn id(&self) -> xai_tool_protocol::ToolId {
        xai_tool_protocol::ToolId::new("git_diff").expect("valid tool id")
    }
    fn description(
        &self,
        _ctx: &::xai_tool_runtime::ListToolsContext,
    ) -> xai_tool_types::ToolDescription {
        xai_tool_types::ToolDescription::new(
            "git_diff",
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
    #[tracing::instrument(name = "tool.git_diff", skip_all)]
    async fn run(
        &self,
        ctx: xai_tool_runtime::ToolCallContext,
        input: GitDiffInput,
    ) -> Result<GitToolOutput, xai_tool_runtime::ToolError> {
        use crate::types::tool_metadata::{resolve_cwd, shared_resources};
        let resources = shared_resources(&ctx)?;
        let cwd = resolve_cwd(&ctx, &resources).await?;
        let mut args = vec!["diff"];
        if input.staged.unwrap_or(false) {
            args.push("--staged");
        }
        if let Some(path) = input.path.as_deref().filter(|p| !p.trim().is_empty()) {
            args.push("--");
            args.push(path.trim());
        }
        match run_git(&cwd, &args).await {
            Ok(out) => Ok(GitToolOutput::Content(if out.is_empty() {
                "(no changes)".to_string()
            } else {
                out
            })),
            Err(e) => Ok(GitToolOutput::Error(e)),
        }
    }
}

// ─── git_log ────────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct GitLogTool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct GitLogInput {
    #[schemars(description = "Maximum number of commits to show (default 10, capped at 50).")]
    pub limit: Option<u32>,
}

impl crate::types::tool_metadata::ToolMetadata for GitLogTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Read
    }
    fn tool_namespace(&self) -> ToolNamespace {
        ToolNamespace::GrokBuild
    }
    fn description_template(&self) -> &str {
        r#"Show recent commit history (hash, author date, subject) newest first.
The 'limit' parameter caps the number of commits (default 10, max 50)."#
    }
}

impl xai_tool_runtime::Tool for GitLogTool {
    type Args = GitLogInput;
    type Output = GitToolOutput;
    fn id(&self) -> xai_tool_protocol::ToolId {
        xai_tool_protocol::ToolId::new("git_log").expect("valid tool id")
    }
    fn description(
        &self,
        _ctx: &::xai_tool_runtime::ListToolsContext,
    ) -> xai_tool_types::ToolDescription {
        xai_tool_types::ToolDescription::new(
            "git_log",
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
    #[tracing::instrument(name = "tool.git_log", skip_all)]
    async fn run(
        &self,
        ctx: xai_tool_runtime::ToolCallContext,
        input: GitLogInput,
    ) -> Result<GitToolOutput, xai_tool_runtime::ToolError> {
        use crate::types::tool_metadata::{resolve_cwd, shared_resources};
        let resources = shared_resources(&ctx)?;
        let cwd = resolve_cwd(&ctx, &resources).await?;
        let limit = input.limit.unwrap_or(10).clamp(1, 50);
        let limit_str = limit.to_string();
        match run_git(
            &cwd,
            &[
                "log",
                "--pretty=format:%h %ad %s",
                "--date=short",
                "-n",
                &limit_str,
            ],
        )
        .await
        {
            Ok(out) => Ok(GitToolOutput::Content(out)),
            Err(e) => Ok(GitToolOutput::Error(e)),
        }
    }
}

// ─── git_commit ─────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct GitCommitTool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct GitCommitInput {
    #[schemars(description = "Commit message (subject line). Multi-line messages: use \\n.")]
    pub message: String,
    #[schemars(
        description = "Stage ALL tracked-file changes before committing (like `git add -u`). Untracked files are never staged. Default false: commits only what is already staged."
    )]
    pub stage_all: Option<bool>,
}

impl crate::types::tool_metadata::ToolMetadata for GitCommitTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Execute
    }
    fn tool_namespace(&self) -> ToolNamespace {
        ToolNamespace::GrokBuild
    }
    fn description_template(&self) -> &str {
        r#"Commit the current git state with a concise, descriptive message.
Set stage_all=true to include changes to tracked files; untracked files are never staged automatically.

Other details:
    - Requires a non-empty message; write it in the repository's commit style.
    - The tool goes through the normal approval flow before running."#
    }
}

impl xai_tool_runtime::Tool for GitCommitTool {
    type Args = GitCommitInput;
    type Output = GitToolOutput;
    fn id(&self) -> xai_tool_protocol::ToolId {
        xai_tool_protocol::ToolId::new("git_commit").expect("valid tool id")
    }
    fn description(
        &self,
        _ctx: &::xai_tool_runtime::ListToolsContext,
    ) -> xai_tool_types::ToolDescription {
        xai_tool_types::ToolDescription::new(
            "git_commit",
            crate::types::tool_metadata::ToolMetadata::description_template(self),
        )
    }
    fn capabilities(&self) -> xai_tool_protocol::ToolCapabilities {
        xai_tool_protocol::ToolCapabilities {
            is_read_only: false,
            tool_scope: Some(xai_tool_protocol::ToolScope::Write),
            ..Default::default()
        }
    }
    #[tracing::instrument(name = "tool.git_commit", skip_all, fields(message = %input.message))]
    async fn run(
        &self,
        ctx: xai_tool_runtime::ToolCallContext,
        input: GitCommitInput,
    ) -> Result<GitToolOutput, xai_tool_runtime::ToolError> {
        use crate::types::tool_metadata::{resolve_cwd, shared_resources};
        let resources = shared_resources(&ctx)?;
        let cwd = resolve_cwd(&ctx, &resources).await?;
        let message = input.message.trim().to_string();
        if message.is_empty() {
            return Ok(GitToolOutput::Error(
                "commit message is empty; write a concise, descriptive subject".to_string(),
            ));
        }
        if input.stage_all.unwrap_or(false) {
            if let Err(e) = run_git(&cwd, &["add", "--update"]).await {
                return Ok(GitToolOutput::Error(format!(
                    "git add --update failed: {e}"
                )));
            }
        }
        match run_git(&cwd, &["commit", "-m", &message]).await {
            Ok(out) => Ok(GitToolOutput::Content(out)),
            Err(e) => Ok(GitToolOutput::Error(e)),
        }
    }
}

// ─── output type ────────────────────────────────────────────────────────────

/// Output for all git tools: formatted text or a classified error.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub enum GitToolOutput {
    /// Command stdout (trimmed, truncated at the char budget).
    Content(String),
    /// git exited non-zero or could not run; payload is stderr / reason.
    Error(String),
}

impl xai_tool_runtime::ToolOutput for GitToolOutput {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_output_leaves_short_text() {
        assert_eq!(truncate_output("abc"), "abc");
    }

    #[test]
    fn truncate_output_clips_and_notices() {
        let big = "x".repeat(MAX_OUTPUT_CHARS + 10);
        let out = truncate_output(&big);
        assert!(out.contains("git output truncated"));
        assert_eq!(out.chars().count(), MAX_OUTPUT_CHARS + "\n\n[git output truncated at 40000 characters; narrow the query (e.g. specific paths, fewer commits)]".chars().count());
    }

    #[tokio::test]
    async fn run_git_reports_missing_repo_stderr() {
        let tmp = std::env::temp_dir().join(format!("wth-git-tool-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let err = run_git(&tmp, &["status", "--porcelain=v1"])
            .await
            .unwrap_err();
        assert!(
            err.contains("not a git repository") || err.contains("git"),
            "unexpected error: {err}"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }
}
