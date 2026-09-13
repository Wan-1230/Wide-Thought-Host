// ConfirmDialog — 应用内确认弹窗（命令式 Promise API）。
//
// 替代 window.confirm：Tauri(wry) WebView 对 JS 原生对话框支持不完整
// （window.prompt 在 WebView2 直接返回 null，confirm 在部分平台静默返回 false），
// 导致依赖它们的删除/清空/恢复等破坏性操作"点了没反应"。
// 用法：if (!(await confirmDialog({ message: "确定删除吗？", danger: true }))) return;
// 需要在应用根部挂载一次 <ConfirmHost />。

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";

export interface ConfirmOptions {
  /** 弹窗标题（可省略，省略时仅展示 message） */
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮用红色，默认聚焦取消键防误触 */
  danger?: boolean;
}

interface PendingItem extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

let seq = 0;
let items: PendingItem[] = [];
const listeners = new Set<(list: PendingItem[]) => void>();

function notify() {
  const snapshot = [...items];
  listeners.forEach((l) => l(snapshot));
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    items = [...items, { ...opts, id: ++seq, resolve }];
    notify();
  });
}

function settle(item: PendingItem, ok: boolean) {
  items = items.filter((i) => i.id !== item.id);
  notify();
  item.resolve(ok);
}

export function ConfirmHost() {
  const [list, setList] = useState<PendingItem[]>([]);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  const current = list[list.length - 1];

  // Escape 取消；危险操作默认聚焦取消键
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(current, false);
    };
    window.addEventListener("keydown", onKey);
    if (current.danger) cancelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  if (!current) return null;

  return createPortal(
    <div className="modal-mask z-[200] p-6" onClick={() => settle(current, false)}>
      <div
        className="modal-card w-full max-w-sm rounded-xl p-5 anim-pop"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {current.danger && (
            <span
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "var(--surface-2)", color: "var(--accent-red)" }}
            >
              <AlertTriangle size={16} />
            </span>
          )}
          <div className="min-w-0">
            {current.title && (
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {current.title}
              </div>
            )}
            <div
              className="text-[12.5px] leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--text-muted)", marginTop: current.title ? 4 : 0 }}
            >
              {current.message}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={current.danger ? cancelRef : undefined} className="small-btn" onClick={() => settle(current, false)}>
            {current.cancelText || "取消"}
          </button>
          <button
            className="px-4 py-1.5 rounded-lg text-xs font-medium press"
            autoFocus={!current.danger}
            style={{
              background: current.danger ? "var(--accent-red)" : "var(--accent-primary)",
              color: current.danger ? "#ffffff" : "var(--bg-body)",
            }}
            onClick={() => settle(current, true)}
          >
            {current.confirmText || "确定"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
