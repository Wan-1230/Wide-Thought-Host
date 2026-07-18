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
  model?: string;
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
}

export interface TerminalInfo {
  id: string;
  pid: number;
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

export async function terminalSpawn(): Promise<TerminalInfo> {
  return invoke("terminal_spawn");
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

export async function sessionExport(id: string, format?: string): Promise<string> {
  return invoke("session_export", { id, format });
}
