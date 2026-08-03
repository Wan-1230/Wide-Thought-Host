import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  Activity,
  Check,
  ChevronDown,
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
  Cpu,
  Sparkles,
  Sun,
  Terminal,
  X,
  Brain,
  Database,
  UserCircle2,
} from "lucide-react";

import { Sidebar } from "./components/sidebar/Sidebar";
import { ChatView } from "./components/chat/ChatView";
import { FileTree } from "./components/filetree/FileTree";
import { SettingsModal } from "./components/settings/Settings";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { EditorPanel } from "./components/editor/EditorPanel";
import { DiffModal } from "./components/editor/DiffModal";
import { CommandPalette } from "./components/common/CommandPalette";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { ContextMenu, contextMenuPointFromEvent, type ContextMenuItem, type ContextMenuPoint } from "./components/common/ContextMenu";
import { useChatStore } from "./stores/chat";
import { useWorkbenchStore } from "./stores/workbench";
import { useResizable } from "./hooks/useResizable";
import {
  githubAuthCancel,
  githubAuthLogout,
  githubAuthPoll,
  githubAuthStart,
  githubAuthStatus,
  onAgentApproval,
  onAgentStream,
  onSubagentResult,
  sessionCreate,
  sessionDelete,
  sessionLoadMessages,
  sessionSaveMessages,
  sessionSearch,
  sessionList,
  sessionRename,
  fileRead,
  sessionSetPinned,
  settingsGet,
  type DesktopSettings,
  type GitHubAuthStatus,
  type StreamChunk,
  type WorkspaceInfo,
  workspaceClear,
  workspaceGitBranch,
  workspaceGet,
  workspaceRecent,
  workspaceSelect,
} from "./lib/ipc";
import wthIcon from "@/assets/wth-icon.png";

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
  const actual = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  return actual === expected;
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

  const [navSection, setNavSection] = useState<NavSection>("sessions");
  const [showTerminalPanel, setShowTerminalPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
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
  const [showPromo, setShowPromo] = useState(true);
  const [github, setGithub] = useState<GitHubAuthStatus | null>(null);
  const [showGithub, setShowGithub] = useState(false);
  const [workspaceMenuPoint, setWorkspaceMenuPoint] = useState<ContextMenuPoint | null>(null);
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
    }).catch(console.error);
    refreshWorkspace().catch(console.error);
    refreshGitHub().catch(console.error);

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


  // G3: 激活会话时从磁盘恢复消息内容
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

  // G3: 消息变化防抖 2s 自动保存，异常退出后仍可恢复
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
    return () => {
      dispose.then((fn) => fn());
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appSettings, handleNewSession]);

  // G4: 消息模式全文检索（防抖 300ms）
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
          icon: recent.active ? <Check size={14} /> : <FolderInputIcon size={14} />,
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

  const toolbarButtonClass =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[color:var(--surface-2)]";

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: "var(--bg-body)", color: "var(--text-primary)" }}>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside
          className="w-64 flex-shrink-0 flex flex-col border-r"
          style={{ background: "var(--surface-1)", borderColor: "var(--surface-3)" }}
        >
          <div className="px-3 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <img src={wthIcon} alt="WTH" className="w-8 h-8 rounded-lg object-cover theme-logo" />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">Wide Thought Host</div>
                <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>桌面代理</div>
              </div>
            </div>
            <button
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "切换浅色" : "切换深色"}
              className="p-1.5 rounded-md hover:bg-surface-2 transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>

          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--surface-2)" }}>
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                type="text"
                placeholder={searchMode === "message" ? "搜索全部消息内容…" : "搜索会话标题…"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[13px] placeholder:text-[13px]"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
            <div className="mt-1.5 flex items-center gap-1 px-1 py-0.5 rounded-lg" style={{ background: "var(--surface-1)" }}>
              {(["title", "message"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSearchMode(mode)}
                  className="flex-1 text-[11px] px-2 py-0.5 rounded transition-colors"
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

          <nav className="px-2 py-1 space-y-0.5">
            {[
              { id: "sessions" as const, label: "会话", icon: <MessageSquare size={16} /> },
              { id: "files" as const, label: "文件", icon: <Folder size={16} /> },
            ].map((item) => {
              const active = navSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setNavSection(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                    active ? "" : "hover:bg-surface-2"
                  }`}
                  style={{
                    background: active ? "var(--surface-2)" : "transparent",
                    color: "var(--text-primary)",
                  }}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {navSection === "sessions" && (
            <div className="px-3 pt-4 pb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
                会话
              </span>
              <button
                onClick={handleNewSession}
                className="p-0.5 rounded hover:bg-surface-2 transition-colors"
                style={{ color: "var(--text-muted)" }}
                title="新建会话"
              >
                <Plus size={13} />
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-hidden">
            {navSection === "sessions" && searchMode === "message" ? (
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
                        className="w-full text-left p-2 rounded-lg transition-colors hover:bg-surface-2"
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
            ) : navSection === "sessions" ? (
              <Sidebar
                sessions={sessions}
                activeId={activeSessionId}
                onSelect={setActiveSession}
                onDeleteSession={handleDeleteSession}
                onRenameSession={handleRenameSession}
                onTogglePinSession={handleTogglePinSession}
                onExportSession={handleExportSession}
                searchQuery={searchQuery}
              />
            ) : navSection === "files" ? (
              <FileTree workspaceActive={workspaceActive} onFileOpen={handleOpenFile} />
            ) : null}
          </div>

          <div className="px-3 py-3 border-t flex items-center gap-2.5" style={{ borderColor: "var(--surface-3)" }}>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg hover:bg-surface-2"
              title="设置"
              style={{ color: "var(--text-muted)" }}
            >
              <SettingsIcon size={16} />
            </button>
            <button
              onClick={() => (github?.state === "signed_in" ? setShowGithub(true) : beginGitHubLogin())}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold overflow-hidden"
              title={github?.state === "signed_in" ? "GitHub 账户" : "使用 GitHub 登录"}
              style={{ background: "var(--surface-3)", color: "var(--text-primary)" }}
            >
              {github?.user?.avatar_url ? (
                <img className="w-full h-full object-cover" src={github.user.avatar_url} alt="GitHub 头像" />
              ) : (
                <Github size={14} />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium truncate">
                {github?.user?.name || github?.user?.login || "使用 GitHub 登录"}
              </div>
              <div className="text-[10px] truncate" style={{ color: "var(--text-dim)" }}>
                Free 计划
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div
            className="flex items-center justify-between gap-2 px-4 py-1.5 flex-shrink-0"
            style={{ background: "transparent" }}
          >
              <div className="flex items-center gap-1 min-w-0">
                <ToolbarButton icon={<Plus size={14} />} label="新建会话" onClick={handleNewSession} />
                <ToolbarButton
                  icon={<FolderOpen size={13} />}
                  label={workspaceLabel}
                  onClick={openWorkspaceMenu}
                  onContextMenu={openWorkspaceMenu}
                />
              </div>
              <ToolbarButton
                icon={showTerminalPanel ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                label="终端"
                onClick={() => setShowTerminalPanel((current) => !current)}
                active={showTerminalPanel}
              />
            </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 flex overflow-hidden">
            <>
              <div className="flex-1 min-w-0 min-h-0 relative">
                <ChatView onNewSession={handleNewSession} />
                  {navSection === "sessions" && !activeSessionId && showPromo && (
                    <div className="absolute bottom-4 right-4 z-10">
                      <div
                        className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl shadow-lg"
                        style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
                      >
                        <Sparkles size={16} />
                        <div className="flex-1">
                          <div className="text-[12px] font-semibold leading-tight">WTH Pro</div>
                          <div className="text-[10px] opacity-70 leading-tight">解锁更长上下文与更多模型</div>
                        </div>
                        <button
                          onClick={() => window.alert("WTH Pro 即将推出")}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                          style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}
                        >
                          升级
                        </button>
                        <button
                          onClick={() => setShowPromo(false)}
                          className="opacity-60 hover:opacity-100 transition-opacity"
                          title="关闭"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  )}
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
            </>
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
          onStart={beginGitHubLogin}
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

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        sessions={sessions}
        onSelectSession={(id) => { setActiveSession(id); setNavSection("sessions"); }}
        onNewSession={handleNewSession}
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
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-t text-[11px]"
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
          <Brain size={11} />
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
          className="hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 border"
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
        <span
          className="hidden md:flex items-center gap-1.5 rounded-full px-2.5 py-1 border"
          style={{ borderColor: "var(--surface-3)", color: github?.state === "signed_in" ? "var(--text-primary)" : "var(--text-dim)" }}
        >
          {github?.state === "signed_in" ? <Github size={11} /> : <UserCircle2 size={11} />}
          <span className="max-w-[80px] truncate">
            {github?.state === "signed_in" ? (github.user?.login || "已登录") : "未登录"}
          </span>
        </span>
        <button
          type="button"
          onClick={onSettingsClick}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors hover:bg-[color:var(--surface-2)]"
          style={{ borderColor: "var(--surface-3)", color: "var(--text-primary)" }}
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
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[color:var(--surface-2)]"
      style={{
        background: active ? "var(--surface-2)" : "transparent",
        color: "var(--text-primary)",
      }}
    >
      {icon}
      <span className="max-w-[20rem] truncate">{label}</span>
      {onContextMenu && <ChevronDown size={11} style={{ color: "var(--text-dim)" }} />}
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
          关闭
        </button>
      </div>
    </div>
  );
}

function FolderInputIcon({ size }: { size: number }) {
  return <FolderOpen size={size} />;
}
