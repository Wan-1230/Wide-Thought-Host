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
}

export interface AgentMessage {
  session_id: string;
  content: string;
  attachments?: Attachment[];
}

export interface StreamChunk {
  session_id: string;
  type: "text_delta" | "tool_call_start" | "tool_call_end" | "done" | "error";
  delta?: string;
  tool_id?: string;
  tool_name?: string;
  arguments?: unknown;
  result?: unknown;
  usage?: UsageInfo;
  message?: string;
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

export interface DesktopSettings {
  schema_version: number;
  language: "zh-CN" | "en-US";
  close_action: "tray" | "quit";
  sound_enabled: boolean;
  theme: "light" | "dark";
  session_display: "standard" | "compact";
  terminal_shell?: string | null;
  active_workspace?: string | null;
  recent_workspaces: string[];
  default_provider_id?: string | null;
  providers: ProviderConfig[];
  feature_toggles: Record<string, boolean>;
  legacy_migration_complete: boolean;
  github_user?: GitHubProfile | null;
}

export interface GitHubProfile { login: string; name?: string | null; avatar_url?: string | null; }
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
}

export interface ProviderSummary extends ProviderConfig {
  has_api_key: boolean;
  is_default: boolean;
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
  return listen<StreamChunk>("agent:stream", (event) => cb(event.payload));
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

export async function terminalSpawn(args?: { shell?: string; cwd?: string; cols?: number; rows?: number }): Promise<TerminalInfo> {
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

export function onTerminalData(cb: (event: { id: string; data: string }) => void): Promise<UnlistenFn> {
  return listen("terminal:data", (event) => cb(event.payload as { id: string; data: string }));
}

export function onTerminalExit(cb: (event: TerminalExit) => void): Promise<UnlistenFn> {
  return listen<TerminalExit>("terminal:exit", (event) => cb(event.payload));
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
export const workspaceGet = () => invoke<WorkspaceInfo>("workspace_get");
export const workspaceRecent = () => invoke<WorkspaceInfo[]>("workspace_recent");
export const workspaceSelect = (path: string) => invoke<WorkspaceInfo>("workspace_select", { path });
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
