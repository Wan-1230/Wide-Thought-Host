// Zustand store for chat/session state.

import { create } from "zustand";
import type { SessionInfo, StreamChunk } from "@/lib/ipc";

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
}

interface ChatStore {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  streaming: Record<string, boolean>;

  setSessions: (sessions: SessionInfo[]) => void;
  setActiveSession: (id: string) => void;
  upsertSession: (session: SessionInfo) => void;
  removeSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  pinSession: (sessionId: string, pinned: boolean) => void;
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  appendToLastMessage: (sessionId: string, delta: string) => void;
  finalizeAssistantMessage: (sessionId: string, fallback: string) => void;
  setStreaming: (sessionId: string, active: boolean) => void;
  addToolCall: (sessionId: string, call: ToolCall) => void;
  updateToolCallResult: (sessionId: string, toolId: string, result: unknown) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  streaming: {},

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
      void removedMessages;
      void removedStreaming;
      return {
        sessions,
        messages,
        streaming,
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
    })),

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
                  tc.id === toolId ? { ...tc, result } : tc
                ),
              },
            ],
          },
        };
      }
      return state;
    }),
}));
