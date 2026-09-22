import { GitBranch, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  onWorkflowDone,
  onWorkflowProgress,
  type WorkflowConfig,
  type WorkflowDoneEvent,
  type WorkflowProgressEvent,
  type WorkflowRunResult,
  workflowList,
  workflowRun,
} from "@/lib/ipc";

interface Props {
  open: boolean;
  onClose: () => void;
  onNotice: (msg: string) => void;
}

/** G7: 多 Agent 工作流面板 — 选择工作流、输入任务、实时进度与结果汇总。 */
export function WorkflowModal({ open, onClose, onNotice }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<WorkflowProgressEvent[]>([]);
  const [results, setResults] = useState<WorkflowRunResult[] | null>(null);
  const [lastStatus, setLastStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    workflowList()
      .then(list => {
        setWorkflows(list);
        if (list.length > 0) setSelectedId(cur => cur || list[0].id);
      })
      .catch(() => {});
    setProgress([]);
    setResults(null);
    setRunning(false);
    setLastStatus("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const offProgress = onWorkflowProgress(evt => {
      setProgress(prev => [...prev.filter(p => p.node_id !== evt.node_id), evt]);
    });
    const offDone = onWorkflowDone(evt => {
      setRunning(false);
      setResults(evt.results);
      setLastStatus(evt.status);
      onNotice(
        `工作流「${evt.config_name}」完成：${evt.results.filter(r => r.status === "done").length}/${evt.results.length} 成功`,
      );
    });
    return () => {
      offProgress.then(fn => fn());
      offDone.then(fn => fn());
    };
  }, [open, onNotice]);

  if (!open) return null;

  const selected = workflows.find(w => w.id === selectedId) || null;
  const runningNodes = progress.filter(p => p.status === "running").length;

  const run = async () => {
    if (!selectedId || !input.trim() || running) return;
    setRunning(true);
    setResults(null);
    setProgress([]);
    try {
      await workflowRun(selectedId, input.trim());
    } catch (e) {
      setRunning(false);
      onNotice(`运行失败：${e}`);
    }
  };

  return (
    <div className="modal-mask z-[150] p-6" onClick={onClose}>
      <div
        className="modal-card w-full max-w-lg rounded-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              多 Agent 工作流
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={15} />
          </button>
        </div>

        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          按依赖关系编排多个子智能体并行执行，支持 {"{{input}}"} 与 {"{{prev_output:节点ID}}"}{" "}
          变量。
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] block mb-1" style={{ color: "var(--text-dim)" }}>
              工作流
            </label>
            <select
              className="control w-full"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              disabled={running}
            >
              {workflows.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}（{w.nodes.length} 个节点）
                </option>
              ))}
            </select>
            {selected?.description && (
              <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                {selected.description}
              </div>
            )}
            {selected && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selected.nodes.map(n => (
                  <span
                    key={n.id}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
                    title={`依赖：${n.depends_on.join(", ") || "无"}`}
                  >
                    {n.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] block mb-1" style={{ color: "var(--text-dim)" }}>
              任务输入
            </label>
            <textarea
              className="control w-full font-mono text-[12px] resize-y"
              rows={3}
              placeholder="描述本次工作流任务，如：请审查 src/auth 模块的登录逻辑…"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={running}
            />
          </div>

          <button
            type="button"
            className="primary-btn w-full"
            disabled={running || !input.trim()}
            onClick={() => void run()}
          >
            {running ? (
              <span className="inline-flex items-center gap-2">
                运行中…（{runningNodes} 个节点执行中）
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Play size={13} />
                运行工作流
              </span>
            )}
          </button>
        </div>

        {/* 进度 */}
        {progress.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {progress.map(p => (
              <div key={p.node_id} className="flex items-center gap-2 text-[11px]">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background:
                      p.status === "done"
                        ? "var(--accent-green)"
                        : p.status === "error"
                          ? "var(--accent-red)"
                          : "var(--text-muted)",
                  }}
                />
                <span className="truncate min-w-0" style={{ color: "var(--text-primary)" }}>
                  {p.node_name}
                </span>
                <span
                  className="whitespace-nowrap flex-shrink-0"
                  style={{ color: "var(--text-muted)" }}
                >
                  {p.status === "done"
                    ? "已完成"
                    : p.status === "error"
                      ? `失败：${p.error}`
                      : "执行中…"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 结果 */}
        {results && (
          <div className="mt-4">
            <div
              className="text-[11px] font-medium mb-1.5"
              style={{ color: "var(--text-primary)" }}
            >
              执行结果（{lastStatus === "done" ? "完成" : "部分失败"}）
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {results.map(r => (
                <div
                  key={r.node_id}
                  className="rounded-lg p-2.5"
                  style={{ background: "var(--surface-1)" }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {r.node_name}
                    </span>
                    <span
                      className="text-[10px] px-1.5 rounded"
                      style={{
                        background:
                          r.status === "done" ? "var(--accent-green)" : "var(--accent-red)",
                        color: "#fff",
                      }}
                    >
                      {r.status === "done" ? "成功" : "失败"}
                    </span>
                  </div>
                  {r.error && (
                    <div className="text-[10px] mt-1" style={{ color: "var(--accent-red)" }}>
                      {r.error}
                    </div>
                  )}
                  {r.output && (
                    <div
                      className="text-[10px] mt-1 line-clamp-3 whitespace-pre-wrap"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {r.output}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
