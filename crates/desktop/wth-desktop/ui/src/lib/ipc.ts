// IPC bridge — wraps all Tauri invoke calls into typed async functions.
// Handles streaming events via Tauri event system.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ─── Types ───────────────────────────────────────────

export interface Attachment {
  name: string;
  path?: string;
  content?: string;
  mime_type: string;
  /** 图片类附件的 base64 data URL（多模态） */
  data_url?: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentMessage {
  session_id: string;
  content: string;
  attachments?: Attachment[];
  /** 本次请求附带的系统指令（技能 SKILL.md 等），仅单次请求生效 */
  system_instruction?: string;
  /** 历史对话（当前消息之前的 user/assistant 对） */
  history?: HistoryMessage[];
}

export interface StreamChunk {
  session_id: string;
  type: "text_delta" | "tool_call_start" | "tool_call_end" | "done" | "error" | "phase";
  delta?: string;
  tool_id?: string;
  tool_name?: string;
  arguments?: unknown;
  needs_approval?: boolean;
  result?: unknown;
  usage?: UsageInfo;
  message?: string;
  /** U-03: working / checking / verifying */
  phase?: string;
}

/** 子智能体委派结果事件（agent:subagent_result）。 */
export interface SubagentResultEvent {
  parent_session_id: string;
  sub_session_id: string;
  subagent_name: string;
  status: "done" | "error";
  error?: string;
}

/** 待用户确认的工具调用事件（agent:approval）。 */
export interface ApprovalEvent {
  session_id: string;
  tool_id: string;
  tool_name: string;
  arguments: unknown;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: FileEntry[];
}

export interface SessionInfo {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  model: string;
  pinned?: boolean;
}

export interface TerminalInfo {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
}

export interface TerminalExit {
  id: string;
  exit_code?: number;
  message?: string;
}

export type FontScale = "small" | "medium" | "large";
export type FontFamily = "sans" | "system" | "serif" | "custom";
export type ReasoningEffort = "low" | "medium" | "high" | "max";
export type EditMode = "plan" | "review" | "auto" | "yolo";

export interface UsageStats {
  total_tokens: number;
  total_cost_usd: number;
  today_tokens: number;
  today_cost_usd: number;
  week_tokens: number;
  week_cost_usd: number;
  last_updated?: string | null;
  by_model?: ModelUsage[];
  recent_sessions?: SessionUsage[];
  tool_calls_ok?: number;
  tool_calls_fail?: number;
  compaction_count?: number;
  compaction_failures?: number;
}

export interface DesktopSettings {
  schema_version: number;
  language: "zh-CN" | "en-US";
  close_action: "tray" | "quit";
  sound_enabled: boolean;
  theme: "light" | "dark";
  font_scale: FontScale;
  font_family: FontFamily;
  custom_font_family?: string | null;
  session_display: "standard" | "compact";
  terminal_shell?: string | null;
  active_workspace?: string | null;
  recent_workspaces: string[];
  default_provider_id?: string | null;
  providers: ProviderConfig[];
  feature_toggles: Record<string, boolean>;
  legacy_migration_complete: boolean;
  github_user?: GitHubProfile | null;
  reasoning_effort: ReasoningEffort;
  edit_mode: EditMode;
  budget_usd?: number | null;
  /** 单次会话预算上限（USD） */
  session_budget_usd?: number | null;
  show_system_events: boolean;
  web_search_engine: string;
  headroom_enabled: boolean;
  headroom_port: number;
  context_compression: boolean;
  context_window_tokens: number;
  price_per_million_tokens: number;
  price_per_million_output_tokens?: number | null;
  kernel_agent?: boolean;
  kernel_agent_path?: string | null;
  test_cmd?: string | null;
  verify_max_rounds?: number;
  searxng_url?: string | null;
  fallback_provider_ids?: string[];
  summary_model?: string | null;
  bash_memory_limit_mb?: number | null;
  /** 自动压缩触发比例（占上下文窗口 %，30–85） */
  compaction_ratio_percent?: number;
  /** shell/git 工具超时（秒），5–600，默认 60 */
  shell_timeout_secs?: number;
  /** 网络出口白名单（域名后缀），空 = 不限制 */
  network_allowlist?: string[];
  /** 子进程沙箱：job | restricted */
  sandbox_profile?: "job" | "restricted";
  /** 子代理最大并行数 1–4 */
  subagent_parallel?: number;
  usage_stats: UsageStats;
  subagents?: SubagentConfig[];
  /** 快捷键映射（action → 按键组合） */
  shortcuts?: Record<string, string>;
  onboarding_completed: boolean;
  prompt_templates: PromptTemplate[];
  workflows?: WorkflowConfig[];
  network: NetworkConfig;
}

export interface NetworkConfig {
  proxy_mode: "off" | "system" | "custom";
  proxy_url?: string | null;
  request_timeout_secs: number;
  retry_enabled: boolean;
  retry_max: number;
}

export interface GitHubProfile {
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}
export interface GitHubAuthStatus {
  state: "signed_in" | "signed_out" | "pending" | "denied" | "expired" | "error";
  user?: GitHubProfile | null;
  user_code?: string | null;
  verification_uri?: string | null;
  expires_in?: number | null;
  message?: string | null;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  model: string;
  enabled: boolean;
  /** 内置模型标记：由应用自带，不在设置界面展示 */
  builtin?: boolean;
  local?: boolean;
  price_input?: number | null;
  price_output?: number | null;
}

export interface ProviderSummary extends ProviderConfig {
  has_api_key: boolean;
  is_default: boolean;
}

export interface ModelUsage {
  model: string;
  tokens: number;
  cost_usd: number;
  calls: number;
}

export interface SessionUsage {
  session_id: string;
  model: string;
  tokens: number;
  cost_usd: number;
  at: string;
}

export interface PermissionPolicySnapshot {
  edit_mode: string;
  allow_auto_file_edit: boolean;
  require_confirm_bash: boolean;
  require_confirm_dangerous_in_yolo: boolean;
  require_confirm_sensitive_path: boolean;
  shell_timeout_secs: number;
  memory_limit_mb?: number | null;
  description: string;
}

export interface MetricsSummary {
  total_tokens: number;
  total_cost_usd: number;
  today_tokens: number;
  today_cost_usd: number;
  week_tokens: number;
  week_cost_usd: number;
  tool_calls_ok: number;
  tool_calls_fail: number;
  tool_success_rate: number;
  compaction_count: number;
  compaction_failures: number;
  by_model: ModelUsage[];
  recent_sessions: SessionUsage[];
  permission: PermissionPolicySnapshot;
}

export interface WorkspaceInfo {
  path: string;
  name: string;
  exists: boolean;
  active: boolean;
}

export interface CapabilitySource {
  label: string;
  scope: string;
  path: string;
  exists: boolean;
  item_count: number;
}

export interface CapabilityItem {
  id: string;
  toggle_key: string;
  name: string;
  description: string;
  path: string;
  scope: string;
  kind: string;
  enabled: boolean;
  tags: string[];
  status: string;
}

export interface CapabilityStats {
  sources: number;
  items: number;
  enabled: number;
}

export interface CapabilityView {
  kind: string;
  title: string;
  subtitle: string;
  search_placeholder: string;
  sources: CapabilitySource[];
  items: CapabilityItem[];
  stats: CapabilityStats;
}

// ─── Agent ───────────────────────────────────────────

export async function agentSend(msg: AgentMessage): Promise<void> {
  return invoke("agent_send", { message: msg });
}

export async function agentAbort(sessionId: string): Promise<void> {
  return invoke("agent_abort", { sessionId });
}

export function onAgentStream(cb: (chunk: StreamChunk) => void): Promise<UnlistenFn> {
  return listen<StreamChunk>("agent:stream", event => cb(event.payload));
}

export function onSubagentResult(cb: (evt: SubagentResultEvent) => void): Promise<UnlistenFn> {
  return listen<SubagentResultEvent>("agent:subagent_result", event => cb(event.payload));
}

export async function subagentRun(
  subagentId: string,
  task: string,
  parentSessionId: string,
): Promise<string> {
  return invoke("subagent_run", { subagentId, task, parentSessionId });
}

export function onAgentApproval(cb: (evt: ApprovalEvent) => void): Promise<UnlistenFn> {
  return listen<ApprovalEvent>("agent:approval", event => cb(event.payload));
}

export async function agentApproveTool(sessionId: string, toolCallId: string): Promise<void> {
  return invoke("agent_approve_tool", { sessionId, toolCallId });
}

export async function agentDenyTool(sessionId: string, toolCallId: string): Promise<void> {
  return invoke("agent_deny_tool", { sessionId, toolCallId });
}

export async function setServiceApiKey(service: string, apiKey: string): Promise<void> {
  return invoke("set_service_api_key", { service, apiKey });
}

export async function clearServiceApiKey(service: string): Promise<void> {
  return invoke("clear_service_api_key", { service });
}

// ─── Filesystem ──────────────────────────────────────

export async function fileRead(path: string): Promise<string> {
  return invoke("file_read", { args: { path } });
}

export async function fileWrite(path: string, content: string): Promise<void> {
  return invoke("file_write", { args: { path, content } });
}

export async function fileDelete(path: string): Promise<void> {
  return invoke("file_delete", { path });
}

export async function fileList(path: string, recursive = false): Promise<FileEntry[]> {
  return invoke("file_list", { args: { path, recursive } });
}

// ─── Terminal ────────────────────────────────────────

export async function terminalSpawn(args?: {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}): Promise<TerminalInfo> {
  return invoke("terminal_spawn", { args: args ?? null });
}

export async function terminalWrite(id: string, data: string): Promise<void> {
  return invoke("terminal_write", { id, data });
}

export async function terminalResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke("terminal_resize", { args: { id, cols, rows } });
}

export async function terminalKill(id: string): Promise<void> {
  return invoke("terminal_kill", { id });
}

export function onTerminalData(
  cb: (event: { id: string; data: string }) => void,
): Promise<UnlistenFn> {
  return listen("terminal:data", event => cb(event.payload as { id: string; data: string }));
}

export function onTerminalExit(cb: (event: TerminalExit) => void): Promise<UnlistenFn> {
  return listen<TerminalExit>("terminal:exit", event => cb(event.payload));
}

// ─── 设置、模型与工作区 ─────────────────────────────

export const settingsGet = () => invoke<DesktopSettings>("settings_get");
export const settingsUpdate = (settings: DesktopSettings) =>
  invoke<DesktopSettings>("settings_update", { settings });
export const providerList = () => invoke<ProviderSummary[]>("provider_list");
export const providerUpsert = (config: ProviderConfig, apiKey?: string) =>
  invoke<ProviderSummary>("provider_upsert", { input: { ...config, api_key: apiKey || null } });
export const providerDelete = (id: string) => invoke<void>("provider_delete", { id });
export const providerSetDefault = (id: string) => invoke<void>("provider_set_default", { id });
export const providerTest = (id: string) => invoke<string>("provider_test", { id });
export const metricsSummary = () => invoke<MetricsSummary>("metrics_summary");
export const tasksListRecent = () =>
  invoke<{ name: string; content: string; mtime: string }[]>("tasks_list_recent");
export const localProvidersDetect = () =>
  invoke<{ kind: string; base_url: string; models: string[] }[]>("local_providers_detect");
export const workspaceGet = () => invoke<WorkspaceInfo>("workspace_get");
export const workspaceRecent = () => invoke<WorkspaceInfo[]>("workspace_recent");
export const workspaceSelect = (path: string) =>
  invoke<WorkspaceInfo>("workspace_select", { path });
export const workspaceClear = () => invoke<WorkspaceInfo>("workspace_clear");
export const workspaceGitBranch = () => invoke<string | null>("workspace_git_branch");
export const githubAuthStatus = () => invoke<GitHubAuthStatus>("github_auth_status");
export const githubAuthStart = () => invoke<GitHubAuthStatus>("github_auth_start");
export const githubAuthPoll = () => invoke<GitHubAuthStatus>("github_auth_poll");
export const githubAuthCancel = () => invoke<void>("github_auth_cancel");
export const githubAuthLogout = () => invoke<void>("github_auth_logout");
export const capabilityView = (kind: string) => invoke<CapabilityView>("capability_view", { kind });
export const openPathInExplorer = (path: string) => invoke<void>("open_path_in_explorer", { path });

// ─── Sessions ────────────────────────────────────────

export async function sessionList(): Promise<SessionInfo[]> {
  return invoke("session_list");
}

export async function sessionCreate(title: string, model: string): Promise<SessionInfo> {
  return invoke("session_create", { args: { title, model } });
}

export async function sessionDelete(id: string): Promise<void> {
  return invoke("session_delete", { id });
}

export async function sessionRename(id: string, title: string): Promise<SessionInfo> {
  return invoke("session_rename", { id, title });
}

export async function sessionSetPinned(id: string, pinned: boolean): Promise<SessionInfo> {
  return invoke("session_set_pinned", { id, pinned });
}

export async function sessionExport(id: string, format?: string): Promise<string> {
  return invoke("session_export", { id, format });
}

export async function openInExplorer(path: string): Promise<void> {
  return invoke("open_in_explorer", { path });
}

// ─── MCP Servers ─────────────────────────────────────

export interface McpServerConfig {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: string;
  enabled: boolean;
  status: "online" | "offline" | "error" | "unknown";
  tool_count: number;
}

export const mcpListServers = () => invoke<McpServerConfig[]>("mcp_list_servers");
export const mcpAddServer = (config: Omit<McpServerConfig, "id" | "status" | "tool_count">) =>
  invoke<McpServerConfig>("mcp_add_server", { config });
export const mcpRemoveServer = (id: string) => invoke<void>("mcp_remove_server", { id });
export const mcpTestServer = (id: string) => invoke<string>("mcp_test_server", { id });

// ─── Hooks ───────────────────────────────────────────

export interface HookConfig {
  id: string;
  name: string;
  trigger: "session_start" | "tool_before" | "tool_after" | "message_before" | "message_after";
  command: string;
  enabled: boolean;
}

export const hookList = () => invoke<HookConfig[]>("hook_list");
export const hookAdd = (config: Omit<HookConfig, "id">) =>
  invoke<HookConfig>("hook_add", { config });
export const hookRemove = (id: string) => invoke<void>("hook_remove", { id });
export const hookToggle = (id: string, enabled: boolean) =>
  invoke<void>("hook_toggle", { id, enabled });

// ─── Sub-agents ──────────────────────────────────────

export interface SubagentConfig {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  tools: string[];
  enabled: boolean;
}

export const subagentList = () => invoke<SubagentConfig[]>("subagent_list");
export const subagentAdd = (config: Omit<SubagentConfig, "id">) =>
  invoke<SubagentConfig>("subagent_add", { config });
export const subagentRemove = (id: string) => invoke<void>("subagent_remove", { id });
export const subagentToggle = (id: string, enabled: boolean) =>
  invoke<void>("subagent_toggle", { id, enabled });

// ─── Memory ──────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  title: string;
  tags: string[];
  created_at: string;
  summary: string;
  content: string;
  scope: string;
  path: string;
}

export interface DiagnosticItem {
  name: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

export const diagnosticsGet = () => invoke<DiagnosticItem[]>("diagnostics_get");

export interface AppInfo {
  version: string;
  build_time: string;
  signed: boolean;
}

export const appInfo = () => invoke<AppInfo>("app_info");

export const pluginImport = (sourceDir: string) => invoke<string>("plugin_import", { sourceDir });

export interface PluginMarketEntry {
  name: string;
  description: string;
  version: string;
  author: string;
  download_url: string;
  sha256: string;
  permissions: string[];
  verified: boolean;
}

export interface PluginMarketItem {
  entry: PluginMarketEntry;
  installed: boolean;
  installed_version: string | null;
  has_update: boolean;
}

export interface PluginMarketList {
  source: string;
  entries: PluginMarketItem[];
  error: string | null;
}

export const pluginMarketList = (source?: string) =>
  invoke<PluginMarketList>("plugin_market_list", { source });
export const pluginMarketInstall = (entry: PluginMarketEntry) =>
  invoke<string>("plugin_market_install", { entry });
export const pluginUninstall = (name: string) => invoke<string>("plugin_uninstall", { name });

export interface UpdateCheckInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_url: string;
  notes: string;
}

export const updateCheck = () => invoke<UpdateCheckInfo>("update_check");

export interface UpdateDownloadResult {
  file_path: string;
  file_name: string;
  bytes: number;
  sha256: string;
  verified: boolean;
}

export interface UpdateProgress {
  received: number;
  total: number;
  percent: number;
}

export const updateDownload = () => invoke<UpdateDownloadResult>("update_download");

export interface WorkspaceSearchHit {
  path: string;
  line: number;
  snippet: string;
  score: number;
}

export const workspaceSearch = (query: string, limit?: number) =>
  invoke<WorkspaceSearchHit[]>("workspace_search", { query, limit });

export interface WorkspaceIndexStatus {
  workspace: string;
  file_count: number;
  cache_path: string;
  semantic_engine: string;
  semantic_model: string | null;
}

export const workspaceIndexStatus = () => invoke<WorkspaceIndexStatus>("workspace_index_status");
export const workspaceIndexRebuild = () => invoke<WorkspaceIndexStatus>("workspace_index_rebuild");
export const workspaceIndexClear = () => invoke<WorkspaceIndexStatus>("workspace_index_clear");

export const memoryList = () => invoke<MemoryEntry[]>("memory_list");
export const memoryWrite = (
  title: string,
  content: string,
  tags?: string[],
  scope?: "user" | "workspace",
) => invoke<MemoryEntry>("memory_write", { title, content, tags, scope });
export const memoryDelete = (id: string) => invoke<void>("memory_delete", { id });

// ─── Headroom ────────────────────────────────────────

export interface HeadroomStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  installed: boolean;
  proxy_url: string | null;
  error: string | null;
}

export const headroomStatus = () => invoke<HeadroomStatus>("headroom_status");
export const headroomIsInstalled = () => invoke<boolean>("headroom_is_installed");
export const headroomStart = (port: number) => invoke<HeadroomStatus>("headroom_start", { port });
export const headroomStop = () => invoke<HeadroomStatus>("headroom_stop");
export const headroomInstall = () => invoke<string>("headroom_install");

// ─── Slash Commands ──────────────────────────────────

export interface SlashCommandInfo {
  name: string;
  description: string;
  source: string;
  scope: string;
  path?: string | null;
}

export const listSlashCommands = () => invoke<SlashCommandInfo[]>("list_slash_commands");
export const resolveSkill = (name: string) => invoke<string>("resolve_skill", { name });

// ─── G2: 数据备份 / 恢复 / 配置导入导出 ─────────────

export interface BackupResult {
  path: string;
  file_count: number;
  bytes: number;
  created_at: string;
}

export const backupCreate = (targetPath: string) =>
  invoke<BackupResult>("backup_create", { targetPath });
export const backupRestore = (sourcePath: string) =>
  invoke<string>("backup_restore", { sourcePath });
export const configExport = (targetPath: string) => invoke<string>("config_export", { targetPath });
export const configImport = (sourcePath: string) => invoke<string>("config_import", { sourcePath });
// ─── G3: 消息持久化 / 实时日志 ───────────────────────

export const sessionSaveMessages = (id: string, messages: unknown[]) =>
  invoke<void>("session_save_messages", { id, messages });
export const sessionLoadMessages = (id: string) =>
  invoke<unknown[]>("session_load_messages", { id });
export const logList = () => invoke<string[]>("log_list");
// ─── G7: 多 Agent 工作流 ─────────────────────────────────

export interface WorkflowNode {
  id: string;
  subagent_id: string;
  name: string;
  input_template: string;
  depends_on: string[];
  condition: string;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
}

export interface WorkflowRunResult {
  node_id: string;
  node_name: string;
  status: string;
  output: string;
  sub_session_id: string;
  error?: string | null;
}

export interface WorkflowDoneEvent {
  run_id: string;
  config_id: string;
  config_name: string;
  status: string;
  results: WorkflowRunResult[];
}

export interface WorkflowProgressEvent {
  run_id: string;
  config_id: string;
  node_id: string;
  node_name: string;
  status: string;
  error: string;
}

export const workflowList = () => invoke<WorkflowConfig[]>("workflow_list");
export const workflowSave = (config: WorkflowConfig) =>
  invoke<WorkflowConfig>("workflow_save", { config });
export const workflowDelete = (id: string) => invoke<void>("workflow_delete", { id });
export const workflowRun = (configId: string, input: string) =>
  invoke<string>("workflow_run", { configId, input });
export const workflowValidate = (configId: string) =>
  invoke<string[]>("workflow_validate", { configId });
export const onWorkflowProgress = (cb: (evt: WorkflowProgressEvent) => void) =>
  listen<WorkflowProgressEvent>("workflow:progress", e => cb(e.payload));
export const onWorkflowDone = (cb: (evt: WorkflowDoneEvent) => void) =>
  listen<WorkflowDoneEvent>("workflow:done", e => cb(e.payload));

// ─── G10: 提示词模板与团队配置 ─────────────────────────

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  builtin: boolean;
}

export const teamConfigExport = (targetPath: string) =>
  invoke<string>("team_config_export", { targetPath });
export const teamConfigImport = (sourcePath: string) =>
  invoke<string>("team_config_import", { sourcePath });

// ─── G4: 消息全文检索 ────────────────────────────────

export interface MessageSearchHit {
  session_id: string;
  session_title: string;
  message_index: number;
  role: string;
  snippet: string;
  timestamp: string;
}

export const sessionSearch = (query: string, limit?: number) =>
  invoke<MessageSearchHit[]>("session_search", { query, limit });
