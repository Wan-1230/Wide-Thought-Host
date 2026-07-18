// Zustand store for chat/session state.

import { create } from "zustand";
import type { SessionInfo, StreamChunk } from "@/lib/ipc";

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
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  appendToLastMessage: (sessionId: string, delta: string) => void;
  setStreaming: (sessionId: string, active: boolean) => void;
  addToolCall: (sessionId: string, call: ToolCall) => void;
  updateToolCallResult: (sessionId: string, toolId: string, result: unknown) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  streaming: {},

  setSessions: (sessions) => set({ sessions }),

  setActiveSession: (id) => set({ activeSessionId: id }),

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
      return {
        messages: {
          ...state.messages,
          [sessionId]: [
            ...msgs.slice(0, -1),
            { ...last, content: last.content + delta },
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
