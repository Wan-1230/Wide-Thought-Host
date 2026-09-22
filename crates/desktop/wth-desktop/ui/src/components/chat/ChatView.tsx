// ChatView — 聊天主区组件。

// 以及底部输入区（textarea + 发送按钮）。
//
// 状态从 Zustand store 读取：messages、streaming、activeSessionId。
// 发送消息通过 IPC agent_send → Rust 后端 → wth 二进制 → 流式回显。
//
// 配色沿用 Tailwind surface-N + accent-N 色板。

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertCircle,
  AtSign,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Eraser,
  FileText,
  GitBranch,
  Loader2,
  MessageSquareDashed,
  PanelRightOpen,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  Slash,
  Square,
  Users,
  X,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import wthBanner from "@/assets/wth-banner.png";
import {
  ContextMenu,
  type ContextMenuPoint,
  contextMenuPointFromEvent,
} from "@/components/common/ContextMenu";
import { WorkflowModal } from "@/components/common/WorkflowModal";
import { SyntaxHighlighter } from "@/lib/highlight";
import type {
  Attachment,
  FileEntry,
  HistoryMessage,
  PromptTemplate,
  SlashCommandInfo,
  SubagentConfig,
  WorkspaceSearchHit,
} from "@/lib/ipc";
import {
  agentAbort,
  agentApproveTool,
  agentDenyTool,
  agentSend,
  fileList,
  listSlashCommands,
  memoryWrite,
  resolveSkill,
  sessionCreate,
  sessionSaveMessages,
  settingsGet,
  subagentList,
  subagentRun,
  workspaceGet,
  workspaceSearch,
} from "@/lib/ipc";
import type { ChatMessage, ToolCall } from "@/stores/chat";
import { THINKING_MESSAGE, useChatStore } from "@/stores/chat";
import { useUiStore } from "@/stores/ui";
import { useWorkbenchStore } from "@/stores/workbench";

// ─── 附件工具 ─────────────────────────────────────────

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];
const TEXT_EXT = [
  "md",
  "txt",
  "json",
  "toml",
  "yaml",
  "yml",
  "ini",
  "csv",
  "rs",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "go",
  "c",
  "cpp",
  "h",
  "hpp",
  "java",
  "kt",
  "swift",
  "html",
  "css",
  "scss",
  "vue",
  "svelte",
  "sh",
  "bat",
  "ps1",
  "sql",
  "xml",
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function mimeFromName(name: string, fallback: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
  };
  return map[ext] || fallback || "text/plain";
}

/** 构建附件：图片转 base64 data URL，文本读取内容，其他仅携带路径。 */
async function buildAttachment(
  name: string,
  path: string | null,
  file?: File,
): Promise<Attachment> {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const mime_type = mimeFromName(name, file?.type || "text/plain");
  if (IMAGE_EXT.includes(ext)) {
    let bytes: Uint8Array;
    if (file) {
      bytes = new Uint8Array(await file.arrayBuffer());
    } else if (path) {
      bytes = await readFile(path);
    } else {
      return { name, mime_type };
    }
    if (bytes.length > 10 * 1024 * 1024) {
      throw new Error(`图片 ${name} 超过 10MB 限制`);
    }
    return {
      name,
      path: path ?? undefined,
      mime_type,
      data_url: `data:${mime_type};base64,${bytesToBase64(bytes)}`,
    };
  }
  if (TEXT_EXT.includes(ext) || !file) {
    let text: string;
    if (file) {
      text = await file.text();
    } else if (path) {
      text = await readTextFile(path);
    } else {
      return { name, mime_type };
    }
    if (text.length > 1_000_000) {
      text = text.slice(0, 1_000_000) + "\n…（附件过大已截断）";
    }
    return { name, path: path ?? undefined, mime_type, content: text };
  }
  return { name, path: path ?? undefined, mime_type };
}

/// 提取工具调用的关键摘要，用于审批说明（优先展示 bash 命令 / git 子命令 / 目标路径）。
function summarizeToolArgs(call: ToolCall): string {
  const args = (call.arguments ?? null) as Record<string, unknown> | null;
  if (!args || typeof args !== "object") return "";
  if (typeof args.command === "string") return args.command;
  if (Array.isArray(args.args)) return `git ${args.args.join(" ")}`;
  if (typeof args.path === "string") {
    return typeof args.query === "string" ? `${args.path} → ${args.query}` : args.path;
  }
  const s = JSON.stringify(args);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

/// 渲染单条 tool call 卡片（折叠式）。待确认的高危操作（如 bash）审批区直接外露，无需展开；
/// 命令在后端确认前不会执行。
function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeSessionId = useChatStore(s => s.activeSessionId);
  const updateToolCall = useChatStore(s => s.updateToolCall);
  const showDiff = useWorkbenchStore(s => s.showDiff);
  const argStr = JSON.stringify(call.arguments, null, 2);
  const resultStr = call.result !== undefined ? JSON.stringify(call.result, null, 2) : null;

  const pending = call.status === "pending";
  const running = call.status === "running" || (resultStr === null && !pending);
  const resultObj = (call.result ?? null) as Record<string, unknown> | null;
  const hasDiff =
    resultObj !== null &&
    typeof resultObj.before_full === "string" &&
    typeof resultObj.after_full === "string" &&
    typeof resultObj.path === "string";

  let statusColor = "var(--accent-green)";
  let statusLabel: string | null = null;
  if (pending) {
    statusColor = "var(--accent-yellow)";
    statusLabel = "等待确认";
  } else if (running) {
    statusColor = "var(--accent-orange)";
    statusLabel = "运行中…";
  } else if (
    resultStr !== null &&
    (String(call.result).includes("error") || String(call.result).includes("Error"))
  ) {
    statusColor = "var(--accent-red)";
  }

  const handleApprove = async () => {
    if (!activeSessionId || busy) return;
    setBusy(true);
    try {
      await agentApproveTool(activeSessionId, call.id);
      updateToolCall(activeSessionId, call.id, { status: "running" });
    } catch (error) {
      console.error("批准工具调用失败：", error);
    } finally {
      setBusy(false);
    }
  };

  const handleDeny = async () => {
    if (!activeSessionId || busy) return;
    setBusy(true);
    try {
      await agentDenyTool(activeSessionId, call.id);
      updateToolCall(activeSessionId, call.id, {
        status: "done",
        result: { denied: true, message: "用户拒绝了该操作" },
      });
    } catch (error) {
      console.error("拒绝工具调用失败：", error);
    } finally {
      setBusy(false);
    }
  };

  const statusIcon = pending ? (
    <AlertCircle size={13} style={{ color: statusColor }} />
  ) : running ? (
    <Loader2 size={13} className="animate-spin" style={{ color: statusColor }} />
  ) : statusColor === "var(--accent-red)" ? (
    <X size={13} style={{ color: statusColor }} />
  ) : (
    <Check size={13} style={{ color: statusColor }} />
  );

  return (
    <div
      className="my-1.5 rounded-lg overflow-hidden text-xs anim-scale-in"
      style={{
        borderColor: "var(--surface-3)",
        background: "var(--surface-1)",
        border: "1px solid var(--surface-3)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
      >
        <span className="flex-shrink-0">{statusIcon}</span>
        <span
          className="font-mono font-medium flex-shrink-0"
          style={{ color: "var(--text-primary)" }}
        >
          {call.name}
        </span>
        <span
          className="truncate font-mono text-[11px] min-w-0 flex-1"
          style={{ color: "var(--text-dim)" }}
        >
          {summarizeToolArgs(call)}
        </span>
        <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {statusLabel && (
            <span className="text-[10.5px]" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          )}
          {expanded ? (
            <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
          )}
        </span>
      </button>
      {/* 待确认审批区：直接渲染在对话流中，无需展开卡片 */}
      {pending && (
        <div
          className="border-t px-3 py-2.5 space-y-2"
          style={{
            borderColor: "var(--surface-3)",
            background: "color-mix(in srgb, var(--accent-yellow) 7%, var(--surface-1))",
          }}
        >
          <div
            className="flex items-center gap-1.5 text-[11px] font-medium"
            style={{ color: "var(--accent-yellow)" }}
          >
            <AlertCircle size={12} className="flex-shrink-0" />
            高危操作待确认 · <span className="font-mono">{call.name}</span>，确认前不会执行
          </div>
          {(() => {
            const summary = summarizeToolArgs(call);
            return summary ? (
              <pre
                className="font-mono text-[11px] whitespace-pre-wrap break-all rounded-md px-2.5 py-1.5 max-h-32 overflow-y-auto"
                style={{
                  background: "var(--surface-0)",
                  border: "1px solid var(--surface-3)",
                  color: "var(--text-primary)",
                }}
              >
                {summary}
              </pre>
            ) : null;
          })()}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium press disabled:opacity-50 whitespace-nowrap flex-shrink-0"
              style={{ background: "var(--accent-primary)", color: "var(--bg-body)" }}
            >
              确认执行
            </button>
            <button
              type="button"
              onClick={handleDeny}
              disabled={busy}
              className="small-btn disabled:opacity-50"
            >
              拒绝
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="border-t px-3 py-2 space-y-2" style={{ borderColor: "var(--surface-3)" }}>
          <div>
            <div
              className="text-[10px] uppercase tracking-wider mb-1"
              style={{ color: "var(--text-dim)" }}
            >
              参数
            </div>
            <pre
              className="font-mono overflow-x-auto text-[11px] rounded-md p-2"
              style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}
            >
              {argStr}
            </pre>
          </div>
          {resultStr !== null && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wider mb-1"
                style={{ color: "var(--text-dim)" }}
              >
                结果
              </div>
              <pre
                className="font-mono overflow-x-auto text-[11px] max-h-48 overflow-y-auto rounded-md p-2"
                style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}
              >
                {resultStr}
              </pre>
              {hasDiff && (
                <button
                  type="button"
                  onClick={() =>
                    showDiff({
                      path: String(resultObj.path),
                      before: String(resultObj.before_full),
                      after: String(resultObj.after_full),
                    })
                  }
                  className="mt-2 px-3 py-1.5 rounded-lg text-[11px] font-medium press whitespace-nowrap flex-shrink-0"
                  style={{ background: "var(--surface-3)", color: "var(--text-primary)" }}
                >
                  查看 Diff / 撤销
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/// 代码块：带语言标签与一键复制按钮。
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="rounded-lg overflow-hidden my-2"
      style={{ border: "1px solid var(--surface-3)", background: "var(--surface-0)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[10.5px]"
        style={{
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--surface-3)",
          color: "var(--text-dim)",
        }}
      >
        <span className="font-mono">{language}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors hover:bg-[color:var(--surface-3)]"
          style={{ color: copied ? "var(--accent-green)" : "var(--text-muted)" }}
          onClick={() => {
            navigator.clipboard.writeText(code).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          background: "var(--surface-0)",
          border: "none",
          borderRadius: 0,
          fontSize: "12.5px",
          padding: "12px 14px",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

/// Agent 多步骤执行进度卡片：汇总本条消息的工具调用，支持展开详情与随时中断。
/// 待确认的调用不随卡片折叠，直接在主对话流展示审批控件。
function StepProgressCard({ calls }: { calls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const activeSessionId = useChatStore(s => s.activeSessionId);
  const setStreaming = useChatStore(s => s.setStreaming);
  const finalizeAssistantMessage = useChatStore(s => s.finalizeAssistantMessage);
  const pendingCalls = calls.filter(c => c.status === "pending");
  const running = calls.some(
    c => c.status === "running" || c.status === "pending" || c.result === undefined,
  );
  const failed = calls.some(c => /error/i.test(String(JSON.stringify(c.result ?? ""))));
  const doneCount = calls.filter(c => c.result !== undefined).length;

  const abort = async () => {
    if (!activeSessionId) return;
    try {
      await agentAbort(activeSessionId);
      finalizeAssistantMessage(activeSessionId, "（已中止）");
      setStreaming(activeSessionId, false);
    } catch (err) {
      console.error("中止失败：", err);
    }
  };

  return (
    <div
      className="my-1.5 rounded-lg overflow-hidden"
      style={{
        borderColor: "var(--surface-3)",
        background: "var(--surface-1)",
        border: "1px solid var(--surface-3)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[color:var(--surface-2)] transition-colors"
      >
        {expanded ? (
          <ChevronUp size={12} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
        )}
        {running ? (
          <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        ) : failed ? (
          <AlertCircle size={12} style={{ color: "var(--accent-red)" }} />
        ) : (
          <Check size={12} style={{ color: "var(--accent-green)" }} />
        )}
        <span
          className="text-[12px] font-medium flex-1 text-left"
          style={{ color: "var(--text-primary)" }}
        >
          {running
            ? `正在执行步骤 ${Math.min(doneCount + 1, calls.length)}/${calls.length}`
            : `任务完成 · ${calls.length} 个步骤`}
        </span>
        {pendingCalls.length > 0 && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium animate-pulse whitespace-nowrap flex-shrink-0"
            style={{
              background: "color-mix(in srgb, var(--accent-yellow) 16%, transparent)",
              color: "var(--accent-yellow)",
            }}
          >
            待确认
          </span>
        )}
        {running && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium transition-colors hover:opacity-80 whitespace-nowrap flex-shrink-0"
            style={{ background: "var(--surface-2)", color: "var(--accent-red)" }}
            onClick={e => {
              e.stopPropagation();
              void abort();
            }}
            role="button"
            title="中断任务"
          >
            <Square size={9} />
            中断
          </span>
        )}
      </button>
      {/* 待确认的调用直接外露在主对话流，不进入折叠区 */}
      {pendingCalls.map(call => (
        <ToolCallCard key={call.id} call={call} />
      ))}
      {expanded && (
        <div className="px-3 pb-2 space-y-0.5 border-t" style={{ borderColor: "var(--surface-3)" }}>
          {calls
            .filter(c => c.status !== "pending")
            .map(call => (
              <ToolCallCard key={call.id} call={call} />
            ))}
        </div>
      )}
    </div>
  );
}

/// 从助手消息中提取可点选项（交互式任务如 /brainstorming 输出的选项列表）。
/// 仅识别 2–8 项的编号/符号列表，且消息含提问信号，避免误伤普通对话的列表内容。
function extractQuickOptions(content: string): string[] {
  if (!content || content.length > 8000) return [];
  if (!/选择|请选择|请问|确认|回复|选项|pick|choose|option|which|\?|？/.test(content)) return [];
  const lines = content.split("\n");
  const opts: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // 编号列表：1. / 1) / 1、/ **1.** ；符号列表：- / * / •
    const m = /^(?:\*\*)?\d+[.)、．.](?:\*\*)?\s*(.+)$/.exec(line) || /^[-*•]\s+(.+)$/.exec(line);
    if (!m) {
      // 选项列表开始前的引导语（如“请选择：”）允许忽略；列表后出现正文则放弃提取
      if (opts.length > 0) return [];
      continue;
    }
    let text = m[1]
      .trim()
      .replace(/^\*+|\*+$/g, "")
      .trim();
    if (text.length > 80) text = `${text.slice(0, 80)}…`;
    if (text) opts.push(text);
  }
  if (opts.length < 2 || opts.length > 8) return [];
  // 排除长段落式列表（多为说明文档而非选项）
  if (opts.some(o => o.length > 60)) return [];
  return opts;
}

/// 流式期间稳定不完整的代码围栏：``` 出现奇数次时补一个闭合围栏，
/// 避免 react-markdown 在半截代码块上反复重解析（内容抖动/嵌套渲染）。
function stabilizeStreamingMarkdown(src: string): string {
  const fences = (src.match(/^[ \t]*```/gm) || []).length;
  return fences % 2 === 1 ? `${src}\n\`\`\`` : src;
}

/// 渲染单条消息。live=true 表示正在流式输出，此时长消息不自动折叠。
function MessageBubble({
  msg,
  onContextMenu,
  onRegenerate,
  canRegenerate,
  live,
  onQuickReply,
  quickReplyDisabled,
}: {
  msg: ChatMessage;
  onContextMenu?: (e: ReactMouseEvent<HTMLElement>) => void;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
  live?: boolean;
  onQuickReply?: (text: string) => void;
  quickReplyDisabled?: boolean;
}) {
  // Hook 必须在任何条件早退之前调用（消息从思考占位 → 正式内容时 hooks 数量不变）
  const [collapsedView, setCollapsedView] = useState<boolean | null>(null);
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-5 anim-fade-up" onContextMenu={onContextMenu}>
        <div className="max-w-[78%]">
          <div
            className="rounded-2xl px-4 py-2.5"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-3)",
              color: "var(--text-primary)",
            }}
          >
            <p className="text-[13.5px] whitespace-pre-wrap break-words leading-relaxed">
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
          className="flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-md"
          style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
        >
          <AlertCircle size={11} />
          {msg.content}
        </div>
      </div>
    );
  }

  // assistant — 思考中占位：品牌色 spinner + 流光文本（无气泡，与正文同列对齐）
  if (msg.content === THINKING_MESSAGE) {
    return (
      <div className="flex items-start gap-3 mb-4 anim-fade-up">
        <div
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-3)",
            color: "var(--text-muted)",
          }}
        >
          <Bot size={14} />
        </div>
        <div className="flex items-center gap-2.5 h-7">
          <span
            className="inline-flex h-3.5 w-3.5 rounded-full border-2 animate-spin"
            style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }}
          />
          <span className="text-[13px] shimmer-text font-medium">{THINKING_MESSAGE}</span>
        </div>
      </div>
    );
  }

  const isLong = (msg.content || "").length > 800;
  // 长消息默认折叠，减少视觉压力；流式输出中保持展开
  const isCollapsed = collapsedView ?? (isLong && msg.content !== THINKING_MESSAGE && !live);

  // 交互式任务选项：流式结束后提取，直接渲染可点按钮，无需手动输入
  const quickOptions = !live && onQuickReply ? extractQuickOptions(msg.content || "") : [];

  return (
    <div className="group flex items-start gap-3 mb-6 anim-fade-up" onContextMenu={onContextMenu}>
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--surface-3)",
          color: "var(--text-muted)",
        }}
      >
        <Bot size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`md-body relative ${isCollapsed ? "max-h-40 overflow-hidden" : ""}`}
          style={{ color: "var(--text-primary)" }}
        >
          <ReactMarkdown
            components={{
              code({ node, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                const isInline = !className;
                if (isInline) {
                  return (
                    <code
                      className="px-1.5 py-0.5 rounded-md font-mono text-[12px]"
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--surface-3)",
                        color: "var(--text-primary)",
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <CodeBlock
                    language={match ? match[1] : "text"}
                    code={String(children).replace(/\n$/, "")}
                  />
                );
              },
            }}
          >
            {live ? stabilizeStreamingMarkdown(msg.content || "") : msg.content || ""}
          </ReactMarkdown>
          {live && <span className="stream-caret" />}
          {isCollapsed && (
            <div
              className="absolute inset-x-0 bottom-0 h-12 pointer-events-none"
              style={{ background: "linear-gradient(transparent, var(--surface-0))" }}
            />
          )}
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setCollapsedView(!isCollapsed)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] transition-colors hover:opacity-75 whitespace-nowrap"
            style={{ color: "var(--text-muted)" }}
          >
            {isCollapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            {isCollapsed ? "展开全文" : "收起"}
          </button>
        )}
        {msg.tool_calls && msg.tool_calls.length > 0 && <StepProgressCard calls={msg.tool_calls} />}
        {/* 交互式任务选项按钮：点击即作为回复发送 */}
        {quickOptions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quickOptions.map((opt, i) => (
              <button
                type="button"
                key={`${i}-${opt}`}
                disabled={quickReplyDisabled}
                onClick={() => onQuickReply?.(opt)}
                title={opt}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--surface-3)",
                  color: "var(--text-primary)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = "var(--surface-4)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = "var(--surface-3)";
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {/* 悬浮操作按钮 */}
        <div className="mt-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <MessageActionBtn
            icon={<Copy size={11} />}
            label="复制"
            onClick={() => navigator.clipboard.writeText(msg.content || "")}
          />
          {canRegenerate && onRegenerate && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] transition-colors hover:bg-[color:var(--surface-2)] whitespace-nowrap"
              style={{ color: "var(--text-dim)" }}
              title="重新生成这条回复"
              onClick={onRegenerate}
            >
              <RotateCcw size={11} />
              重新生成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageActionBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] transition-colors hover:bg-[color:var(--surface-2)] whitespace-nowrap"
      style={{ color: "var(--text-dim)" }}
      title={label}
      onClick={() => {
        onClick();
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={11} /> : icon}
      {done ? "已复制" : label}
    </button>
  );
}

interface ChatViewProps {
  onNewSession?: () => void;
  /** 清空当前会话消息（由 App 提供） */
  onClearSession?: () => void;
  /** 导出会话（由 App 提供） */
  onExportSession?: (id: string, format: "markdown" | "json") => void;
  /** 当前会话标题（头部展示） */
  sessionTitle?: string | null;
}

export function ChatView({
  onNewSession,
  onClearSession,
  onExportSession,
  sessionTitle,
}: ChatViewProps) {
  const {
    activeSessionId,
    messages,
    streaming,
    addMessage,
    setMessages,
    truncateMessages,
    appendToLastMessage,
    finalizeAssistantMessage,
    setStreaming,
    upsertSession,
    setActiveSession,
    registerParallelRun,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [showPopup, setShowPopup] = useState<"none" | "file" | "command">("none");
  type PopupItem = {
    label: string;
    value: string;
    kind: "file" | "subagent" | "command" | "search";
    hit?: WorkspaceSearchHit;
  };
  const [popupItems, setPopupItems] = useState<PopupItem[]>([]);
  const [popupIndex, setPopupIndex] = useState(0);
  const [msgMenu, setMsgMenu] = useState<{
    point: ContextMenuPoint;
    content: string;
    role: ChatMessage["role"];
    id: string;
  } | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [subagents, setSubagents] = useState<SubagentConfig[]>([]);
  const [delegatingTo, setDelegatingTo] = useState<SubagentConfig | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [showParallel, setShowParallel] = useState(false);
  const [parallelTask, setParallelTask] = useState("");
  const [parallelSelection, setParallelSelection] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  /** 供全局快捷键（停止生成）调用的中止句柄 */
  const handleAbortRef = useRef<() => Promise<void>>(async () => {});

  // 监听全局快捷键事件：聚焦输入框（Ctrl+L）/ 停止生成（Ctrl+Shift+S）
  useEffect(() => {
    const onFocusInput = () => textareaRef.current?.focus();
    const onStopGeneration = () => {
      if (activeSessionId && streaming[activeSessionId]) void handleAbortRef.current();
    };
    window.addEventListener("wth:focus-input", onFocusInput);
    window.addEventListener("wth:stop-generation", onStopGeneration);
    return () => {
      window.removeEventListener("wth:focus-input", onFocusInput);
      window.removeEventListener("wth:stop-generation", onStopGeneration);
    };
  }, [activeSessionId, streaming]);

  // G4: 监听消息检索跳转事件，滚动并高亮命中消息
  useEffect(() => {
    const onScrollTo = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string; index: number }>).detail;
      if (!detail) return;
      if (typeof detail.index !== "number") return;
      setHighlightIndex(detail.index);
      window.setTimeout(() => {
        const container = scrollRef.current;
        if (!container) return;
        const el = container.querySelector(`[data-message-index="${detail.index}"]`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }, 150);
      window.setTimeout(() => setHighlightIndex(null), 2500);
    };
    window.addEventListener("wth:scroll-to-message", onScrollTo);
    return () => window.removeEventListener("wth:scroll-to-message", onScrollTo);
  }, []);

  const sessionMessages = activeSessionId ? messages[activeSessionId] || [] : [];
  const isStreaming = activeSessionId ? streaming[activeSessionId] || false : false;
  const phase = useChatStore(s => s.phase);
  const currentPhase = activeSessionId ? phase[activeSessionId] : undefined;

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

  // 动态加载斜杠命令（内置 + 技能）
  // G10: 加载提示词模板与工作区名
  useEffect(() => {
    settingsGet()
      .then(s => setTemplates(s.prompt_templates || []))
      .catch(() => {});
    workspaceGet()
      .then(w => setWorkspaceName(w.active ? w.name : ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    listSlashCommands()
      .then(setSlashCommands)
      .catch(() => {});
    subagentList()
      .then(setSubagents)
      .catch(() => {});
  }, []);

  const handleInputChange = async (value: string) => {
    setInput(value);
    // Detect @ or / at current cursor position
    const lastChar = value.slice(-1);
    if (lastChar === "@") {
      setShowPopup("file");
      setPopupIndex(0);
      try {
        const files = await fileList(".", false);
        const fileItems = files
          .slice(0, 8)
          .map((f: FileEntry) => ({ label: f.name, value: f.name, kind: "file" as const }));
        const subItems = subagents
          .filter(s => s.enabled)
          .map(s => ({ label: s.name, value: s.id, kind: "subagent" as const }));
        setPopupItems([...fileItems, ...subItems]);
      } catch {
        setPopupItems([]);
      }
    } else if (lastChar === "/" && value.trim() === "/") {
      setShowPopup("command");
      setPopupIndex(0);
      setPopupItems(
        slashCommands.map(c => ({
          label: `/${c.name}${c.source === "skill" ? ` [${c.scope}]` : ""} — ${c.description.slice(0, 40)}`,
          value: `/${c.name}`,
          kind: "command" as const,
        })),
      );
    } else if (showPopup !== "none") {
      // Filter popup items
      const trigger = showPopup === "file" ? "@" : "/";
      const lastTriggerIdx = value.lastIndexOf(trigger);
      if (lastTriggerIdx === -1) {
        setShowPopup("none");
      } else {
        const query = value.slice(lastTriggerIdx + 1).toLowerCase();
        if (showPopup === "command") {
          const candidates = slashCommands.map(c => ({
            label: `/${c.name}${c.source === "skill" ? ` [${c.scope}]` : ""} — ${c.description.slice(0, 40)}`,
            value: `/${c.name}`,
            kind: "command" as const,
          }));
          setPopupItems(candidates.filter(c => c.label.toLowerCase().includes(query)));
        } else if (showPopup === "file" && query.length > 0) {
          // 代码检索：文件名 + 内容关键词命中
          try {
            const hits = await workspaceSearch(query, 6);
            const searchItems: PopupItem[] = hits.map(h => ({
              label: `${h.path}:${h.line}`,
              value: `${h.path}:${h.line}`,
              kind: "search" as const,
              hit: h,
            }));
            const fileItems = popupItems.filter(p => p.kind === "file");
            const subItems = popupItems.filter(p => p.kind === "subagent");
            setPopupItems([...searchItems, ...fileItems, ...subItems]);
          } catch {
            // 检索失败时保留原列表
          }
        }
        setPopupIndex(0);
      }
    }
  };

  const handlePickAttachments = async () => {
    try {
      const selected = await openDialog({ multiple: true, directory: false, title: "选择附件" });
      const paths =
        typeof selected === "string" ? [selected] : Array.isArray(selected) ? selected : [];
      const fresh: Attachment[] = [];
      for (const p of paths) {
        if (attachments.length + fresh.length >= 5) break;
        const name = p.split(/[\\/]/).pop() || p;
        try {
          fresh.push(await buildAttachment(name, p));
        } catch (err) {
          addMessage(activeSessionId!, {
            id: crypto.randomUUID(),
            role: "system",
            content: `附件处理失败：${err}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
      setAttachments(prev => [...prev, ...fresh].slice(0, 5));
    } catch (err) {
      console.error("选择附件失败：", err);
    }
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    const fresh: Attachment[] = [];
    for (const f of files) {
      if (attachments.length + fresh.length >= 5) break;
      try {
        fresh.push(await buildAttachment(f.name, null, f));
      } catch (err) {
        addMessage(activeSessionId!, {
          id: crypto.randomUUID(),
          role: "system",
          content: `附件处理失败：${err}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
    setAttachments(prev => [...prev, ...fresh].slice(0, 5));
  };

  /** 并行委派：同一任务同时运行多个子智能体，结果由 App 汇总。 */
  const runParallel = async () => {
    if (!activeSessionId || !parallelTask.trim()) return;
    const selected = subagents.filter(s => s.enabled && parallelSelection.has(s.id));
    if (selected.length === 0) return;
    const task = parallelTask.trim();
    addMessage(activeSessionId, {
      id: crypto.randomUUID(),
      role: "user",
      content: `[并行委派] ${task}`,
      timestamp: new Date().toISOString(),
    });
    registerParallelRun(
      activeSessionId,
      selected.map(s => s.name),
    );
    for (const s of selected) {
      addMessage(activeSessionId, {
        id: crypto.randomUUID(),
        role: "system",
        content: `已并行委派给「${s.name}」（子会话）`,
        timestamp: new Date().toISOString(),
      });
      try {
        await subagentRun(s.id, task, activeSessionId);
      } catch (err) {
        addMessage(activeSessionId, {
          id: crypto.randomUUID(),
          role: "system",
          content: `委派「${s.name}」失败：${err}`,
          timestamp: new Date().toISOString(),
        });
        useChatStore
          .getState()
          .completeParallelRun(activeSessionId, crypto.randomUUID(), false, s.name);
      }
    }
    setShowParallel(false);
    setParallelTask("");
    setParallelSelection(new Set());
  };

  const selectPopupItem = (item: PopupItem) => {
    if (item.kind === "file") {
      const lastAt = input.lastIndexOf("@");
      setInput(input.slice(0, lastAt) + `@${item.value} `);
    } else if (item.kind === "subagent") {
      const sub = subagents.find(s => s.id === item.value);
      if (sub) {
        setDelegatingTo(sub);
        setInput("");
      }
    } else if (item.kind === "search" && item.hit) {
      const h = item.hit;
      const base = h.path.split(/[\\/]/).pop() || h.path;
      setAttachments(prev =>
        [
          ...prev,
          {
            name: `${base}:${h.line}`,
            mime_type: "text/plain",
            content: `[代码引用：${h.path}:${h.line}]\n${h.snippet}`,
          },
        ].slice(0, 5),
      );
      const lastAt = input.lastIndexOf("@");
      setInput(input.slice(0, lastAt) + `已引用 ${base}:${h.line} `);
    } else {
      setInput(item.value + " ");
    }
    setShowPopup("none");
    textareaRef.current?.focus();
  };

  /** 构造历史上下文（仅 user/assistant 文本消息）。 */
  const buildHistory = (msgs: ChatMessage[]): HistoryMessage[] =>
    msgs
      .filter(m => m.role === "user" || m.role === "assistant")
      .filter(m => m.content && m.content !== THINKING_MESSAGE)
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  /** 发送核心：添加消息 → 占位 → agentSend（带历史上下文）。 */
  const runAgentRequest = async (
    content: string,
    history: HistoryMessage[],
    atts: Attachment[],
    systemInstruction?: string,
  ) => {
    if (!activeSessionId) return;
    // 添加 user 消息到 store
    addMessage(activeSessionId, {
      id: crypto.randomUUID(),
      role: "user",
      content: atts.length ? `${content}\n\n[附件：${atts.map(a => a.name).join("、")}]` : content,
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
        system_instruction: systemInstruction,
        attachments: atts,
        history,
      });
      setAttachments([]);
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

  // G5: 接收首次引导页的示例问题并直接发送
  useEffect(() => {
    const onSendExample = (e: Event) => {
      const question = (e as CustomEvent<string>).detail;
      if (!question || typeof question !== "string" || !question.trim()) return;
      void runAgentRequest(question.trim(), buildHistory(sessionMessages), [], undefined);
    };
    window.addEventListener("wth:send-example", onSendExample);
    return () => window.removeEventListener("wth:send-example", onSendExample);
  }, [activeSessionId, sessionMessages, runAgentRequest]);

  /** 快捷选项回复：交互式任务的可点选项直接作为用户消息发送。 */
  const sendQuickReply = async (text: string) => {
    if (!activeSessionId || isStreaming || !text.trim()) return;
    await runAgentRequest(text.trim(), buildHistory(sessionMessages), [], undefined);
  };

  const handleSend = async () => {
    if (!activeSessionId) return;
    let content = input.trim();
    if (!content || isStreaming) return;

    // 子智能体委派模式：后台子会话执行，主会话仅插入委派记录
    if (delegatingTo) {
      addMessage(activeSessionId, {
        id: crypto.randomUUID(),
        role: "user",
        content: `[委派给 ${delegatingTo.name}] ${content}`,
        timestamp: new Date().toISOString(),
      });
      try {
        await subagentRun(delegatingTo.id, content, activeSessionId);
        addMessage(activeSessionId, {
          id: crypto.randomUUID(),
          role: "system",
          content: `已委派给「${delegatingTo.name}」（子会话，任务：${content}）`,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        addMessage(activeSessionId, {
          id: crypto.randomUUID(),
          role: "system",
          content: `委派失败：${err}`,
          timestamp: new Date().toISOString(),
        });
      }
      setDelegatingTo(null);
      setInput("");
      return;
    }

    // 技能斜杠命令：加载 SKILL.md 作为本次会话系统指令注入
    let systemInstruction: string | undefined;
    if (content.startsWith("/")) {
      const parts = content.slice(1).split(/\s+/);
      const cmdName = parts[0];
      const skillMatch = slashCommands.find(c => c.name === cmdName && c.source === "skill");
      if (skillMatch) {
        try {
          const skillContent = await resolveSkill(cmdName);
          const args = parts.slice(1).join(" ");
          systemInstruction = `[技能: ${cmdName}]\n请严格遵循以下 SKILL.md 指令完成用户任务：\n\n${skillContent}`;
          content = args || `请使用技能 ${cmdName}`;
        } catch (err) {
          // 技能加载失败：明确提示，不静默发送
          addMessage(activeSessionId, {
            id: crypto.randomUUID(),
            role: "system",
            content: `技能「${cmdName}」加载失败：${err}`,
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }
    }

    const history = buildHistory(sessionMessages);
    await runAgentRequest(content, history, attachments, systemInstruction);
  };

  /** 重新生成：截断该条及之后，重放其前一条用户消息（含历史上下文）。 */
  const regenerateFrom = async (target: ChatMessage) => {
    if (!activeSessionId || isStreaming) return;
    const msgs = sessionMessages;
    const idx = msgs.findIndex(m => m.id === target.id);
    if (idx <= 0) return;
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) return;
    const userMsg = msgs[userIdx];
    const history = buildHistory(msgs.slice(0, userIdx));
    truncateMessages(activeSessionId, target.id);
    await runAgentRequest(userMsg.content, history, []);
  };

  /** 从此处分支：以该条之前的上下文为新会话前缀（U-01）。 */
  const forkFrom = async (target: ChatMessage) => {
    if (!activeSessionId) return;
    const msgs = sessionMessages;
    const idx = msgs.findIndex(m => m.id === target.id);
    const prefix = idx >= 0 ? msgs.slice(0, idx) : msgs;
    try {
      // 源会话标题继承，便于在侧栏识别分支来源
      const sourceTitle =
        useChatStore.getState().sessions.find(s => s.id === activeSessionId)?.title ?? "会话";
      const session = await sessionCreate(`${sourceTitle}（分支）`, "");
      setMessages(
        session.id,
        prefix.map(m => ({ ...m })),
      );
      // U-01 修复：立即持久化分支消息——此前仅写内存，重启后分支内容丢失
      if (prefix.length > 0) {
        await sessionSaveMessages(session.id, prefix).catch(() => {});
      }
      upsertSession(session);
      setActiveSession(session.id);
    } catch (err) {
      addMessage(activeSessionId, {
        id: crypto.randomUUID(),
        role: "system",
        content: `创建分支会话失败：${err}`,
        timestamp: new Date().toISOString(),
      });
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
  handleAbortRef.current = handleAbort;

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Popup navigation
    if (showPopup !== "none" && popupItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopupIndex(i => Math.min(i + 1, popupItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopupIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectPopupItem(popupItems[popupIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowPopup("none");
        return;
      }
    }
    // Enter 发送 / Shift+Enter 换行
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 空状态 — 氛围光晕 + 品牌 banner + 问候 + 示例问题快捷入口
  if (!activeSessionId) {
    const startWithExample = (question: string) => {
      onNewSession?.();
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("wth:send-example", { detail: question }));
      }, 400);
    };
    const suggestions = [
      "分析当前项目的整体架构，给出改进建议",
      "帮我把这个模块重构得更容易测试",
      "为最近改动的代码补齐单元测试",
      "解读一段报错堆栈，定位根本原因",
    ];
    return (
      <div
        className="relative h-full w-full flex flex-col items-center justify-center select-none overflow-hidden"
        style={{ color: "var(--text-primary)" }}
      >
        <img
          src={wthBanner}
          alt="Wide Thought Host"
          className="relative max-w-xs w-2/3 h-auto object-contain mb-5 theme-logo anim-fade-up"
          style={{ animationDelay: "0ms" }}
        />

        <p
          className="relative text-[15px] font-medium mb-1 anim-fade-up"
          style={{ color: "var(--text-primary)", animationDelay: "60ms" }}
        >
          你今天想做点什么？
        </p>
        <p
          className="relative text-[12.5px] mb-8 anim-fade-up"
          style={{ color: "var(--text-muted)", animationDelay: "120ms" }}
        >
          你的 AI 编码代理 — 提问、委派任务、编排工作流
        </p>

        {/* 居中输入提示 + 按钮 */}
        <div
          className="relative w-full max-w-md px-6 anim-fade-up"
          style={{ animationDelay: "180ms" }}
        >
          <button
            type="button"
            onClick={onNewSession}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl press
              transition-all duration-200"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--surface-3)",
            }}
          >
            <span
              className="w-6 h-6 rounded-md flex items-center justify-center"
              style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              <Brain size={12} />
            </span>
            <span className="text-sm flex-1 text-left" style={{ color: "var(--text-muted)" }}>
              你今天想做什么？
            </span>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
              style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
            >
              Enter
            </span>
          </button>
        </div>

        {/* 示例问题快捷入口 */}
        <div
          className="relative flex flex-wrap items-center justify-center gap-1.5 mt-4 px-6 max-w-xl anim-fade-up"
          style={{ animationDelay: "240ms" }}
        >
          {suggestions.map(s => (
            <button
              type="button"
              key={s}
              onClick={() => startWithExample(s)}
              className="px-3 py-1.5 rounded-lg text-[11.5px] transition-colors duration-150 press"
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--surface-3)",
                color: "var(--text-muted)",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "var(--surface-4)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "var(--surface-3)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* 推荐操作 */}
        <div
          className="flex items-center gap-2 mt-6 text-[11px] anim-fade-up"
          style={{ color: "var(--text-dim)", animationDelay: "300ms" }}
        >
          <span>支持</span>
          <span className="px-1.5 py-0.5 rounded-md" style={{ background: "var(--surface-2)" }}>
            GPT-4.1
          </span>
          <span className="px-1.5 py-0.5 rounded-md" style={{ background: "var(--surface-2)" }}>
            Claude 4
          </span>
          <span className="px-1.5 py-0.5 rounded-md" style={{ background: "var(--surface-2)" }}>
            DeepSeek
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* 会话头部：标题 + 会话操作（清空 / 导出 / 执行面板） */}
      <div
        className="flex items-center gap-1 px-4 py-2 flex-shrink-0 border-b"
        style={{ borderColor: "var(--surface-3)" }}
      >
        <span
          className="flex-1 min-w-0 text-[12.5px] font-medium truncate"
          style={{ color: "var(--text-primary)" }}
        >
          {sessionTitle || "新会话"}
        </span>
        {activeSessionId && (
          <>
            <button
              type="button"
              className="chat-head-btn"
              title="清空当前会话"
              onClick={onClearSession}
            >
              <Eraser size={13} />
            </button>
            <button
              type="button"
              className="chat-head-btn"
              title="导出会话（Markdown）"
              onClick={() => onExportSession?.(activeSessionId, "markdown")}
            >
              <Download size={13} />
            </button>
            <button
              type="button"
              className="chat-head-btn"
              title="打开执行面板（Ctrl+Shift+I）"
              onClick={() => useUiStore.getState().setInspectorOpen(true)}
            >
              <PanelRightOpen size={13} />
            </button>
          </>
        )}
      </div>

      {/* 消息流 — 限宽居中的阅读列（参照主流 AI 客户端的排版宽度） */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
        <div className="w-full max-w-3xl mx-auto">
          {sessionMessages.length === 0 ? (
            <div
              className="h-full flex flex-col items-center justify-center gap-2 select-none"
              style={{ color: "var(--text-dim)" }}
            >
              <MessageSquareDashed size={20} className="opacity-40" />
              <p className="text-[12px]">输入消息开始对话 · @ 提及文件 · / 调用指令</p>
            </div>
          ) : (
            sessionMessages.map((msg, idx) => {
              const isLast = idx === sessionMessages.length - 1;
              // 仅最新一条未续答的助手消息展示可点选项；后续已有用户回复则不再展示
              const hasNextUserReply = sessionMessages.slice(idx + 1).some(m => m.role === "user");
              const quickReplyProps =
                msg.role === "assistant" && !hasNextUserReply
                  ? { onQuickReply: sendQuickReply, quickReplyDisabled: isStreaming }
                  : {};
              return (
                <div
                  key={msg.id}
                  data-message-index={idx}
                  className="rounded-xl transition-colors duration-500"
                  style={highlightIndex === idx ? { background: "var(--surface-2)" } : undefined}
                >
                  <MessageBubble
                    msg={msg}
                    onContextMenu={e => {
                      e.preventDefault();
                      setMsgMenu({
                        point: contextMenuPointFromEvent(e),
                        content: msg.content || "",
                        role: msg.role,
                        id: msg.id,
                      });
                    }}
                    canRegenerate={
                      msg.role === "assistant" && msg.content !== THINKING_MESSAGE && !isStreaming
                    }
                    onRegenerate={() => void regenerateFrom(msg)}
                    live={isLast && isStreaming}
                    {...quickReplyProps}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="px-6 py-4" style={{ background: "var(--bg-body)" }}>
        <div className="max-w-2xl mx-auto relative">
          {/* @提及 / /指令 弹出层 */}
          {showPopup !== "none" && popupItems.length > 0 && (
            <div className="glass-panel absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden z-20">
              <div
                className="px-3 py-1.5 text-[10px] font-medium"
                style={{ color: "var(--text-dim)" }}
              >
                {showPopup === "file" ? "选择文件 / 委派子智能体" : "快捷指令"}
              </div>
              <div className="max-h-40 overflow-y-auto pb-1">
                {popupItems.map((item, idx) => (
                  <button
                    type="button"
                    key={item.value + item.kind}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                    style={{
                      background: idx === popupIndex ? "var(--surface-2)" : "transparent",
                      color: "var(--text-primary)",
                    }}
                    onClick={() => selectPopupItem(item)}
                    onMouseEnter={() => setPopupIndex(idx)}
                  >
                    {item.kind === "file" ? (
                      <FileText size={12} style={{ color: "var(--text-muted)" }} />
                    ) : item.kind === "subagent" ? (
                      <Bot size={12} style={{ color: "var(--text-dim)" }} />
                    ) : item.kind === "search" ? (
                      <Search size={12} style={{ color: "var(--accent-green)" }} />
                    ) : (
                      <Slash size={12} style={{ color: "var(--accent-blue)" }} />
                    )}
                    <span className="truncate">{item.label}</span>
                    {item.kind === "subagent" && (
                      <span
                        className="ml-auto shrink-0 text-[10px] rounded px-1.5 py-0.5"
                        style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
                      >
                        子智能体
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {delegatingTo && (
            <div
              className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs anim-fade-up"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-primary)",
                border: "1px solid var(--surface-3)",
              }}
            >
              <Bot size={13} style={{ color: "var(--text-muted)" }} />
              <span className="truncate">正在委派给「{delegatingTo.name}」— 输入任务后发送</span>
              <button
                type="button"
                className="ml-auto flex items-center gap-1 text-[10px] rounded-md px-2 py-1 hover:bg-[color:var(--surface-3)]"
                style={{ color: "var(--text-dim)" }}
                onClick={() => setDelegatingTo(null)}
              >
                <X size={11} /> 取消委派
              </button>
            </div>
          )}

          <WorkflowModal
            open={showWorkflow}
            onClose={() => setShowWorkflow(false)}
            onNotice={msg => window.dispatchEvent(new CustomEvent("wth:toast", { detail: msg }))}
          />
          {showParallel && (
            <div
              className="mb-2 rounded-xl border p-3 space-y-2"
              style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}
            >
              <div
                className="flex items-center gap-2 text-xs font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                <Users size={13} style={{ color: "var(--text-muted)" }} />
                并行委派多智能体
              </div>
              <textarea
                className="w-full rounded-lg border px-3 py-2 text-xs resize-none"
                style={{
                  borderColor: "var(--surface-3)",
                  background: "var(--surface-0)",
                  color: "var(--text-primary)",
                }}
                placeholder="输入任务，将同时交给所选子智能体执行…"
                rows={2}
                value={parallelTask}
                onChange={e => setParallelTask(e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {subagents
                  .filter(s => s.enabled)
                  .map(s => {
                    const active = parallelSelection.has(s.id);
                    return (
                      <button
                        type="button"
                        key={s.id}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] transition-colors whitespace-nowrap"
                        style={{
                          background: active ? "var(--text-primary)" : "var(--surface-2)",
                          color: active ? "var(--bg-body)" : "var(--text-primary)",
                          border: `1px solid ${active ? "var(--text-primary)" : "var(--surface-3)"}`,
                        }}
                        onClick={() =>
                          setParallelSelection(prev => {
                            const next = new Set(prev);
                            if (next.has(s.id)) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          })
                        }
                      >
                        {s.name}
                      </button>
                    );
                  })}
                {subagents.filter(s => s.enabled).length === 0 && (
                  <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                    没有已启用的子智能体，请先在设置中启用。
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="small-btn font-semibold"
                  disabled={!parallelTask.trim() || parallelSelection.size === 0}
                  onClick={() => void runParallel()}
                >
                  并行运行（{parallelSelection.size}）
                </button>
                <button type="button" className="small-btn" onClick={() => setShowParallel(false)}>
                  取消
                </button>
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a, idx) => (
                <span
                  key={a.name + idx}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] anim-scale-in"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--surface-3)",
                    color: "var(--text-primary)",
                  }}
                >
                  <Paperclip size={10} style={{ color: "var(--text-muted)" }} />
                  <span className="max-w-[160px] truncate">{a.name}</span>
                  {a.data_url ? (
                    <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                      图片
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="hover:opacity-70"
                    title="移除附件"
                    onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            className="composer flex items-center gap-1.5 pl-3 pr-2 py-2"
            onDragOver={e => e.preventDefault()}
            onDrop={handleDropFiles}
          >
            <button
              type="button"
              onClick={() => setShowWorkflow(true)}
              title="多 Agent 工作流编排"
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
                transition-colors hover:bg-[color:var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <GitBranch size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowParallel(v => !v)}
              title="并行委派多智能体"
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
                transition-colors hover:bg-[color:var(--surface-2)]"
              style={{
                color: showParallel ? "var(--text-primary)" : "var(--text-muted)",
                background: showParallel ? "var(--surface-2)" : "transparent",
              }}
            >
              <Users size={14} />
            </button>
            <button
              type="button"
              onClick={handlePickAttachments}
              title="添加附件（图片 / 文本）"
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
                transition-colors hover:bg-[color:var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <Paperclip size={14} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTemplateMenu(v => !v)}
                title="插入提示词模板"
                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
                  transition-colors hover:bg-[color:var(--surface-2)]"
                style={{
                  color: showTemplateMenu ? "var(--text-primary)" : "var(--text-muted)",
                  background: showTemplateMenu ? "var(--surface-2)" : "transparent",
                }}
              >
                <BookOpen size={14} />
              </button>
              {showTemplateMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTemplateMenu(false)} />
                  <div className="glass-panel absolute bottom-full left-0 mb-2 w-72 rounded-xl overflow-hidden z-20">
                    <div
                      className="px-3 py-1.5 text-[10.5px] font-medium flex items-center justify-between"
                      style={{ color: "var(--text-dim)" }}
                    >
                      <span>提示词模板</span>
                      <span className="font-normal">
                        支持 {"{{workspace}}"} / {"{{file}}"} / {"{{language}}"} 变量
                      </span>
                    </div>
                    <div className="max-h-56 overflow-y-auto pb-1">
                      {templates.length === 0 ? (
                        <div
                          className="px-3 py-2 text-[11.5px]"
                          style={{ color: "var(--text-dim)" }}
                        >
                          暂无模板，可在 设置 → 通用 中管理
                        </div>
                      ) : (
                        templates.map(tpl => (
                          <button
                            type="button"
                            key={tpl.id}
                            className="w-full flex items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--surface-2)]"
                            onClick={() => {
                              const content = tpl.content
                                .replaceAll("{{workspace}}", workspaceName || "当前工作区")
                                .replaceAll("{{file}}", "待分析的代码/文件")
                                .replaceAll("{{language}}", "编程语言");
                              setInput(content);
                              setShowTemplateMenu(false);
                              textareaRef.current?.focus();
                            }}
                          >
                            <BookOpen
                              size={12}
                              style={{ color: "var(--text-dim)", marginTop: 2 }}
                            />
                            <span>
                              <span
                                className="block text-xs"
                                style={{ color: "var(--text-primary)" }}
                              >
                                {tpl.name}
                              </span>
                              <span
                                className="block text-[10.5px] mt-0.5"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {tpl.description}
                              </span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={
                isStreaming
                  ? "正在生成…"
                  : delegatingTo
                    ? `委派给 ${delegatingTo.name}：输入任务…`
                    : "输入消息… @ 提及文件 / 指令"
              }
              rows={1}
              className="flex-1 resize-none bg-transparent border-none px-1.5 py-1.5 text-[13.5px] leading-relaxed
                placeholder:text-[13px] focus:outline-none
                disabled:opacity-50 font-sans"
              style={{ color: "var(--text-primary)" }}
            />
            {isStreaming ? (
              <div className="flex items-center gap-2 self-center">
                {currentPhase && (
                  <span
                    className="text-[11px] whitespace-nowrap"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {currentPhase === "working"
                      ? "思考中…"
                      : currentPhase === "checking"
                        ? "执行工具…"
                        : currentPhase === "verifying"
                          ? "验证中…"
                          : currentPhase}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleAbort}
                  title="中止"
                  className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center
                    transition-opacity duration-150 hover:opacity-90"
                  style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
                >
                  <Square size={11} fill="currentColor" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                title="发送"
                className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center self-center
                  transition-opacity duration-150
                  disabled:opacity-25 disabled:cursor-not-allowed"
                style={{ background: "var(--accent-primary)", color: "var(--bg-body)" }}
              >
                <Send size={14} />
              </button>
            )}
          </div>
          <div className="text-center text-[10.5px] mt-2" style={{ color: "var(--text-dim)" }}>
            Enter 发送 · Shift+Enter 换行 · @ 提及文件/子智能体 · / 指令
          </div>
        </div>
      </div>
      <ContextMenu
        open={Boolean(msgMenu)}
        point={msgMenu?.point ?? null}
        onClose={() => setMsgMenu(null)}
        ariaLabel="消息菜单"
        items={
          msgMenu
            ? [
                {
                  key: "copy",
                  icon: <Copy size={14} />,
                  label: "复制文本",
                  shortcut: "Ctrl+C",
                  onSelect: async () => {
                    try {
                      await navigator.clipboard.writeText(msgMenu.content);
                    } catch {
                      // fallback
                    }
                    setMsgMenu(null);
                  },
                },
                {
                  key: "fork",
                  icon: <GitBranch size={14} />,
                  label: "从此处分支",
                  onSelect: () => {
                    const target = sessionMessages.find(m => m.id === msgMenu.id);
                    if (target) void forkFrom(target);
                    setMsgMenu(null);
                  },
                },
                ...(msgMenu.role === "assistant" && msgMenu.content !== THINKING_MESSAGE
                  ? [
                      {
                        key: "regenerate",
                        icon: <RotateCcw size={14} />,
                        label: "重新生成",
                        onSelect: () => {
                          const target = sessionMessages.find(m => m.id === msgMenu.id);
                          if (target) void regenerateFrom(target);
                          setMsgMenu(null);
                        },
                      },
                    ]
                  : []),
                ...(msgMenu.role === "assistant"
                  ? [
                      {
                        key: "remember",
                        icon: <Brain size={14} />,
                        label: "记住这条",
                        onSelect: async () => {
                          try {
                            const title =
                              msgMenu.content
                                .replace(/[#*`>\n]/g, " ")
                                .trim()
                                .slice(0, 24) || "记忆";
                            await memoryWrite(title, msgMenu.content);
                            addMessage(activeSessionId!, {
                              id: crypto.randomUUID(),
                              role: "system" as const,
                              content: `已保存到长期记忆：${title}`,
                              timestamp: new Date().toISOString(),
                            });
                          } catch (err) {
                            addMessage(activeSessionId!, {
                              id: crypto.randomUUID(),
                              role: "system" as const,
                              content: `保存记忆失败：${err}`,
                              timestamp: new Date().toISOString(),
                            });
                          }
                          setMsgMenu(null);
                        },
                      },
                    ]
                  : []),
              ]
            : []
        }
      />
    </div>
  );
}
