import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chat";
import { agentSend } from "@/lib/ipc";
import type { ChatMessage, ToolCall } from "@/stores/chat";
import { Send, Square, Bot, User, Wrench, Loader2 } from "lucide-react";

export function ChatView() {
  const {
    activeSessionId,
    messages,
    streaming,
    addMessage,
    setStreaming,
  } = useChatStore();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionMessages = activeSessionId ? messages[activeSessionId] || [] : [];
  const isStreaming = activeSessionId ? streaming[activeSessionId] || false : false;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [sessionMessages]);

  const handleSend = async () => {
    if (!input.trim() || !activeSessionId || isStreaming) return;

    const 用户Msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "用户",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    addMessage(activeSessionId, 用户Msg);
    addMessage(activeSessionId, {
      id: crypto.randomUUID(),
      role: "助手",
      content: "",
      timestamp: new Date().toISOString(),
    });

    setInput("");
    setStreaming(activeSessionId, true);

    try {
      await agentSend({
        session_id: activeSessionId,
        content: 用户Msg.content,
      });
    } catch (e) {
      addMessage(activeSessionId, {
        id: crypto.randomUUID(),
        role: "系统",
        content: `错误：${String(e)}`,
        timestamp: new Date().toISOString(),
      });
      setStreaming(activeSessionId, false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {sessionMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <Bot size={48} className="mx-auto mb-4 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-300 mb-2">
                Wide Thought Host
              </h2>
              <p className="text-sm text-gray-500">
                开始对话。我可以读写文件、运行终端命令，帮你构建任何东西。
              </p>
            </div>
          </div>
        ) : (
          sessionMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-gray-500 text-xs mt-2 animate-fade-in">
            <Loader2 size={12} className="animate-spin" />
            思考中...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-surface-4 p-3 bg-surface-1">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="给 WTH 发消息..."
            rows={1}
            className="flex-1 bg-surface-2 border border-surface-4 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-accent-blue transition-colors max-h-32"
            style={{ minHeight: "42px" }}
          />
          <button
            onClick={isStreaming ? undefined : handleSend}
            disabled={isStreaming}
            className={`p-2.5 rounded-lg transition-colors ${
              isStreaming
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20"
            }`}
          >
            {isStreaming ? <Square size={18} /> : <Send size={18} />}
          </button>
        </div>
        <div className="text-[10px] text-gray-500 mt-1.5 text-center">
          回车发送 · Shift+回车换行
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const roleLabel: Record<string, string> = {
    user: "用户",
    assistant: "助手",
    system: "系统",
  };

  return (
    <div className={`mb-4 animate-fade-in ${isUser ? "flex justify-end" : ""}`}>
      {/* Role indicator */}
      <div
        className={`flex items-center gap-2 mb-1 ${
          isUser ? "justify-end" : ""
        }`}
      >
        {message.role === "assistant" && (
          <Bot size={14} className="text-accent-purple" />
        )}
        {isUser && <User size={14} className="text-accent-blue" />}
        {isSystem && <Wrench size={14} className="text-accent-orange" />}
        <span className="text-[10px] text-gray-500 uppercase font-medium">
          {roleLabel[message.role] || message.role}
        </span>
      </div>

      {/* Content */}
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-accent-blue/10 border border-accent-blue/20 text-gray-100"
            : isSystem
            ? "bg-accent-orange/10 border border-accent-orange/20 text-gray-300"
            : "bg-surface-2 border border-surface-4 text-gray-200"
        }`}
      >
        {message.content ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 size={12} className="animate-spin" />
            思考中...
          </div>
        )}

        {/* Tool calls */}
        {message.tool_calls?.map((tc) => (
          <ToolCallBubble key={tc.id} call={tc} />
        ))}
      </div>
    </div>
  );
}

function ToolCallBubble({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 border border-surface-4 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface-3 hover:bg-surface-4 transition-colors text-xs"
      >
        <Wrench size={12} className="text-accent-green" />
        <span className="text-accent-green font-medium">{call.name}</span>
        {call.result !== undefined && (
          <span className="text-gray-500 ml-auto">✓</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 text-xs text-gray-400 bg-surface-2 font-mono max-h-32 overflow-y-auto">
          {call.result !== undefined ? (
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(call.result, null, 2)}
            </pre>
          ) : (
            <span className="text-gray-500">运行中...</span>
          )}
        </div>
      )}
    </div>
  );
}
