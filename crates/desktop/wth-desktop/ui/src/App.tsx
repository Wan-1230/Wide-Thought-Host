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
  MessageSquare,
  Folder,
  Settings,
  Sun,
  Moon,
  Terminal,
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
    return "dark";
  });

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

  const navItems: { id: NavSection; label: string; icon: React.ReactNode }[] = [
    { id: "sessions", label: "会话", icon: <MessageSquare size={18} /> },
    { id: "files", label: "文件", icon: <Folder size={18} /> },
    { id: "settings", label: "设置", icon: <Settings size={18} /> },
  ];

  return (
    <div className="h-full w-full flex bg-surface-0" style={{ color: "var(--text-primary)" }}>
      {/* 左侧边栏 — 垂直导航 + 内容区 */}
      <div className="w-56 flex flex-col border-r border-surface-4 bg-surface-1">
        {/* Logo + 主题切换 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent-primary flex items-center justify-center">
              <span className="text-xs font-bold text-white">W</span>
            </div>
            <span className="text-sm font-semibold">Wide Thought Host</span>
          </div>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
            className="p-1.5 rounded-md hover:bg-surface-2 transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>

        {/* 导航菜单 */}
        <nav className="px-2 py-2 space-y-0.5 border-b border-surface-4">
          {navItems.map((item) => {
            const active = navSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setNavSection(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium
                  transition-all duration-150 ease-out
                  hover:scale-[1.02] active:scale-[0.98]
                  ${active ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-surface-2"}
                `}
                style={!active ? { color: "var(--text-muted)" } : undefined}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* 侧边栏内容区 — 会话/文件用，设置走主内容区 */}
        <div className="flex-1 overflow-hidden">
          {navSection === "sessions" && (
            <Sidebar
              sessions={sessions}
              activeId={activeSessionId}
              onSelect={setActiveSession}
              onNew={handleNewSession}
            />
          )}
          {navSection === "files" && <FileTree />}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* 顶栏 — 在设置页面隐藏 */}
        {navSection !== "settings" && (
          <div className="h-10 border-b border-surface-4 flex items-center px-4 gap-3 bg-surface-1">
            <div className="text-sm font-medium flex-1 truncate" style={{ color: "var(--text-muted)" }}>
              {activeSessionId
                ? sessions.find((s) => s.id === activeSessionId)?.title || "Wide Thought Host"
                : "Wide Thought Host"}
            </div>
            <button
              onClick={() => setRightPanel(rightPanel === "chat" ? "terminal" : "chat")}
              className="p-1.5 rounded hover:bg-surface-3 transition-colors"
              style={{ color: "var(--text-muted)" }}
              title={rightPanel === "chat" ? "显示终端" : "显示对话"}
            >
              <Terminal size={16} />
            </button>
          </div>
        )}

        {/* 主内容 */}
        <div className="flex-1 overflow-hidden min-h-0">
          {navSection === "settings" ? (
            <SettingsPanel />
          ) : rightPanel === "chat" ? (
            <ChatView />
          ) : (
            <TerminalPanel />
          )}
        </div>
      </div>
    </div>
  );
}
