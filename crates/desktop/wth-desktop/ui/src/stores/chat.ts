// Zustand store for chat/session state.

import { create } from "zustand";

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = obj;
  void _removed;
  return rest;
}
import type { SessionInfo, StreamChunk, UsageInfo } from "@/lib/ipc";

export const THINKING_MESSAGE = "模型正在思考…";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  timestamp: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
  result?: unknown;
  /** pending=等待用户确认；running=执行中；done=已完成 */
  status?: "pending" | "running" | "done";
  needsApproval?: boolean;
}

interface ChatStore {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  streaming: Record<string, boolean>;
  /** U-03: 会话当前阶段 working/checking/verifying */
  phase: Record<string, string>;
  usage: Record<string, UsageInfo>;
  /** 并行子智能体运行跟踪（session_id → 批次状态），用于结果汇总 */
  parallel: Record<string, { total: number; done: number; names: string[]; statuses: Record<string, "done" | "error"> }>;

  setSessions: (sessions: SessionInfo[]) => void;
  setActiveSession: (id: string) => void;
  upsertSession: (session: SessionInfo) => void;
  removeSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  pinSession: (sessionId: string, pinned: boolean) => void;
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  setMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  truncateMessages: (sessionId: string, fromMessageId: string) => void;
  appendToLastMessage: (sessionId: string, delta: string) => void;
  finalizeAssistantMessage: (sessionId: string, fallback: string) => void;
  setStreaming: (sessionId: string, active: boolean) => void;
  setPhase: (sessionId: string, phase: string | null) => void;
  addUsage: (sessionId: string, usage: UsageInfo) => void;
  registerParallelRun: (sessionId: string, names: string[]) => void;
  completeParallelRun: (sessionId: string, subSessionId: string, ok: boolean, name: string) => void;
  clearParallelRun: (sessionId: string) => void;
  addToolCall: (sessionId: string, call: ToolCall) => void;
  updateToolCall: (sessionId: string, toolId: string, patch: Partial<ToolCall>) => void;
  updateToolCallResult: (sessionId: string, toolId: string, result: unknown) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  streaming: {},
  phase: {},
  usage: {},
  parallel: {},

  registerParallelRun: (sessionId, names) =>
    set((state) => ({
      parallel: {
        ...state.parallel,
        [sessionId]: { total: names.length, done: 0, names, statuses: {} },
      },
    })),

  completeParallelRun: (sessionId, subSessionId, ok, name) =>
    set((state) => {
      const p = state.parallel[sessionId];
      if (!p) return state;
      return {
        parallel: {
          ...state.parallel,
          [sessionId]: {
            ...p,
            done: p.done + 1,
            statuses: { ...p.statuses, [subSessionId]: ok ? "done" : "error" },
          },
        },
      };
    }),

  clearParallelRun: (sessionId) =>
    set((state) => {
      const { [sessionId]: removed, ...parallel } = state.parallel;
      void removed;
      return { parallel };
    }),

  setSessions: (sessions) =>
    set({
      sessions: [...sessions].sort((a, b) => {
        const pinDelta = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        if (pinDelta !== 0) return pinDelta;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }),
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  upsertSession: (session) =>
    set((state) => {
      const sessions = state.sessions.filter((item) => item.id !== session.id);
      sessions.push(session);
      sessions.sort((a, b) => {
        const pinDelta = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        if (pinDelta !== 0) return pinDelta;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
      return { sessions };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = state.sessions.filter((item) => item.id !== sessionId);
      const { [sessionId]: removedMessages, ...messages } = state.messages;
      const { [sessionId]: removedStreaming, ...streaming } = state.streaming;
      const { [sessionId]: removedUsage, ...usage } = state.usage;
      void removedMessages;
      void removedStreaming;
      void removedUsage;
      return {
        sessions,
        messages,
        streaming,
        usage,
        activeSessionId: state.activeSessionId === sessionId ? sessions[0]?.id ?? null : state.activeSessionId,
      };
    }),

  renameSession: (sessionId, title) =>
    set((state) => ({
      sessions: state.sessions
        .map((session) => (session.id === sessionId ? { ...session, title } : session))
        .sort((a, b) => {
          const pinDelta = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
          if (pinDelta !== 0) return pinDelta;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }),
    })),

  pinSession: (sessionId, pinned) =>
    set((state) => ({
      sessions: state.sessions
        .map((session) => (session.id === sessionId ? { ...session, pinned } : session))
        .sort((a, b) => {
          const pinDelta = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
          if (pinDelta !== 0) return pinDelta;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }),
    })),

  addMessage: (sessionId, msg) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] || []), msg],
      },
    })),

  setMessages: (sessionId, msgs) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: msgs },
    })),

  truncateMessages: (sessionId, fromMessageId) =>
    set((state) => {
      const msgs = state.messages[sessionId] || [];
      const idx = msgs.findIndex((m) => m.id === fromMessageId);
      if (idx < 0) return state;
      return {
        messages: {
          ...state.messages,
          [sessionId]: msgs.slice(0, idx),
        },
      };
    }),

  appendToLastMessage: (sessionId, delta) =>
    set((state) => {
      const msgs = state.messages[sessionId] || [];
      if (msgs.length === 0) return state;
      const last = msgs[msgs.length - 1];
      const isThinkingPlaceholder = last.role === "assistant" && last.content === THINKING_MESSAGE;
      return {
        messages: {
          ...state.messages,
          [sessionId]: [
            ...msgs.slice(0, -1),
            { ...last, content: isThinkingPlaceholder ? delta : last.content + delta },
          ],
        },
      };
    }),

  finalizeAssistantMessage: (sessionId, fallback) =>
    set((state) => {
      const msgs = state.messages[sessionId] || [];
      if (msgs.length === 0) return state;
      const last = msgs[msgs.length - 1];
      if (last.role !== "assistant") return state;
      if (last.content !== THINKING_MESSAGE && last.content.trim().length > 0) return state;
      return {
        messages: {
          ...state.messages,
          [sessionId]: [
            ...msgs.slice(0, -1),
            { ...last, content: fallback },
          ],
        },
      };
    }),

  setStreaming: (sessionId, active) =>
    set((state) => ({
      streaming: { ...state.streaming, [sessionId]: active },
      phase: active ? state.phase : omitKey(state.phase, sessionId),
    })),

  setPhase: (sessionId, phase) =>
    set((state) => {
      if (phase === null) {
        return { phase: omitKey(state.phase, sessionId) };
      }
      return { phase: { ...state.phase, [sessionId]: phase } };
    }),

  addUsage: (sessionId, usage) =>
    set((state) => {
      const prev = state.usage[sessionId];
      const next = prev
        ? {
            prompt_tokens: prev.prompt_tokens + usage.prompt_tokens,
            completion_tokens: prev.completion_tokens + usage.completion_tokens,
            total_tokens: prev.total_tokens + usage.total_tokens,
          }
        : usage;
      return { usage: { ...state.usage, [sessionId]: next } };
    }),

  addToolCall: (sessionId, call) =>
    set((state) => {
      const msgs = state.messages[sessionId] || [];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        return {
          messages: {
            ...state.messages,
            [sessionId]: [
              ...msgs.slice(0, -1),
              {
                ...last,
                tool_calls: [...(last.tool_calls || []), call],
              },
            ],
          },
        };
      }
      return state;
    }),

  updateToolCall: (sessionId, toolId, patch) =>
    set((state) => {
      const msgs = state.messages[sessionId] || [];
      const last = msgs[msgs.length - 1];
      if (last?.tool_calls) {
        return {
          messages: {
            ...state.messages,
            [sessionId]: [
              ...msgs.slice(0, -1),
              {
                ...last,
                tool_calls: last.tool_calls.map((tc) =>
                  tc.id === toolId ? { ...tc, ...patch } : tc
                ),
              },
            ],
          },
        };
      }
      return state;
    }),

  updateToolCallResult: (sessionId, toolId, result) =>
    set((state) => {
      const msgs = state.messages[sessionId] || [];
      const last = msgs[msgs.length - 1];
      if (last?.tool_calls) {
        return {
          messages: {
            ...state.messages,
            [sessionId]: [
              ...msgs.slice(0, -1),
              {
                ...last,
                tool_calls: last.tool_calls.map((tc) =>
                  tc.id === toolId ? { ...tc, result, status: "done" as const } : tc
                ),
              },
            ],
          },
        };
      }
      return state;
    }),
}));
