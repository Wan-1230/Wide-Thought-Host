// DiffModal — Agent 修改文件的 Diff 审查模态框。
// 支持：接受（关闭，文件已写入）、撤销（写回修改前内容）、在编辑器中打开。

import { DiffEditor } from "@monaco-editor/react";
import { Check, FolderOpen, RotateCcw, X } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "@/components/common/Toast";
import { fileWrite } from "@/lib/ipc";
import { useWorkbenchStore } from "@/stores/workbench";
import "@/lib/monaco";
import { languageFromPath } from "./EditorPanel";

export function DiffModal({ theme }: { theme: "dark" | "light" }) {
  const diffModal = useWorkbenchStore(s => s.diffModal);
  const closeDiff = useWorkbenchStore(s => s.closeDiff);
  const openFile = useWorkbenchStore(s => s.openFile);
  const [busy, setBusy] = useState(false);

  const handleRevert = useCallback(async () => {
    if (!diffModal || busy) return;
    setBusy(true);
    try {
      await fileWrite(diffModal.path, diffModal.before);
      closeDiff();
      toast("已撤销修改，文件恢复为修改前的内容。", "success");
    } catch (error) {
      toast(`撤销失败：${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }, [busy, closeDiff, diffModal]);

  const handleOpen = useCallback(() => {
    if (!diffModal) return;
    openFile(
      diffModal.path,
      diffModal.path.split(/[\\/]/).pop() ?? diffModal.path,
      diffModal.after,
    );
    closeDiff();
  }, [closeDiff, diffModal, openFile]);

  if (!diffModal) return null;

  const fileName = diffModal.path.split(/[\\/]/).pop() ?? diffModal.path;

  return (
    <div className="modal-mask z-50 p-6" onClick={closeDiff}>
      <div
        className="modal-card w-[85%] h-[85%] max-w-[1200px] flex flex-col rounded-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: "var(--surface-3)", background: "var(--surface-2)" }}
        >
          <RotateCcw size={13} style={{ color: "var(--text-dim)" }} className="flex-shrink-0" />
          <span
            className="text-[12px] font-semibold truncate min-w-0"
            style={{ color: "var(--text-primary)" }}
          >
            Diff 审查：{fileName}
          </span>
          <span
            className="text-[10px] font-mono truncate min-w-0 hidden md:inline"
            style={{ color: "var(--text-dim)" }}
          >
            {diffModal.path}
          </span>
          <div className="flex-1 min-w-0" />
          <button
            type="button"
            onClick={handleOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium whitespace-nowrap flex-shrink-0"
            style={{ background: "var(--surface-3)", color: "var(--text-primary)" }}
            title="在编辑器中打开修改后的文件"
          >
            <FolderOpen size={11} />
            打开文件
          </button>
          <button
            type="button"
            onClick={handleRevert}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium disabled:opacity-40 whitespace-nowrap flex-shrink-0"
            style={{ background: "var(--accent-red)", color: "#ffffff" }}
            title="写回修改前的内容"
          >
            <RotateCcw size={11} />
            撤销更改
          </button>
          <button
            type="button"
            onClick={closeDiff}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium whitespace-nowrap flex-shrink-0"
            style={{ background: "var(--accent-primary)", color: "var(--bg-body)" }}
          >
            <Check size={11} />
            接受
          </button>
          <button
            type="button"
            onClick={closeDiff}
            className="p-1 rounded hover:bg-surface-3 flex-shrink-0"
            style={{ color: "var(--text-muted)" }}
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <DiffEditor
            original={diffModal.before}
            modified={diffModal.after}
            language={languageFromPath(diffModal.path)}
            theme={theme === "dark" ? "vs-dark" : "light"}
            options={{
              fontSize: 12,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderSideBySide: true,
              readOnly: true,
            }}
          />
        </div>
        <div
          className="px-4 py-2 text-[10px] border-t flex-shrink-0"
          style={{
            borderColor: "var(--surface-3)",
            color: "var(--text-dim)",
            background: "var(--surface-2)",
          }}
        >
          红色为删除、绿色为新增。“接受（关闭）”表示保留当前修改；如需放弃修改请点击“撤销更改”。
        </div>
      </div>
    </div>
  );
}
