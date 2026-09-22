// EditorPanel — 多标签代码编辑器（Monaco）。
// 文件树点击文件打开标签；支持编辑、保存、关闭；dirty 标记。

import { Editor } from "@monaco-editor/react";
import { FileCode2, Save, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import { confirmDialog } from "@/components/common/ConfirmDialog";
import { toast } from "@/components/common/Toast";
import { fileWrite } from "@/lib/ipc";
import { useWorkbenchStore } from "@/stores/workbench";
import "@/lib/monaco";

export function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rs":
      return "rust";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
      return "python";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "toml":
      return "ini";
    case "yaml":
    case "yml":
      return "yaml";
    case "css":
      return "css";
    case "html":
      return "html";
    case "sh":
    case "bash":
      return "shell";
    case "sql":
      return "sql";
    case "go":
      return "go";
    case "java":
      return "java";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "hpp":
    case "cc":
    case "cxx":
      return "cpp";
    default:
      return "plaintext";
  }
}

export function EditorPanel({ theme }: { theme: "dark" | "light" }) {
  const openFiles = useWorkbenchStore(s => s.openFiles);
  const activeFile = useWorkbenchStore(s => s.activeFile);
  const setActiveFile = useWorkbenchStore(s => s.setActiveFile);
  const closeFile = useWorkbenchStore(s => s.closeFile);
  const closeEditor = useWorkbenchStore(s => s.closeEditor);
  const updateFileContent = useWorkbenchStore(s => s.updateFileContent);
  const markSaved = useWorkbenchStore(s => s.markSaved);

  const active = useMemo(
    () => openFiles.find(f => f.path === activeFile) ?? null,
    [openFiles, activeFile],
  );

  const handleSave = useCallback(async () => {
    if (!active) return;
    try {
      await fileWrite(active.path, active.content);
      markSaved(active.path, active.content);
    } catch (error) {
      toast(`保存失败：${String(error)}`, "error");
    }
  }, [active, markSaved]);

  const handleCloseFile = useCallback(
    async (path: string, dirty: boolean) => {
      if (
        dirty &&
        !(await confirmDialog({
          title: "关闭文件",
          message: "该文件有未保存的修改，确定关闭吗？",
          confirmText: "关闭",
          danger: true,
        }))
      )
        return;
      closeFile(path);
    },
    [closeFile],
  );

  const handleCloseEditor = useCallback(async () => {
    const dirty = openFiles.some(f => f.dirty);
    if (
      dirty &&
      !(await confirmDialog({
        title: "关闭编辑器",
        message: "有未保存的修改，确定关闭编辑器面板吗？",
        confirmText: "关闭",
        danger: true,
      }))
    )
      return;
    closeEditor();
  }, [closeEditor, openFiles]);

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: "var(--surface-0)" }}>
      {/* 标签栏 */}
      <div
        className="flex items-center gap-1 px-2 pt-1.5 flex-shrink-0"
        style={{ background: "var(--surface-1)" }}
      >
        {openFiles.map(file => (
          <div
            key={file.path}
            className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg text-[11px] cursor-pointer select-none whitespace-nowrap flex-shrink-0 ${
              file.path === activeFile ? "" : "opacity-70 hover:opacity-100"
            }`}
            style={{
              background: file.path === activeFile ? "var(--surface-2)" : "transparent",
              color: "var(--text-primary)",
              borderBottom:
                file.path === activeFile ? "2px solid var(--accent-blue)" : "2px solid transparent",
            }}
            onClick={() => setActiveFile(file.path)}
            title={file.path}
          >
            <FileCode2 size={11} style={{ color: "var(--text-muted)" }} />
            <span className="max-w-[140px] truncate">{file.name}</span>
            {file.dirty && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent-yellow)" }}
              />
            )}
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                handleCloseFile(file.path, file.dirty);
              }}
              className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-surface-3"
              title="关闭"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleCloseEditor}
          className="p-1 rounded hover:bg-surface-2"
          title="关闭编辑器面板"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={12} />
        </button>
      </div>

      {/* 编辑器 */}
      <div className="flex-1 min-h-0">
        {active ? (
          <>
            <Editor
              path={active.path}
              language={languageFromPath(active.path)}
              value={active.content}
              theme={theme === "dark" ? "vs-dark" : "light"}
              onChange={value => updateFileContent(active.path, value ?? "")}
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "on",
                tabSize: 2,
              }}
            />
          </>
        ) : (
          <div
            className="h-full flex flex-col items-center justify-center gap-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <FileCode2 size={20} />
            <span>在左侧文件树中点击文件开始编辑</span>
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      {active && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0 border-t"
          style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}
        >
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium whitespace-nowrap flex-shrink-0"
            style={{ background: "var(--accent-primary)", color: "var(--bg-body)" }}
          >
            <Save size={11} />
            保存
          </button>
          <span className="text-[10px] font-mono truncate" style={{ color: "var(--text-dim)" }}>
            {active.path}
          </span>
          <span className="ml-auto text-[10px]" style={{ color: "var(--text-dim)" }}>
            {active.dirty ? "未保存" : "已保存"}
          </span>
        </div>
      )}
    </div>
  );
}
