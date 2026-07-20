import { useEffect, useState, useCallback } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { ChatView } from "./components/chat/ChatView";
import { FileTree } from "./components/filetree/FileTree";
import { SettingsPanel } from "./components/settings/Settings";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { useChatStore } from "./stores/chat";
import { sessionList, sessionCreate, onAgentStream } from "./lib/ipc";
import type { StreamChunk } from "./lib/ipc";
import {
  Search,
  MessageSquare,
  Folder,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Terminal,
  Sparkles,
  Lock,
  Plus,
  X,
} from "lucide-react";

type NavSection = "sessions" | "files" | "settings";
type RightPanel = "chat" | "terminal";

export default function App() {
  const {
    sessions,
    activeSessionId,
    setSessions,
    setActiveSession,
    addMessage,
    appendToLastMessage,
    setStreaming,
    addToolCall,
    updateToolCallResult,
  } = useChatStore();

  const [navSection, setNavSection] = useState<NavSection>("sessions");
  const [rightPanel, setRightPanel] = useState<RightPanel>("chat");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("wth-theme");
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showPromo, setShowPromo] = useState(true);

  // 同步主题到 <html> class
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    localStorage.setItem("wth-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    sessionList().then(setSessions).catch(console.error);

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
          setStreaming(sid, false);
          break;
        case "error":
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
  }, []);

  const handleNewSession = async () => {
    try {
      const session = await sessionCreate("新会话", "gpt-4.1");
      setSessions([session, ...sessions]);
      setActiveSession(session.id);
    } catch (e) {
      console.error("创建会话失败：", e);
    }
  };

  // 主导航项（图标 + 文字，Grok 风格）
  const navItems: { id: NavSection; label: string; icon: React.ReactNode; indicator?: boolean }[] = [
    { id: "sessions", label: "会话", icon: <MessageSquare size={16} /> },
    { id: "files", label: "文件", icon: <Folder size={16} /> },
    { id: "settings", label: "设置", icon: <SettingsIcon size={16} /> },
  ];

  return (
    <div
      className="h-full w-full flex"
      style={{ background: "var(--bg-body)", color: "var(--text-primary)" }}
    >
      {/* ── 左侧边栏 ────────────────────────────── */}
      <div
        className="w-60 flex-shrink-0 flex flex-col border-r"
        style={{ background: "var(--surface-1)", borderColor: "var(--surface-3)" }}
      >
        {/* Logo + 主题切换 */}
        <div className="px-3 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "var(--text-primary)" }}
            >
              <span
                className="text-xs font-bold"
                style={{ color: "var(--surface-0)", fontStyle: "italic" }}
              >
                W
              </span>
            </div>
            <span className="text-sm font-semibold tracking-tight">Wide Thought</span>
          </div>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "切换浅色" : "切换深色"}
            className="p-1.5 rounded-md hover:bg-surface-2 transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-3 pb-2">
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
            style={{ background: "var(--surface-2)" }}
          >
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

        {/* 主导航 */}
        <nav className="px-2 py-1 space-y-0.5">
          {navItems.map((item) => {
            const active = navSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setNavSection(item.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium
                  transition-colors duration-150
                  ${active ? "" : "hover:bg-surface-2"}
                `}
                style={{
                  background: active ? "var(--surface-2)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-primary)",
                }}
              >
                {item.icon}
                <span className="flex-1 text-left">{item.label}</span>
                {item.indicator && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
                )}
              </button>
            );
          })}
        </nav>

        {/* 会话分组标题 */}
        {navSection === "sessions" && (
          <div className="px-3 pt-4 pb-1 flex items-center justify-between">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-dim)" }}
            >
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

        {/* 侧边栏内容区 */}
        <div className="flex-1 overflow-hidden min-h-0">
          {navSection === "sessions" && (
            <Sidebar
              sessions={sessions}
              activeId={activeSessionId}
              onSelect={setActiveSession}
              searchQuery={searchQuery}
            />
          )}
          {navSection === "files" && <FileTree />}
        </div>

        {/* 底部用户区域 */}
        <div
          className="px-3 py-3 border-t flex items-center gap-2.5"
          style={{ borderColor: "var(--surface-3)" }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold"
            style={{ background: "var(--surface-3)", color: "var(--text-primary)" }}
          >
            W
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium truncate">用户</div>
            <div className="text-[10px] truncate" style={{ color: "var(--text-dim)" }}>
              Free 计划
            </div>
          </div>
        </div>
      </div>

      {/* ── 主内容区 ────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* 顶栏 — 右上角操作按钮 */}
        {navSection !== "settings" && (
          <div
            className="flex items-center justify-end gap-1 px-3 py-1.5 border-b flex-shrink-0"
            style={{ background: "var(--bg-body)", borderColor: "var(--surface-3)" }}
          >
            <TopActionButton icon={<Sparkles size={15} />} label="Imagine" />
            <TopActionButton icon={<Lock size={14} />} label="Private" />
            <TopActionButton
              icon={<Terminal size={15} />}
              label={rightPanel === "chat" ? "终端" : "对话"}
              onClick={() => setRightPanel(rightPanel === "chat" ? "terminal" : "chat")}
              active={rightPanel === "terminal"}
            />
          </div>
        )}

        {/* 主内容 */}
        <div className="flex-1 overflow-hidden min-h-0">
          {navSection === "settings" ? (
            <SettingsPanel />
          ) : rightPanel === "chat" ? (
            <ChatView onNewSession={handleNewSession} />
          ) : (
            <TerminalPanel />
          )}
        </div>

        {/* 右下角推广卡片（仅 chat 面板） */}
        {navSection === "sessions" && rightPanel === "chat" && showPromo && (
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
    </div>
  );
}

// 顶部操作按钮（右上角）
function TopActionButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium
        transition-all duration-150 ease-out hover:scale-[1.03] active:scale-[0.97]"
      style={{
        background: active ? "var(--surface-2)" : "transparent",
        color: "var(--text-primary)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      {label}
    </button>
  );
}
