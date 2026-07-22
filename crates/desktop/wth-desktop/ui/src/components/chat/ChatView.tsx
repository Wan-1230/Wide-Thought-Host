// ChatView — 聊天主区组件。

// 以及底部输入区（textarea + 发送按钮）。
//
// 状态从 Zustand store 读取：messages、streaming、activeSessionId。
// 发送消息通过 IPC agent_send → Rust 后端 → wth 二进制 → 流式回显。
//
// 配色沿用 Tailwind surface-N + accent-N 色板。

import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Send,
  Square,
  Bot,
  AlertCircle,
  Wrench,
  ChevronRight,
  ChevronDown,
  Brain,
} from "lucide-react";
import { THINKING_MESSAGE, useChatStore } from "@/stores/chat";
import { agentSend, agentAbort } from "@/lib/ipc";
import type { ChatMessage, ToolCall } from "@/stores/chat";
import wthBanner from "@/assets/wth-banner.png";

/// 渲染单条 tool call 卡片（折叠式）。
function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const argStr = JSON.stringify(call.arguments, null, 2);
  const resultStr =
    call.result !== undefined ? JSON.stringify(call.result, null, 2) : null;

  return (
    <div className="my-2 border rounded-lg overflow-hidden text-xs" style={{ borderColor: "var(--surface-4)", background: "var(--surface-1)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
        )}
        <Wrench size={12} className="text-accent-orange" />
        <span className="font-mono" style={{ color: "var(--text-primary)" }}>{call.name}</span>
        {resultStr === null && (
          <span className="ml-auto text-[10px] text-accent-orange animate-pulse">
            运行中…
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t px-3 py-2 space-y-2" style={{ borderColor: "var(--surface-4)" }}>
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: "var(--text-muted)" }}>参数</div>
            <pre className="font-mono overflow-x-auto text-[11px]" style={{ color: "var(--text-primary)" }}>
              {argStr}
            </pre>
          </div>
          {resultStr !== null && (
            <div>
              <div className="text-[10px] uppercase mb-1" style={{ color: "var(--text-muted)" }}>结果</div>
              <pre className="font-mono overflow-x-auto text-[11px] max-h-48 overflow-y-auto" style={{ color: "var(--text-primary)" }}>
                {resultStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/// 渲染单条消息。
function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[78%]">
          <div
            className="rounded-2xl rounded-tr-sm px-4 py-2.5 animate-fade-in"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--surface-4)",
            }}
          >
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {msg.content}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === "system") {
    return (
      <div className="flex items-center justify-center my-3 animate-fade-in">
        <div
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full"
          style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
        >
          <AlertCircle size={11} />
          {msg.content}
        </div>
      </div>
    );
  }

  // assistant
  if (msg.content === THINKING_MESSAGE) {
    return (
      <div className="flex items-start gap-3 mb-4 animate-fade-in">
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
          style={{ background: "var(--surface-3)" }}
        >
          <Bot size={14} style={{ color: "var(--accent-purple)" }} />
        </div>
        <div
          className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm flex items-center gap-2"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-4)",
            color: "var(--text-muted)",
          }}
        >
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--accent-blue)] animate-pulse" />
          <span>{THINKING_MESSAGE}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 mb-4 animate-fade-in">
      <div
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
        style={{ background: "var(--surface-3)" }}
      >
        <Bot size={14} style={{ color: "var(--accent-purple)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="rounded-2xl rounded-tl-sm px-4 py-2.5"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-4)",
            color: "var(--text-primary)",
          }}
        >
          <div className="prose prose-sm max-w-none break-words leading-relaxed"
            style={{ color: "var(--text-primary)" }}>
            <ReactMarkdown
              components={{
                code({ node, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || "");
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code
                        className="px-1.5 py-0.5 rounded font-mono text-[12px]"
                        style={{ background: "var(--surface-3)", color: "var(--accent-orange)" }}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }
                  return (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match ? match[1] : "text"}
                      PreTag="div"
                      customStyle={{
                        margin: 0,
                        background: "var(--surface-0)",
                        border: "1px solid var(--surface-4)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    >
                      {String(children).replace(/\n$/, "")}
                    </SyntaxHighlighter>
                  );
                },
              }}
            >
              {msg.content || ""}
            </ReactMarkdown>
          </div>
        </div>
        {msg.tool_calls && msg.tool_calls.length > 0 && (
          <div className="mt-2">
            {msg.tool_calls.map((tc) => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/// 流式光标 — 当 streaming=true 时显示跳动方块。
function StreamingCursor() {
  return (
    <span className="inline-block w-2 h-4 bg-accent-blue ml-0.5 animate-pulse align-middle" />
  );
}

export function ChatView({ onNewSession }: { onNewSession?: () => void }) {
  const {
    activeSessionId,
    messages,
    streaming,
    addMessage,
    appendToLastMessage,
    finalizeAssistantMessage,
    setStreaming,
  } = useChatStore();

  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sessionMessages = activeSessionId
    ? messages[activeSessionId] || []
    : [];
  const isStreaming = activeSessionId ? streaming[activeSessionId] || false : false;

  // 消息流变化时滚到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionMessages.length, sessionMessages[sessionMessages.length - 1]?.content]);

  // textarea 自适应高度
  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [input]);

  const handleSend = async () => {
    if (!activeSessionId) return;
    const content = input.trim();
    if (!content || isStreaming) return;

    // 添加 user 消息到 store
    addMessage(activeSessionId, {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    });

    // 添加占位的 assistant 消息（流式 chunk 会 appendToLastMessage）
    addMessage(activeSessionId, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: THINKING_MESSAGE,
      timestamp: new Date().toISOString(),
    });

    setStreaming(activeSessionId, true);
    setInput("");

    try {
      await agentSend({
        session_id: activeSessionId,
        content,
      });
    } catch (err) {
      console.error("发送失败：", err);
      finalizeAssistantMessage(activeSessionId, "（发送失败）");
      addMessage(activeSessionId, {
        id: crypto.randomUUID(),
        role: "system",
        content: `发送失败：${err}`,
        timestamp: new Date().toISOString(),
      });
      setStreaming(activeSessionId, false);
    }
  };

  const handleAbort = async () => {
    if (!activeSessionId) return;
    try {
      await agentAbort(activeSessionId);
      finalizeAssistantMessage(activeSessionId, "（已中止）");
      setStreaming(activeSessionId, false);
    } catch (err) {
      console.error("中止失败：", err);
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送 / Shift+Enter 换行
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 空状态 — WTH banner + 居中 CTA
  if (!activeSessionId) {
    return (
      <div
        className="h-full w-full flex flex-col items-center justify-center select-none"
        style={{ color: "var(--text-primary)" }}
      >
        {/* WTH logo 横幅（顶部居中） */}
        <img
          src={wthBanner}
          alt="Wide Thought Host"
          className="max-w-xs w-2/3 h-auto object-contain mb-6"
        />

        {/* 副标题 */}
        <p
          className="text-sm mb-8"
          style={{ color: "var(--text-muted)" }}
        >
          你的 AI 编码代理
        </p>

        {/* 居中 pill 提示 + 按钮 */}
        <div className="w-full max-w-md px-6">
          <button
            onClick={onNewSession}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-full
              transition-all duration-200 ease-out
              hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--surface-3)",
            }}
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
            >
              <Brain size={12} />
            </span>
            <span
              className="text-sm flex-1 text-left"
              style={{ color: "var(--text-muted)" }}
            >
              你今天想做什么？
            </span>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
            >
              Enter
            </span>
          </button>
        </div>

        {/* 推荐操作 */}
        <div className="flex items-center gap-2 mt-4 text-[11px]" style={{ color: "var(--text-dim)" }}>
          <span>支持</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)" }}>GPT-4.1</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)" }}>Claude 4</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)" }}>DeepSeek</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* 消息流 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {sessionMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center select-none" style={{ color: "var(--text-dim)" }}>
            <p className="text-xs">输入消息开始对话</p>
          </div>
        ) : (
          sessionMessages.map((msg, idx) => {
            const isLast = idx === sessionMessages.length - 1;
            const showCursor =
              isLast && msg.role === "assistant" && isStreaming;
            return (
              <div key={msg.id}>
                <MessageBubble msg={msg} />
                {showCursor && <StreamingCursor />}
              </div>
            );
          })
        )}
      </div>

      {/* 输入区 */}
      <div className="px-6 py-4" style={{ background: "var(--bg-body)" }}>
        <div className="max-w-2xl mx-auto">
          <div
            className="flex items-center gap-2 rounded-3xl pl-4 pr-2 py-2
              transition-shadow duration-150"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--surface-3)",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={isStreaming ? "正在生成…" : "输入消息…"}
              rows={1}
              className="flex-1 resize-none bg-transparent border-none px-0 py-2 text-sm leading-relaxed
                placeholder:text-[13px] focus:outline-none
                disabled:opacity-50 font-sans"
              style={{ color: "var(--text-primary)" }}
            />
            {isStreaming ? (
              <button
                onClick={handleAbort}
                title="中止"
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center self-center
                  transition-all duration-150 hover:scale-105 active:scale-95"
                style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
              >
                <Square size={11} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                title="发送"
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center self-center
                  transition-all duration-150 hover:scale-105 active:scale-95
                  disabled:opacity-20 disabled:scale-100 disabled:cursor-not-allowed"
                style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
              >
                <Send size={13} />
              </button>
            )}
          </div>
          <div
            className="text-center text-[10px] mt-1.5"
            style={{ color: "var(--text-dim)" }}
          >
            Enter 发送 · Shift+Enter 换行
          </div>
        </div>
      </div>
    </div>
  );
}
