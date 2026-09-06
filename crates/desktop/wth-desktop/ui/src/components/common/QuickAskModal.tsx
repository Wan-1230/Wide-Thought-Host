import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { sessionCreate } from "@/lib/ipc";

interface Props {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}

/** G6: 托盘"快速提问"弹窗 — 输入后作为新会话首条消息发送。 */
export function QuickAskModal({ open, onClose, onSent }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const send = async () => {
    const content = text.trim();
    if (!content) return;
    try {
      const session = await sessionCreate("新会话", "");
      window.dispatchEvent(
        new CustomEvent("wth:send-example", { detail: content }),
      );
      onSent();
      onClose();
      void session;
    } catch (error) {
      console.error("快速提问失败：", error);
    }
  };

  return (
    <div
      className="modal-mask z-[150] p-6"
      onClick={onClose}
    >
      <div
        className="modal-card w-full max-w-md rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            快速提问
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2" style={{ color: "var(--text-muted)" }}>
            <X size={15} />
          </button>
        </div>
        <textarea
          ref={inputRef}
          className="mt-3 w-full rounded-xl p-3 text-[13px] outline-none resize-none"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-3)",
            color: "var(--text-primary)",
          }}
          rows={3}
          placeholder="输入问题，回车发送（将在新会话中执行）"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{ color: "var(--text-muted)" }}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
            disabled={!text.trim()}
            onClick={() => void send()}
          >
            <span className="inline-flex items-center gap-1.5">
              <Send size={12} />
              发送
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}