// App — 桌面应用整体布局骨架。
//
// 布局结构（桌面客户端标准范式）：
//   ┌────────────────────────────────────────────┐
//   │ TitleBar（自定义标题栏：名称/会话/窗口控制） │
//   ├──────┬───────────────────────┬──────────────┤
//   │ 侧边 │   主对话区 + 输入框    │ 执行面板(右) │
//   │  栏  │   (+终端/编辑器)       │  可收起可拖宽 │
//   ├──────┴───────────────────────┴──────────────┤
//   │ StatusBar（状态栏）                           │
//   └────────────────────────────────────────────┘
// 本文件仅承担布局编排与既有业务回调接线，不含新增业务接口。

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  Activity,
  Check,
  ChevronDown,
  Cpu,
  Database,
  Folder,
  FolderOpen,
  Github,
  GitBranch,
  Home,
  MessageSquare,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  Terminal,
  UserCircle2,
  X,
} from "lucide-react";

import { TitleBar } from "./components/titlebar/TitleBar";
import { Sidebar } from "./components/sidebar/Sidebar";
import { ChatView } from "./components/chat/ChatView";
import { FileTree } from "./components/filetree/FileTree";
import { SettingsModal } from "./components/settings/Settings";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { EditorPanel } from "./components/editor/EditorPanel";
import { DiffModal } from "./components/editor/DiffModal";
import { InspectorPanel } from "./components/inspector/InspectorPanel";
import { CommandPalette } from "./components/common/CommandPalette";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { OnboardingModal } from "./components/common/OnboardingModal";
import { QuickAskModal } from "./components/common/QuickAskModal";
import { ContextMenu, contextMenuPointFromEvent, type ContextMenuItem, type ContextMenuPoint } from "./components/common/ContextMenu";
import { useChatStore } from "./stores/chat";
import { useWorkbenchStore } from "./stores/workbench";
import { useUiStore } from "./stores/ui";
import { useResizable } from "./hooks/useResizable";
import { useResponsiveLayout } from "./hooks/useResponsiveLayout";
import {
  githubAuthCancel,
  githubAuthLogout,
  githubAuthPoll,
  githubAuthStart,
  githubAuthStatus,
  onAgentApproval,
  onAgentStream,
  onSubagentResult,
  providerList,
  sessionCreate,
  sessionDelete,
  sessionLoadMessages,
  sessionSaveMessages,
  sessionSearch,
  settingsUpdate,
  sessionList,
  sessionRename,
  fileRead,
  sessionSetPinned,
  settingsGet,
  type DesktopSettings,
  type GitHubAuthStatus,
  type ProviderSummary,
  type StreamChunk,
  type WorkspaceInfo,
  workspaceClear,
  workspaceGitBranch,
  workspaceGet,
  workspaceRecent,
  workspaceSelect,
} from "./lib/ipc";

type NavSection = "sessions" | "files";

/** 判断键盘事件是否匹配快捷键字符串（如 "Ctrl+K" / "Ctrl+Shift+T"）。 */
function keysMatch(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split("+").map((p) => p.trim().toLowerCase());
  const ctrl = parts.includes("ctrl") || parts.includes("cmdorctrl") || parts.includes("cmd") || parts.includes("control");
  const alt = parts.includes("alt");
  const shift = parts.includes("shift");
  const superKey = parts.includes("super") || parts.includes("meta") || parts.includes("win");
  if (e.ctrlKey !== ctrl || e.altKey !== alt || e.shiftKey !== shift || e.metaKey !== superKey) return false;
  const expected = parts.find(
    (p) => !["ctrl", "alt", "shift", "super", "meta", "win", "cmdorctrl", "cmd", "control"].includes(p),
  );
  if (!expected) return false;
  return e.key.toLowerCase() === expected;
}

export default function App() {
  const {
    sessions,
    activeSessionId,
    messages,
    streaming,
    setSessions,
    setActiveSession,
    setMessages,
    upsertSession,
    removeSession,
    renameSession,
    pinSession,
    addMessage,
    appendToLastMessage,
    finalizeAssistantMessage,
    setStreaming,
    addUsage,
    addToolCall,
    updateToolCall,
    updateToolCallResult,
  } = useChatStore();

  // ─── 布局状态（stores/ui.ts） ──────────────────────
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const inspectorForceCollapsed = useUiStore((s) => s.inspectorForceCollapsed);
  const inspectorWidth = useUiStore((s) => s.inspectorWidth);
  const setInspectorWidth = useUiStore((s) => s.setInspectorWidth);
  const toggleInspector = useUiStore((s) => s.toggleInspector);
  const inspectorVisible = inspectorOpen && !inspectorForceCollapsed;
  const [inspectorDragging, setInspectorDragging] = useState(false);

  // 响应式：窗口变窄自动折叠侧边栏 / 强制收起右侧面板
  useResponsiveLayout();

  const [navSection, setNavSection] = useState<NavSection>("sessions");
  const [showTerminalPanel, setShowTerminalPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showQuickAsk, setShowQuickAsk] = useState(false);
  const terminalResize = useResizable({ initialWidth: 420, minWidth: 300, maxWidth: 800, direction: "left" });
  const editorResize = useResizable({ initialHeight: 320, minHeight: 160, maxHeight: 620, direction: "up" });
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [appSettings, setAppSettings] = useState<DesktopSettings | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceBranch, setWorkspaceBranch] = useState<string | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"title" | "message">("title");
  const [messageHits, setMessageHits] = useState<import("./lib/ipc").MessageSearchHit[]>([]);
  const [github, setGithub] = useState<GitHubAuthStatus | null>(null);
  const [showGithub, setShowGithub] = useState(false);
  const [workspaceMenuPoint, setWorkspaceMenuPoint] = useState<ContextMenuPoint | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const editorVisible = useWorkbenchStore((s) => s.editorVisible);
  const sessionUsage = useChatStore((s) => (activeSessionId ? s.usage[activeSessionId] : undefined));
  const openFileInEditor = useWorkbenchStore((s) => s.openFile);

  const workspaceActive = workspace?.active ?? true;
  const workspaceLabel = workspace
    ? workspace.active
      ? workspace.name
      : "不在工作区中工作"
    : "正在加载工作区";
  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;
  const isStreaming = activeSessionId ? streaming[activeSessionId] || false : false;
  const sessionMessageCount = activeSessionId
    ? messages[activeSessionId]?.length ?? activeSession?.message_count ?? 0
    : 0;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
  }, [theme]);

  const refreshProviders = useCallback(() => {
    providerList().then(setProviders).catch(() => {});
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const [nextWorkspace, nextBranch, nextRecent] = await Promise.all([
      workspaceGet(),
      workspaceGitBranch(),
      workspaceRecent(),
    ]);
    setWorkspace(nextWorkspace);
    setWorkspaceBranch(nextBranch);
    setRecentWorkspaces(nextRecent);
  }, []);

  const refreshGitHub = useCallback(async () => {
    setGithub(await githubAuthStatus());
  }, []);

  useEffect(() => {
    sessionList().then(setSessions).catch(console.error);
    settingsGet().then((value) => {
      setTheme(value.theme);
      setAppSettings(value);
      if (!value.onboarding_completed) setShowOnboarding(true);
    }).catch(console.error);
    refreshWorkspace().catch(console.error);
    refreshGitHub().catch(console.error);
    refreshProviders();

    const unlistenApproval = onAgentApproval((evt) => {
      updateToolCall(evt.session_id, evt.tool_id, {
        arguments: evt.arguments,
        status: "pending",
        needsApproval: true,
      });
    });

    const unlistenSubagent = onSubagentResult((evt) => {
      const sid = evt.parent_session_id;
      const ok = evt.status === "done";
      if (ok) {
        addMessage(sid, {
          id: crypto.randomUUID(),
          role: "system",
          content: `子智能体「${evt.subagent_name}」已完成，可切换到子会话查看完整过程`,
          timestamp: new Date().toISOString(),
        });
      } else {
        addMessage(sid, {
          id: crypto.randomUUID(),
          role: "system",
          content: `子智能体「${evt.subagent_name}」执行失败：${evt.error || "未知错误"}`,
          timestamp: new Date().toISOString(),
        });
      }
      // 并行批次汇总：全部完成时在主会话插入汇总
      useChatStore.getState().completeParallelRun(sid, evt.sub_session_id, ok, evt.subagent_name);
      const batch = useChatStore.getState().parallel[sid];
      if (batch && batch.done >= batch.total) {
        const okCount = Object.values(batch.statuses).filter((s) => s === "done").length;
        addMessage(sid, {
          id: crypto.randomUUID(),
          role: "system",
          content: `多智能体并行任务完成：${okCount}/${batch.total} 成功（${batch.names.join("、")}）`,
          timestamp: new Date().toISOString(),
        });
        useChatStore.getState().clearParallelRun(sid);
      }
      // 刷新会话列表，使新创建的子会话可见
      sessionList().then(setSessions).catch(console.error);
    });

    const unlisten = onAgentStream((chunk: StreamChunk) => {
      const sid = chunk.session_id;
      switch (chunk.type) {
        case "text_delta":
          appendToLastMessage(sid, chunk.delta || "");
          break;
        case "tool_call_start":
          addToolCall(sid, {
            id: chunk.tool_id!,
            name: chunk.tool_name!,
            arguments: chunk.arguments,
            status: chunk.needs_approval ? "pending" : "running",
            needsApproval: chunk.needs_approval ?? false,
          });
          break;
        case "tool_call_end":
          updateToolCallResult(sid, chunk.tool_id!, chunk.result);
          break;
        case "done":
          if (chunk.usage) addUsage(sid, chunk.usage);
          finalizeAssistantMessage(sid, "（本轮没有返回内容）");
          setStreaming(sid, false);
          break;
        case "error":
          finalizeAssistantMessage(sid, "（请求失败）");
          addMessage(sid, {
            id: crypto.randomUUID(),
            role: "system",
            content: `错误：${chunk.message}`,
            timestamp: new Date().toISOString(),
          });
          setStreaming(sid, false);
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenApproval.then((fn) => fn());
      unlistenSubagent.then((fn) => fn());
    };
  }, [
    addMessage,
    addUsage,
    addToolCall,
    appendToLastMessage,
    finalizeAssistantMessage,
    refreshGitHub,
    refreshProviders,
    refreshWorkspace,
    setSessions,
    setStreaming,
    updateToolCall,
    updateToolCallResult,
  ]);

  useEffect(() => {
    if (github?.state !== "pending") return;
    const timer = window.setInterval(() => {
      githubAuthPoll()
        .then(setGithub)
        .catch((error) => setGithub({ state: "error", message: String(error) }));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [github?.state]);

  // 激活会话时从磁盘恢复消息内容
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    sessionLoadMessages(activeSessionId)
      .then((msgs) => {
        if (!cancelled && Array.isArray(msgs)) {
          setMessages(activeSessionId, msgs as import("./stores/chat").ChatMessage[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, setMessages]);

  // 消息变化防抖 2s 自动保存，异常退出后仍可恢复
  useEffect(() => {
    if (!activeSessionId) return;
    const msgs = messages[activeSessionId];
    if (!msgs || msgs.length === 0) return;
    const timer = window.setTimeout(() => {
      sessionSaveMessages(activeSessionId, msgs).catch(() => {});
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [messages, activeSessionId]);

  useEffect(() => {
    const dispose = listen("menu:new-session", async () => {
      const session = await sessionCreate("新会话", "");
      upsertSession(session);
      setActiveSession(session.id);
      setNavSection("sessions");
    });
    const disposeQuickAsk = listen("menu:quick-ask", () => {
      setShowQuickAsk(true);
    });
    const disposeOpenSession = listen("menu:open-session", (event) => {
      const id = event.payload as string;
      if (id) {
        setActiveSession(id);
        setNavSection("sessions");
      }
    });
    return () => {
      dispose.then((fn) => fn());
      disposeQuickAsk.then((fn) => fn());
      disposeOpenSession.then((fn) => fn());
    };
  }, [setActiveSession, upsertSession]);

  const beginGitHubLogin = useCallback(async () => {
    try {
      setGithub(await githubAuthStart());
      setShowGithub(true);
    } catch (error) {
      setGithub({ state: "error", message: String(error) });
      setShowGithub(true);
    }
  }, []);

  const handleNewSession = useCallback(async () => {
    try {
      const session = await sessionCreate("新会话", "");
      upsertSession(session);
      setActiveSession(session.id);
      setNavSection("sessions");
    } catch (error) {
      console.error("创建会话失败：", error);
    }
  }, [setActiveSession, upsertSession]);

  // 可配置快捷键（读取 settings.shortcuts，缺省回退默认组合）
  useEffect(() => {
    const sc = appSettings?.shortcuts || {};
    const onKeyDown = (e: KeyboardEvent) => {
      if (keysMatch(e, sc.command_palette || "Ctrl+K")) {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
        return;
      }
      if (keysMatch(e, sc.open_settings || "Ctrl+,")) {
        e.preventDefault();
        setShowSettings(true);
        return;
      }
      if (keysMatch(e, sc.toggle_theme || "Ctrl+D")) {
        e.preventDefault();
        setTheme((c) => (c === "dark" ? "light" : "dark"));
        return;
      }
      if (keysMatch(e, sc.new_session || "Ctrl+N")) {
        e.preventDefault();
        void handleNewSession();
        return;
      }
      if (keysMatch(e, sc.toggle_terminal || "Ctrl+Shift+T")) {
        e.preventDefault();
        setShowTerminalPanel((v) => !v);
        return;
      }
      if (keysMatch(e, sc.toggle_inspector || "Ctrl+Shift+I")) {
        e.preventDefault();
        toggleInspector();
        return;
      }
      if (keysMatch(e, sc.focus_input || "Ctrl+L")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("wth:focus-input"));
        return;
      }
      if (keysMatch(e, sc.stop_generation || "Ctrl+Shift+S")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("wth:stop-generation"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appSettings, handleNewSession, toggleInspector]);

  // 消息模式全文检索（防抖 300ms）
  useEffect(() => {
    if (searchMode !== "message") {
      setMessageHits([]);
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
      setMessageHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      sessionSearch(q, 60)
        .then(setMessageHits)
        .catch(() => setMessageHits([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery, searchMode]);

  const handleOpenFile = useCallback(async (path: string) => {
    try {
      const content = await fileRead(path);
      const name = path.split(/[\\/]/).pop() || path;
      openFileInEditor(path, name, content);
    } catch (error) {
      console.error("打开文件失败：", error);
      window.alert(`打开文件失败：${String(error)}`);
    }
  }, [openFileInEditor]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await sessionDelete(id);
    removeSession(id);
  }, [removeSession]);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    const updated = await sessionRename(id, title);
    renameSession(updated.id, updated.title);
  }, [renameSession]);

  const handleTogglePinSession = useCallback(async (id: string, pinned: boolean) => {
    const updated = await sessionSetPinned(id, pinned);
    pinSession(updated.id, Boolean(updated.pinned));
  }, [pinSession]);

  /** 复制会话：创建新会话并克隆消息（纯前端编排，复用既有 IPC）。 */
  const handleDuplicateSession = useCallback(async (id: string) => {
    const source = sessions.find((s) => s.id === id);
    if (!source) return;
    try {
      const session = await sessionCreate(`${source.title || "未命名会话"}（副本）`, source.model || "");
      const msgs = useChatStore.getState().messages[id] || [];
      if (msgs.length > 0) {
        const cloned = msgs.map((m) => ({ ...m, id: crypto.randomUUID() }));
        setMessages(session.id, cloned);
        await sessionSaveMessages(session.id, cloned).catch(() => {});
      }
      upsertSession(session);
      setActiveSession(session.id);
      setNavSection("sessions");
    } catch (error) {
      console.error("复制会话失败：", error);
    }
  }, [sessions, setActiveSession, setMessages, upsertSession]);

  /** 清空当前会话消息（保留会话本身）。 */
  const handleClearSession = useCallback(async () => {
    if (!activeSessionId) return;
    if (!window.confirm("确定清空当前会话的全部消息吗？此操作不可撤销。")) return;
    setMessages(activeSessionId, []);
    await sessionSaveMessages(activeSessionId, []).catch(() => {});
  }, [activeSessionId, setMessages]);

  /** 导出会话：从 store 取消息，生成 Markdown / JSON 文件下载。 */
  const handleExportSession = useCallback(
    (id: string, format: "markdown" | "json") => {
      const msgs = useChatStore.getState().messages[id] || [];
      const session = sessions.find((s) => s.id === id);
      const title = session?.title || "会话";
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_") || "会话";
      if (format === "json") {
        const payload = JSON.stringify(
          { id, title, exported_at: new Date().toISOString(), messages: msgs },
          null,
          2,
        );
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeTitle}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const lines: string[] = [`# ${title}`, ""];
      for (const m of msgs) {
        const who =
          m.role === "user" ? "用户" : m.role === "assistant" ? "WTH" : m.role === "system" ? "系统" : "工具";
        lines.push(`## ${who}`, "", m.content || "", "");
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            lines.push(`> 工具调用：${tc.name}`, "", "```json", JSON.stringify(tc.arguments, null, 2), "```", "");
          }
        }
      }
      const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}.md`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [sessions],
  );

  const selectWorkspace = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择 WTH 工作区",
    });
    if (typeof selected !== "string") return;
    const info = await workspaceSelect(selected);
    setWorkspace(info);
    setWorkspaceBranch(await workspaceGitBranch());
    setRecentWorkspaces(await workspaceRecent());
  }, []);

  const clearWorkspace = useCallback(async () => {
    const info = await workspaceClear();
    setWorkspace(info);
    setWorkspaceBranch(await workspaceGitBranch());
    setRecentWorkspaces(await workspaceRecent());
  }, []);

  const openWorkspaceMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    setWorkspaceMenuPoint(contextMenuPointFromEvent(event));
  }, []);

  const workspaceMenuItems = useMemo(() => {
    const items: ContextMenuItem[] = [
      {
        key: "choose-workspace",
        icon: <FolderOpen size={14} />,
        label: "选择工作区",
        onSelect: async () => {
          await selectWorkspace();
          setWorkspaceMenuPoint(null);
        },
      },
      {
        key: "no-workspace",
        icon: <Home size={14} />,
        label: "不在工作区中工作",
        onSelect: async () => {
          await clearWorkspace();
          setWorkspaceMenuPoint(null);
        },
      },
    ];

    if (recentWorkspaces.length > 0) {
      items.push({ type: "separator", key: "recent-sep" });
      for (const recent of recentWorkspaces.slice(0, 5)) {
        items.push({
          key: `recent-${recent.path}`,
          icon: recent.active ? <Check size={14} /> : <FolderOpen size={14} />,
          label: recent.name || recent.path,
          onSelect: async () => {
            await workspaceSelect(recent.path);
            await refreshWorkspace();
            setWorkspaceMenuPoint(null);
          },
        });
      }
    }

    return items;
  }, [clearWorkspace, recentWorkspaces, refreshWorkspace, selectWorkspace]);

  // ─── 右侧执行面板拖拽调宽 ──────────────────────────
  const handleInspectorDragStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      setInspectorDragging(true);
      const startX = e.clientX;
      const startWidth = useUiStore.getState().inspectorWidth;
      const onMove = (ev: MouseEvent) => {
        // 面板在右侧，向左拖动增加宽度
        setInspectorWidth(startWidth + (startX - ev.clientX));
      };
      const onUp = () => {
        setInspectorDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [setInspectorDragging, setInspectorWidth],
  );

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: "var(--bg-body)", color: "var(--text-primary)" }}>
      {/* 自定义窗口标题栏 */}
      <TitleBar sessionTitle={activeSession?.title ?? null} streaming={isStreaming} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧侧边栏：宽度动画过渡，折叠后仅保留图标 */}
        <aside
          className="flex-shrink-0 flex flex-col border-r overflow-hidden layout-transition"
          style={{
            width: sidebarCollapsed ? 48 : 244,
            background: "var(--surface-1)",
            borderColor: "var(--surface-3)",
          }}
        >
          {!sidebarCollapsed && (
            <>
              {/* 搜索 */}
              <div className="px-2.5 pt-2 pb-1.5 flex-shrink-0">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--surface-2)" }}>
                  <Search size={12} style={{ color: "var(--text-muted)" }} />
                  <input
                    type="text"
                    placeholder={searchMode === "message" ? "搜索全部消息…" : "搜索会话…"}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px]"
                    style={{ color: "var(--text-primary)" }}
                  />
                </div>
                <div className="mt-1.5 flex items-center gap-1 px-1 py-0.5 rounded-lg">
                  {(["title", "message"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSearchMode(mode)}
                      className="flex-1 text-[10.5px] px-2 py-0.5 rounded transition-colors"
                      style={{
                        background: searchMode === mode ? "var(--surface-2)" : "transparent",
                        color: searchMode === mode ? "var(--text-primary)" : "var(--text-muted)",
                      }}
                    >
                      {mode === "title" ? "标题" : "消息内容"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 会话 / 文件切换 */}
              <nav className="px-2 pb-1 flex items-center gap-1 flex-shrink-0">
                {[
                  { id: "sessions" as const, label: "会话", icon: <MessageSquare size={13} /> },
                  { id: "files" as const, label: "文件", icon: <Folder size={13} /> },
                ].map((item) => {
                  const active = navSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setNavSection(item.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] transition-colors duration-150"
                      style={{
                        background: active ? "var(--surface-2)" : "transparent",
                        color: active ? "var(--text-primary)" : "var(--text-muted)",
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </>
          )}

          <div className="flex-1 min-h-0 overflow-hidden">
            {navSection === "sessions" && searchMode === "message" && !sidebarCollapsed ? (
              <div className="h-full overflow-y-auto px-2 pb-2">
                {searchQuery.trim() === "" ? (
                  <div className="text-center py-6 text-[11px]" style={{ color: "var(--text-dim)" }}>
                    输入关键词搜索全部会话消息
                  </div>
                ) : messageHits.length === 0 ? (
                  <div className="text-center py-6 text-[11px]" style={{ color: "var(--text-dim)" }}>
                    没有匹配的消息
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messageHits.map((hit, i) => (
                      <button
                        key={i}
                        className="w-full text-left p-2 rounded-lg transition-colors hover:bg-[color:var(--surface-2)]"
                        style={{ background: "var(--surface-1)" }}
                        onClick={() => {
                          setActiveSession(hit.session_id);
                          setNavSection("sessions");
                          window.setTimeout(() => {
                            window.dispatchEvent(
                              new CustomEvent("wth:scroll-to-message", {
                                detail: { sessionId: hit.session_id, index: hit.message_index },
                              }),
                            );
                          }, 250);
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[11px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {hit.session_title}
                          </span>
                          <span className="text-[10px] shrink-0" style={{ color: "var(--text-dim)" }}>
                            {hit.role === "user" ? "用户" : "助手"}
                          </span>
                        </div>
                        <div className="text-[11px] line-clamp-2 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                          {hit.snippet}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : navSection === "files" && !sidebarCollapsed ? (
              <FileTree workspaceActive={workspaceActive} onFileOpen={handleOpenFile} />
            ) : (
              <Sidebar
                collapsed={sidebarCollapsed}
                theme={theme}
                sessions={sessions}
                activeId={activeSessionId}
                streaming={streaming}
                providers={providers}
                onRefreshProviders={refreshProviders}
                onNewSession={() => void handleNewSession()}
                onSelect={setActiveSession}
                onDeleteSession={handleDeleteSession}
                onRenameSession={handleRenameSession}
                onDuplicateSession={handleDuplicateSession}
                onTogglePinSession={handleTogglePinSession}
                onExportSession={handleExportSession}
                onOpenSettings={() => setShowSettings(true)}
                searchQuery={searchQuery}
              />
            )}
          </div>
        </aside>

        {/* 中间主区 */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* 轻量工具条 */}
          <div className="flex items-center justify-between gap-2 px-3 py-1 flex-shrink-0">
            <div className="flex items-center gap-1 min-w-0">
              <ToolbarButton icon={<Plus size={13} />} label="新建会话" onClick={() => void handleNewSession()} />
              <ToolbarButton
                icon={<FolderOpen size={12} />}
                label={workspaceLabel}
                onClick={openWorkspaceMenu}
                onContextMenu={openWorkspaceMenu}
              />
            </div>
            <div className="flex items-center gap-1">
              <ToolbarButton
                icon={theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
                label={theme === "dark" ? "浅色" : "深色"}
                onClick={() => setTheme((c) => (c === "dark" ? "light" : "dark"))}
              />
              <ToolbarButton
                icon={showTerminalPanel ? <Terminal size={13} /> : <Terminal size={13} />}
                label="终端"
                onClick={() => setShowTerminalPanel((current) => !current)}
                active={showTerminalPanel}
              />
              <ToolbarButton
                icon={inspectorVisible ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
                label="执行面板"
                onClick={toggleInspector}
                active={inspectorVisible}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 flex overflow-hidden">
              <div className="flex-1 min-w-0 min-h-0 relative">
                <ChatView
                  onNewSession={() => void handleNewSession()}
                  onClearSession={() => void handleClearSession()}
                  onExportSession={handleExportSession}
                  sessionTitle={activeSession?.title ?? null}
                />
              </div>
              {showTerminalPanel && (
                <>
                  <div
                    className="w-1 shrink-0 cursor-col-resize transition-colors"
                    style={{ background: terminalResize.isDragging ? "var(--accent-blue)" : "var(--surface-3)" }}
                    onMouseDown={terminalResize.handleMouseDown}
                  />
                  <div
                    className="shrink-0 overflow-hidden"
                    style={{ width: terminalResize.width, background: "var(--surface-0)" }}
                  >
                    <TerminalPanel />
                  </div>
                </>
              )}
            </div>
            {editorVisible && (
              <>
                <div
                  className="h-1 shrink-0 cursor-row-resize transition-colors"
                  style={{ background: editorResize.isDragging ? "var(--accent-blue)" : "var(--surface-3)" }}
                  onMouseDown={editorResize.handleMouseDown}
                />
                <div
                  className="shrink-0 overflow-hidden"
                  style={{ height: editorResize.height, background: "var(--surface-0)" }}
                >
                  <EditorPanel theme={theme} />
                </div>
              </>
            )}
          </div>
        </main>

        {/* 右侧执行面板：可收起、可拖宽、平滑过渡 */}
        <div
          className="flex-shrink-0 flex overflow-hidden layout-transition"
          style={{ width: inspectorVisible ? inspectorWidth : 0 }}
        >
          {inspectorVisible && (
            <>
              <div
                className="w-1 shrink-0 cursor-col-resize transition-colors self-stretch"
                style={{ background: inspectorDragging ? "var(--accent-blue)" : "var(--surface-3)" }}
                onMouseDown={handleInspectorDragStart}
              />
              <div className="flex-1 min-w-0 border-l" style={{ borderColor: "var(--surface-3)" }}>
                <InspectorPanel workspaceLabel={workspaceLabel} workspaceBranch={workspaceBranch} />
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar
        modelLabel={activeSession?.model}
        sessionTokens={sessionUsage?.total_tokens ?? 0}
        workspaceLabel={workspaceLabel}
        workspaceActive={workspace?.active ?? false}
        workspaceBranch={workspaceBranch}
        sessionCount={sessions.length}
        messageCount={sessionMessageCount}
        streaming={isStreaming}
        github={github}
        onWorkspaceClick={openWorkspaceMenu}
        onSettingsClick={() => setShowSettings(true)}
        onGithubClick={() => (github?.state === "signed_in" ? setShowGithub(true) : void beginGitHubLogin())}
      />

      <DiffModal theme={theme} />

      <ContextMenu
        open={Boolean(workspaceMenuPoint)}
        point={workspaceMenuPoint}
        onClose={() => setWorkspaceMenuPoint(null)}
        ariaLabel="工作区菜单"
        items={workspaceMenuItems}
      />

      {showGithub && (
        <GitHubDialog
          status={github}
          onClose={() => setShowGithub(false)}
          onStart={() => void beginGitHubLogin()}
          onCancel={async () => {
            await githubAuthCancel();
            await refreshGitHub();
          }}
          onLogout={async () => {
            await githubAuthLogout();
            await refreshGitHub();
            setShowGithub(false);
          }}
        />
      )}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSettingsSaved={(saved) => {
          setAppSettings(saved);
          if (!saved.onboarding_completed) setShowOnboarding(true);
        }}
      />

      <QuickAskModal
        open={showQuickAsk}
        onClose={() => setShowQuickAsk(false)}
        onSent={() => setNavSection("sessions")}
      />

      {showOnboarding && (
        <OnboardingModal
          onClose={() => setShowOnboarding(false)}
          onDone={async () => {
            try {
              const next = await settingsGet();
              const saved = await settingsUpdate({ ...next, onboarding_completed: true });
              setAppSettings(saved);
              setShowOnboarding(false);
            } catch {
              setShowOnboarding(false);
            }
          }}
          onOpenSettings={() => setShowSettings(true)}
          onExampleQuestion={async (question: string) => {
            if (!question.trim()) return;
            try {
              const session = await sessionCreate("新会话", "");
              upsertSession(session);
              setActiveSession(session.id);
              setNavSection("sessions");
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent("wth:send-example", { detail: question }));
              }, 300);
            } catch (error) {
              console.error("创建会话失败：", error);
            }
          }}
        />
      )}

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        sessions={sessions}
        onSelectSession={(id) => { setActiveSession(id); setNavSection("sessions"); }}
        onNewSession={() => void handleNewSession()}
        onOpenSettings={() => setShowSettings(true)}
        onToggleTheme={() => setTheme((c) => (c === "dark" ? "light" : "dark"))}
      />
    </div>
  );
}

function StatusBar({
  modelLabel,
  workspaceLabel,
  workspaceActive,
  workspaceBranch,
  sessionCount,
  messageCount,
  sessionTokens,
  streaming,
  github,
  onWorkspaceClick,
  onSettingsClick,
  onGithubClick,
}: {
  modelLabel?: string;
  workspaceLabel: string;
  workspaceActive: boolean;
  workspaceBranch: string | null;
  sessionCount: number;
  messageCount: number;
  sessionTokens: number;
  streaming: boolean;
  github: GitHubAuthStatus | null;
  onWorkspaceClick: (event: ReactMouseEvent<HTMLElement>) => void;
  onSettingsClick: () => void;
  onGithubClick: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1 border-t text-[11px] flex-shrink-0"
      style={{ background: "var(--surface-1)", borderColor: "var(--surface-3)" }}
    >
      {/* 左侧：模型 / 工作区 / 分支 */}
      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors hover:bg-[color:var(--surface-2)] shrink-0"
          style={{ borderColor: "var(--surface-3)", color: "var(--accent-purple)" }}
          title="当前模型"
          onClick={onSettingsClick}
        >
          <Cpu size={11} />
          <span className="max-w-[120px] truncate">{modelLabel || "默认模型"}</span>
        </button>
        <button
          type="button"
          onClick={onWorkspaceClick}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors hover:bg-[color:var(--surface-2)] shrink-0"
          style={{ borderColor: "var(--surface-3)", color: workspaceActive ? "var(--text-primary)" : "var(--text-muted)" }}
          title="工作区"
        >
          <FolderOpen size={11} />
          <span className="max-w-[140px] truncate">{workspaceLabel}</span>
        </button>
        {workspaceBranch && (
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border shrink-0"
            style={{ borderColor: "var(--surface-3)", color: "var(--text-muted)" }}
          >
            <GitBranch size={11} />
            <span className="max-w-[100px] truncate">{workspaceBranch}</span>
          </span>
        )}
      </div>

      {/* 右侧：统计 / 状态 / GitHub / 设置 */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className="hidden lg:flex items-center gap-1.5 rounded-full px-2.5 py-1 border"
          style={{ borderColor: "var(--surface-3)", color: "var(--text-muted)" }}
        >
          <Database size={11} />
          <span>{sessionCount} 会话 · {messageCount} 消息</span>
        </span>
        <span
          className="hidden md:flex items-center gap-1.5 rounded-full px-2.5 py-1 border"
          style={{ borderColor: "var(--surface-3)", color: "var(--text-muted)" }}
          title="当前会话 Token 用量"
        >
          <Cpu size={11} />
          <span>{sessionTokens > 0 ? `${sessionTokens.toLocaleString()} tok` : "— tok"}</span>
        </span>
        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border"
          style={{ borderColor: "var(--surface-3)", color: streaming ? "var(--accent-green)" : "var(--text-dim)" }}
        >
          <Activity size={11} />
          <span>{streaming ? "思考中" : "就绪"}</span>
        </span>
        <button
          type="button"
          onClick={onGithubClick}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors hover:bg-[color:var(--surface-2)]"
          style={{ borderColor: "var(--surface-3)", color: github?.state === "signed_in" ? "var(--text-primary)" : "var(--text-dim)" }}
          title={github?.state === "signed_in" ? "GitHub 账户" : "使用 GitHub 登录"}
        >
          {github?.state === "signed_in" ? <Github size={11} /> : <UserCircle2 size={11} />}
          <span className="max-w-[80px] truncate">
            {github?.state === "signed_in" ? (github.user?.login || "已登录") : "未登录"}
          </span>
        </button>
        <button
          type="button"
          onClick={onSettingsClick}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors hover:bg-[color:var(--surface-2)]"
          style={{ borderColor: "var(--surface-3)", color: "var(--text-primary)" }}
          title="设置"
        >
          <SettingsIcon size={11} />
        </button>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  onContextMenu,
  active,
}: {
  icon: ReactNode;
  label: string;
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(event);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-[color:var(--surface-2)]"
      style={{
        background: active ? "var(--surface-2)" : "transparent",
        color: "var(--text-primary)",
      }}
    >
      {icon}
      <span className="max-w-[16rem] truncate">{label}</span>
      {onContextMenu && <ChevronDown size={10} style={{ color: "var(--text-dim)" }} />}
    </button>
  );
}

function GitHubDialog({
  status,
  onClose,
  onStart,
  onCancel,
  onLogout,
}: {
  status: GitHubAuthStatus | null;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const pending = status?.state === "pending";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.45)" }}>
      <div
        className="w-full max-w-sm rounded-2xl p-5 shadow-2xl border"
        style={{ background: "var(--surface-1)", color: "var(--text-primary)", borderColor: "var(--surface-3)" }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Github size={17} />
          GitHub 登录
        </div>
        {status?.state === "signed_in" ? (
          <>
            <p className="mt-3 text-sm">已登录为 @{status.user?.login}</p>
            <button className="mt-4 text-xs px-3 py-2 rounded-lg" style={{ background: "var(--surface-2)" }} onClick={onLogout}>
              退出登录
            </button>
          </>
        ) : pending ? (
          <>
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              在浏览器打开 GitHub，输入下方一次性验证码后授权。
            </p>
            <div
              className="mt-4 rounded-xl px-4 py-3 text-center font-mono text-xl tracking-[.25em]"
              style={{ background: "var(--surface-2)" }}
            >
              {status.user_code}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="text-xs px-3 py-2 rounded-lg"
                style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
                onClick={() => status.verification_uri && openUrl(status.verification_uri)}
              >
                打开 GitHub
              </button>
              <button
                className="text-xs px-3 py-2 rounded-lg"
                style={{ background: "var(--surface-2)" }}
                onClick={() => navigator.clipboard.writeText(status.user_code || "")}
              >
                复制验证码
              </button>
              <button className="text-xs px-3 py-2 rounded-lg" style={{ background: "var(--surface-2)" }} onClick={onCancel}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              {status?.message || "登录是可选功能，不影响本地使用。"}
            </p>
            <button
              className="mt-4 text-xs px-3 py-2 rounded-lg"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
              onClick={onStart}
            >
              使用 GitHub 登录
            </button>
          </>
        )}
        <button className="mt-4 block text-xs" style={{ color: "var(--text-muted)" }} onClick={onClose}>
          <X size={12} className="inline mr-1" />
          关闭
        </button>
      </div>
    </div>
  );
}
