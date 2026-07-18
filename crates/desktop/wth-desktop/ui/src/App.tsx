import { useEffect, useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { ChatView } from "./components/chat/ChatView";
import { FileTree } from "./components/filetree/FileTree";
import { useChatStore } from "./stores/chat";
import { sessionList, sessionCreate, onAgentStream } from "./lib/ipc";
import type { StreamChunk } from "./lib/ipc";
import { PanelLeft, PanelRight, Folder, Terminal } from "lucide-react";

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

  const [leftPanel, setLeftPanel] = useState<"sessions" | "files">("sessions");
  const [rightPanel, setRightPanel] = useState<"chat" | "terminal">("chat");

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
            content: `Error: ${chunk.message}`,
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
      const session = await sessionCreate("New Session", "gpt-4.1");
      setSessions([session, ...sessions]);
      setActiveSession(session.id);
    } catch (e) {
      console.error("Failed to create session:", e);
    }
  };

  return (
    <div className="h-full w-full flex bg-surface-0">
      {/* Left sidebar */}
      <div className="w-64 flex flex-col border-r border-surface-4 bg-surface-1">
        {/* Sidebar tabs */}
        <div className="flex border-b border-surface-4">
          <button
            onClick={() => setLeftPanel("sessions")}
            className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              leftPanel === "sessions"
                ? "text-accent-blue border-b-2 border-accent-blue"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <PanelLeft size={14} />
            Sessions
          </button>
          <button
            onClick={() => setLeftPanel("files")}
            className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              leftPanel === "files"
                ? "text-accent-blue border-b-2 border-accent-blue"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <Folder size={14} />
            Files
          </button>
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-hidden">
          {leftPanel === "sessions" ? (
            <Sidebar
              sessions={sessions}
              activeId={activeSessionId}
              onSelect={setActiveSession}
              onNew={handleNewSession}
            />
          ) : (
            <FileTree />
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-10 border-b border-surface-4 flex items-center px-4 gap-3 bg-surface-1">
          <div className="text-sm font-medium text-gray-300 flex-1 truncate">
            {activeSessionId
              ? sessions.find((s) => s.id === activeSessionId)?.title || "Wide Thought Host"
              : "Wide Thought Host"}
          </div>
          <button
            onClick={() => setRightPanel(rightPanel === "chat" ? "terminal" : "chat")}
            className="p-1.5 rounded hover:bg-surface-3 text-gray-500 hover:text-gray-300 transition-colors"
            title={rightPanel === "chat" ? "Show Terminal" : "Show Chat"}
          >
            {rightPanel === "chat" ? <Terminal size={16} /> : <PanelRight size={16} />}
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden">
          {rightPanel === "chat" ? (
            <ChatView />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              <p className="text-sm">Terminal panel — coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
