// InspectorPanel — 右侧可收起执行面板。
//
// 融合 Codex 日志面板与 QoderWork 执行视图：
// - 「日志」页签：完整工具调用日志（名称、状态、参数、结果）；
// - 「计划」页签：当前任务的执行步骤列表与并行批次进度；
// - 「上下文」页签：会话与工作区上下文摘要、Token 用量。
// 面板开合 / 页签 / 宽度由 stores/ui.ts 管理，宽度支持左缘拖拽调整。

import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  FileText,
  Layers,
  Loader2,
  PanelRightClose,
  ScrollText,
  Wrench,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ToolCall } from "@/stores/chat";
import { THINKING_MESSAGE, useChatStore } from "@/stores/chat";
import { type InspectorTab, useUiStore } from "@/stores/ui";

const TABS: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: "log", label: "日志", icon: <ScrollText size={13} /> },
  { id: "plan", label: "计划", icon: <Layers size={13} /> },
  { id: "context", label: "上下文", icon: <FileText size={13} /> },
];

interface FlatToolEntry {
  call: ToolCall;
  /** 该工具调用所属的消息序号（用于定位） */
  messageIndex: number;
}

/** 从会话消息中按序抽取全部工具调用。 */
function collectToolCalls(messageList: { tool_calls?: ToolCall[] }[]): FlatToolEntry[] {
  const entries: FlatToolEntry[] = [];
  messageList.forEach((msg, index) => {
    for (const call of msg.tool_calls || []) {
      entries.push({ call, messageIndex: index });
    }
  });
  return entries;
}

function toolStatus(call: ToolCall): "pending" | "running" | "done" | "error" {
  if (call.status === "pending") return "pending";
  if (call.status === "running") return "running";
  const resultStr = call.result !== undefined ? String(JSON.stringify(call.result)) : "";
  if (/error/i.test(resultStr)) return "error";
  if (call.result !== undefined || call.status === "done") return "done";
  return "running";
}

function StatusDot({ status }: { status: ReturnType<typeof toolStatus> }) {
  if (status === "running") {
    return <Loader2 size={13} className="animate-spin" style={{ color: "var(--accent-blue)" }} />;
  }
  if (status === "pending") {
    return <Clock size={13} style={{ color: "var(--accent-orange)" }} />;
  }
  if (status === "error") {
    return <XCircle size={13} style={{ color: "var(--accent-red)" }} />;
  }
  return <CheckCircle2 size={13} style={{ color: "var(--accent-green)" }} />;
}

const STATUS_TEXT: Record<ReturnType<typeof toolStatus>, string> = {
  pending: "等待确认",
  running: "执行中",
  done: "已完成",
  error: "失败",
};

/** 单条工具调用日志行（可展开参数 / 结果）。 */
function LogRow({ entry }: { entry: FlatToolEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { call } = entry;
  const status = toolStatus(call);
  const argStr = useMemo(() => JSON.stringify(call.arguments, null, 2), [call.arguments]);
  const resultStr = useMemo(
    () => (call.result !== undefined ? JSON.stringify(call.result, null, 2) : null),
    [call.result],
  );

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-[color:var(--surface-2)] transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? (
          <ChevronDown size={12} style={{ color: "var(--text-dim)" }} />
        ) : (
          <ChevronRight size={12} style={{ color: "var(--text-dim)" }} />
        )}
        <Wrench size={12} style={{ color: "var(--text-dim)" }} className="flex-shrink-0" />
        <span
          className="flex-1 min-w-0 font-mono text-[11.5px] truncate"
          style={{ color: "var(--text-primary)" }}
        >
          {call.name}
        </span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <StatusDot status={status} />
          <span className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
            {STATUS_TEXT[status]}
          </span>
        </span>
      </button>
      {expanded && (
        <div
          className="px-2.5 pb-2.5 space-y-2 border-t"
          style={{ borderColor: "var(--surface-3)" }}
        >
          <div className="pt-2">
            <div className="text-[10.5px] mb-1" style={{ color: "var(--text-dim)" }}>
              参数
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto rounded-md p-2"
              style={{ background: "var(--surface-1)", color: "var(--text-muted)" }}
            >
              {argStr || "（无）"}
            </pre>
          </div>
          {resultStr !== null && (
            <div>
              <div className="text-[10.5px] mb-1" style={{ color: "var(--text-dim)" }}>
                结果
              </div>
              <pre
                className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto rounded-md p-2"
                style={{ background: "var(--surface-1)", color: "var(--text-muted)" }}
              >
                {resultStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface InspectorPanelProps {
  workspaceLabel: string;
  workspaceBranch: string | null;
}

export function InspectorPanel({ workspaceLabel, workspaceBranch }: InspectorPanelProps) {
  const tab = useUiStore(s => s.inspectorTab);
  const setTab = useUiStore(s => s.setInspectorTab);
  const close = useUiStore(s => s.toggleInspector);

  const activeSessionId = useChatStore(s => s.activeSessionId);
  const sessions = useChatStore(s => s.sessions);
  const messages = useChatStore(s => s.messages);
  const streaming = useChatStore(s => s.streaming);
  const usage = useChatStore(s => s.usage);
  const parallel = useChatStore(s => s.parallel);

  const sessionMessages = activeSessionId ? messages[activeSessionId] || [] : [];
  const entries = useMemo(() => collectToolCalls(sessionMessages), [sessionMessages]);
  const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null;
  const isStreaming = activeSessionId ? streaming[activeSessionId] || false : false;
  const sessionUsage = activeSessionId ? usage[activeSessionId] : undefined;
  const batch = activeSessionId ? parallel[activeSessionId] : undefined;

  const runningCount = entries.filter(e => toolStatus(e.call) === "running").length;
  const doneCount = entries.filter(e => toolStatus(e.call) === "done").length;

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--surface-1)" }}>
      {/* 面板头：页签 + 关闭 */}
      <div
        className="flex items-center gap-1 px-2.5 pt-2.5 pb-2 flex-shrink-0 border-b"
        style={{ borderColor: "var(--surface-3)" }}
      >
        <span
          className="flex items-center gap-1.5 text-[12.5px] font-semibold px-1 whitespace-nowrap flex-shrink-0"
          style={{ color: "var(--text-primary)" }}
        >
          <Activity
            size={13}
            style={{ color: isStreaming ? "var(--accent-green)" : "var(--text-dim)" }}
            className="flex-shrink-0"
          />
          执行面板
        </span>
        <span className="flex-1 min-w-0" />
        <nav
          className="flex items-center rounded-lg p-0.5 flex-shrink-0"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-3)" }}
        >
          {TABS.map(t => (
            <button
              type="button"
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] transition-colors whitespace-nowrap flex-shrink-0"
              style={{
                background: tab === t.id ? "var(--surface-0)" : "transparent",
                color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
                boxShadow: tab === t.id ? "var(--shadow-xs)" : "none",
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={close}
          className="title-bar-btn ml-0.5 flex-shrink-0"
          title="收起面板"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* 内容区：独立滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-3">
        {!activeSessionId ? (
          <div
            className="h-full flex flex-col items-center justify-center text-center px-4"
            style={{ color: "var(--text-dim)" }}
          >
            <ScrollText size={20} className="mb-2 opacity-30" />
            <p className="text-[11.5px]">暂无活动会话</p>
          </div>
        ) : tab === "log" ? (
          entries.length === 0 ? (
            <div
              className="h-full flex flex-col items-center justify-center text-center px-4"
              style={{ color: "var(--text-dim)" }}
            >
              <Wrench size={20} className="mb-2 opacity-30" />
              <p className="text-[11.5px]">还没有工具调用记录</p>
              <p className="text-[10.5px] mt-1 opacity-70">Agent 执行工具时会在此展示完整日志</p>
            </div>
          ) : (
            <div className="space-y-1.5 animate-fade-in">
              <div className="flex items-center gap-2 panel-section-head">
                <span>调用日志</span>
                <span
                  className="panel-badge"
                  data-tone={doneCount === entries.length && entries.length > 0 ? "ok" : undefined}
                >
                  {doneCount}/{entries.length}
                </span>
                {runningCount > 0 && <span className="panel-badge">{runningCount} 执行中</span>}
              </div>
              {entries.map(entry => (
                <LogRow key={entry.call.id} entry={entry} />
              ))}
            </div>
          )
        ) : tab === "plan" ? (
          <div className="space-y-2 animate-fade-in">
            {/* 当前轮次状态 */}
            <div
              className="rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}
            >
              <div
                className="flex items-center gap-2 text-[12px] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {isStreaming ? (
                  <Loader2
                    size={13}
                    className="animate-spin"
                    style={{ color: "var(--text-muted)" }}
                  />
                ) : (
                  <CheckCircle2 size={13} style={{ color: "var(--accent-green)" }} />
                )}
                {isStreaming ? "任务执行中" : "当前空闲"}
              </div>
              <p
                className="text-[11px] mt-1.5 leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                {isStreaming
                  ? "Agent 正在处理请求，可在输入区点击停止按钮随时中断。"
                  : "等待新的指令。执行多步骤任务时，此处会展示步骤进度。"}
              </p>
            </div>

            {/* 步骤时间线（按工具调用顺序） */}
            {entries.length > 0 && (
              <div
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    执行步骤
                  </span>
                  <span
                    className="panel-badge"
                    data-tone={doneCount === entries.length ? "ok" : undefined}
                  >
                    {doneCount}/{entries.length}
                  </span>
                </div>
                <ol className="space-y-1.5">
                  {entries.slice(-12).map((entry, idx) => {
                    const status = toolStatus(entry.call);
                    return (
                      <li
                        key={entry.call.id}
                        className="flex items-center gap-2 text-[11.5px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {status === "done" ? (
                          <CheckCircle2
                            size={12}
                            style={{ color: "var(--accent-green)" }}
                            className="flex-shrink-0"
                          />
                        ) : status === "error" ? (
                          <XCircle
                            size={12}
                            style={{ color: "var(--accent-red)" }}
                            className="flex-shrink-0"
                          />
                        ) : status === "running" ? (
                          <Loader2
                            size={12}
                            className="animate-spin flex-shrink-0"
                            style={{ color: "var(--text-muted)" }}
                          />
                        ) : (
                          <Circle
                            size={12}
                            style={{ color: "var(--text-dim)" }}
                            className="flex-shrink-0"
                          />
                        )}
                        <span className="font-mono truncate">
                          {idx + 1}. {entry.call.name}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {/* 并行批次进度 */}
            {batch && (
              <div
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    并行委派批次
                  </span>
                  <span
                    className="panel-badge"
                    data-tone={batch.done >= batch.total ? "ok" : undefined}
                  >
                    {batch.done}/{batch.total}
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 text-[12px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {batch.done < batch.total && (
                    <Loader2
                      size={12}
                      className="animate-spin"
                      style={{ color: "var(--text-muted)" }}
                    />
                  )}
                  {batch.done >= batch.total ? "全部完成" : "进行中"}
                </div>
                <div
                  className="text-[11px] mt-1 leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  {batch.names.join("、")}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* 上下文页签 */
          <div className="space-y-2 animate-fade-in">
            <ContextCard label="会话">
              <Row k="标题" v={activeSession?.title || "未命名会话"} />
              <Row k="模型" v={activeSession?.model || "默认模型"} />
              <Row
                k="消息数"
                v={String(sessionMessages.filter(m => m.content !== THINKING_MESSAGE).length)}
              />
              <Row k="Token" v={sessionUsage ? sessionUsage.total_tokens.toLocaleString() : "0"} />
            </ContextCard>
            <ContextCard label="工作区">
              <Row k="路径" v={workspaceLabel} />
              {workspaceBranch && <Row k="分支" v={workspaceBranch} />}
            </ContextCard>
          </div>
        )}
      </div>
    </div>
  );
}

function ContextCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border px-3 py-2.5"
      style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}
    >
      <div className="panel-section-head !pt-0 !pb-2 !px-0">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-2 text-[11.5px]">
      <span className="w-12 flex-shrink-0" style={{ color: "var(--text-dim)" }}>
        {k}
      </span>
      <span className="min-w-0 break-all" style={{ color: "var(--text-primary)" }}>
        {v}
      </span>
    </div>
  );
}
