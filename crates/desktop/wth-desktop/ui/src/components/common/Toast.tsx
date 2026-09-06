// Toast — 轻量通知（命令式 API + 全局宿主）。
//
// 替代 window.alert（Tauri WebView2 上原生 alert 体验差且可能被抑制），
// 同时接管此前无人监听的 `wth:toast` CustomEvent（WorkflowModal 的通知
// 一直在静默丢失）。用法：toast("已保存", "success")；根部挂载 <ToastHost />。

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createPortal } from "react-dom";

export type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

let seq = 0;
const listeners = new Set<(list: ToastItem[]) => void>();
let items: ToastItem[] = [];

function notify() {
  listeners.forEach((l) => l([...items]));
}

function push(message: string, kind: ToastKind) {
  const id = ++seq;
  items = [...items, { id, message, kind }];
  notify();
  window.setTimeout(() => dismiss(id), 3600);
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  notify();
}

export function toast(message: string, kind: ToastKind = "info") {
  push(message, kind);
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setList);
    // 兼容既有 wth:toast 派发点（detail 可能是字符串）
    const onLegacy = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (typeof detail === "string") push(detail, "info");
      else if (detail && typeof detail === "object") {
        const d = detail as { message?: unknown; kind?: ToastKind };
        if (typeof d.message === "string") push(d.message, d.kind ?? "info");
      }
    };
    window.addEventListener("wth:toast", onLegacy);
    return () => {
      listeners.delete(setList);
      window.removeEventListener("wth:toast", onLegacy);
    };
  }, []);

  if (list.length === 0) return null;

  const icon = (kind: ToastKind) =>
    kind === "success" ? (
      <CheckCircle2 size={14} style={{ color: "var(--accent-green)" }} />
    ) : kind === "error" ? (
      <AlertCircle size={14} style={{ color: "var(--accent-red)" }} />
    ) : (
      <Info size={14} style={{ color: "var(--accent-brand)" }} />
    );

  return createPortal(
    <div className="fixed top-12 right-4 z-[210] flex flex-col gap-2 w-[320px] max-w-[80vw]">
      {list.map((item) => (
        <div
          key={item.id}
          className="glass-panel rounded-xl px-3.5 py-2.5 flex items-start gap-2.5"
          role="status"
        >
          <span className="flex-shrink-0 mt-0.5">{icon(item.kind)}</span>
          <span className="flex-1 text-[12px] leading-relaxed break-words" style={{ color: "var(--text-primary)" }}>
            {item.message}
          </span>
          <button
            className="flex-shrink-0 rounded-md p-0.5 transition-colors hover:bg-[color:var(--surface-3)]"
            style={{ color: "var(--text-dim)" }}
            title="关闭"
            onClick={() => dismiss(item.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
