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
import { CommandPalette } from "./components/common/CommandPalette";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { ContextMenu, contextMenuPointFromEvent, type ContextMenuItem, type ContextMenuPoint } from "./components/common/ContextMenu";
import { useChatStore } from "./stores/chat";
import { useResizable } from "./hooks/useResizable";
import {
  githubAuthCancel,
  githubAuthLogout,
  githubAuthPoll,
  githubAuthStart,
  githubAuthStatus,
  onAgentStream,
  sessionCreate,
  sessionDelete,
  sessionList,
  sessionRename,
  sessionSetPinned,
  settingsGet,
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

export default function App() {
  const {
    sessions,
    activeSessionId,
    messages,
    streaming,
    setSessions,
    setActiveSession,
    upsertSession,
    removeSession,
    renameSession,
    pinSession,
    addMessage,
    appendToLastMessage,
    finalizeAssistantMessage,
    setStreaming,
    addToolCall,
    updateToolCallResult,
  } = useChatStore();

  const [navSection, setNavSection] = useState<NavSection>("sessions");
  const [showTerminalPanel, setShowTerminalPanel] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const terminalResize = useResizable({ initialWidth: 420, minWidth: 300, maxWidth: 800, direction: "left" });
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceBranch, setWorkspaceBranch] = useState<string | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [github, setGithub] = useState<GitHubAuthStatus | null>(null);
  const [showGithub, setShowGithub] = useState(false);
  const [workspaceMenuPoint, setWorkspaceMenuPoint] = useState<ContextMenuPoint | null>(null);

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
    settingsGet().then((value) => setTheme(value.theme)).catch(console.error);
    refreshWorkspace().catch(console.error);
    refreshGitHub().catch(console.error);

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
          });
          break;
        case "tool_call_end":
          updateToolCallResult(sid, chunk.tool_id!, chunk.result);
          break;
        case "done":
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
    };
  }, [
    addMessage,
    addToolCall,
    appendToLastMessage,
    finalizeAssistantMessage,
    refreshGitHub,
    refreshWorkspace,
    setSessions,
    setStreaming,
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

  // Ctrl+K command palette & Ctrl+, settings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const dispose = listen("menu:new-session", async () => {
      const session = await sessionCreate("新会话", "gpt-4.1");
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
      const session = await sessionCreate("新会话", "gpt-4.1");
      upsertSession(session);
      setActiveSession(session.id);
      setNavSection("sessions");
    } catch (error) {
      console.error("创建会话失败：", error);
    }
  }, [setActiveSession, upsertSession]);

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
              <img src={wthIcon} alt="WTH" className="w-8 h-8 rounded-lg object-cover" />
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
                placeholder="搜索"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[13px] placeholder:text-[13px]"
                style={{ color: "var(--text-primary)" }}
              />
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
            {navSection === "sessions" ? (
              <Sidebar
                sessions={sessions}
                activeId={activeSessionId}
                onSelect={setActiveSession}
                onDeleteSession={handleDeleteSession}
                onRenameSession={handleRenameSession}
                onTogglePinSession={handleTogglePinSession}
                searchQuery={searchQuery}
              />
            ) : navSection === "files" ? (
              <FileTree workspaceActive={workspaceActive} />
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
            className="flex items-center justify-between gap-2 px-3 py-2 border-b flex-shrink-0"
            style={{ background: "var(--bg-body)", borderColor: "var(--surface-3)" }}
          >
              <div className="flex items-center gap-2 min-w-0">
                <ToolbarButton icon={<Plus size={15} />} label="新建会话" onClick={handleNewSession} />
                <ToolbarButton
                  icon={<FolderOpen size={14} />}
                  label={workspaceLabel}
                  onClick={openWorkspaceMenu}
                  onContextMenu={openWorkspaceMenu}
                />
              </div>
              <ToolbarButton
                icon={showTerminalPanel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                label="终端面板"
                onClick={() => setShowTerminalPanel((current) => !current)}
                active={showTerminalPanel}
              />
            </div>

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
        </main>
      </div>

      <StatusBar
        modelLabel={activeSession?.model}
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
