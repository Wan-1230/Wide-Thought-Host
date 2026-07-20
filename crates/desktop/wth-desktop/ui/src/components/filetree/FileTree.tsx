// FileTree — 文件树组件。
//
// 显示 workspace 根目录的文件结构。
// - 调用 fileList IPC 加载目录内容
// - 文件夹点击展开/折叠（递归加载子目录）
// - 文件点击事件通过 onFileOpen 回调上抛（当前仅 console.log，预览留给子项目 3）
//
// 配色沿用 Tailwind surface-N + accent-N 色板。
// 图标按文件扩展名着色：.rs/.ts/.tsx/.js/.py/.md/...

import { useState, useEffect, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  FileTerminal,
  FileType,
  ChevronRight,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { fileList } from "@/lib/ipc";
import type { FileEntry } from "@/lib/ipc";

/// 按扩展名返回文件图标 + 颜色。
function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rs":
      return <FileCode size={13} className="text-accent-orange" />;
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return <FileCode size={13} className="text-accent-blue" />;
    case "json":
      return <FileJson size={13} className="text-accent-yellow" />;
    case "sh":
    case "bash":
      return <FileTerminal size={13} className="text-accent-green" />;
    case "md":
    case "markdown":
      return <FileText size={13} className="text-gray-400" />;
    case "toml":
    case "yaml":
    case "yml":
      return <FileType size={13} className="text-accent-purple" />;
    default:
      return <FileText size={13} className="text-gray-500" />;
  }
}

/// 递归渲染单个目录条目。
function TreeNode({
  entry,
  depth,
  onFileOpen,
}: {
  entry: FileEntry;
  depth: number;
  onFileOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const handleToggle = useCallback(async () => {
    if (!entry.is_dir) {
      onFileOpen(entry.path);
      return;
    }
    if (!expanded && children.length === 0) {
      setLoading(true);
      try {
        const kids = await fileList(entry.path, false);
        setChildren(kids);
      } catch (err) {
        console.error("加载目录失败：", err);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  }, [entry, expanded, children.length, onFileOpen]);

  return (
    <div>
      <div
        onClick={handleToggle}
        className="flex items-center gap-1 px-2 py-1 cursor-pointer
          hover:bg-surface-2 rounded transition-colors text-xs"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* 展开/折叠指示器 */}
        {entry.is_dir ? (
          expanded ? (
            <ChevronDown size={11} style={{ color: "var(--text-muted)" }} className="flex-shrink-0" />
          ) : (
            <ChevronRight size={11} style={{ color: "var(--text-muted)" }} className="flex-shrink-0" />
          )
        ) : (
          <span className="w-[11px] flex-shrink-0" />
        )}

        {/* 图标 */}
        {entry.is_dir ? (
          expanded ? (
            <FolderOpen size={13} className="text-accent-blue flex-shrink-0" />
          ) : (
            <Folder size={13} className="text-accent-blue flex-shrink-0" />
          )
        ) : (
          fileIcon(entry.name)
        )}

        {/* 名称 */}
        <span
          className="truncate"
          style={{ color: entry.is_dir ? "var(--accent-primary)" : "var(--text-muted)" }}
        >
          {entry.name}
        </span>

        {/* 加载指示 */}
        {loading && (
          <RefreshCw size={10} className="ml-auto animate-spin" style={{ color: "var(--text-muted)" }} />
        )}
      </div>

      {/* 递归渲染子节点 */}
      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onFileOpen={onFileOpen}
            />
          ))}
        </div>
      )}
      {expanded && children.length === 0 && !loading && (
        <div
          className="text-[10px] italic"
          style={{ paddingLeft: `${(depth + 1) * 12 + 8}px`, color: "var(--text-dim)" }}
        >
          空目录
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // workspace_root 在 Rust 端通过 ipc::filesystem::set_workspace_root 设置
      // 前端调 fileList(".") 让后端解析为 workspace 根
      const entries = await fileList(".", false);
      setRootEntries(entries);
    } catch (err) {
      console.error("加载文件树失败：", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  const handleFileOpen = useCallback((path: string) => {
    // 子项目 3 会实现文件预览；这里只记录到 console。
    console.log("[FileTree] 文件点击：", path);
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <RefreshCw size={16} className="animate-spin" />
        <span className="ml-2 text-xs">加载文件树…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center" style={{ color: "var(--text-muted)" }}>
        <p className="text-xs text-accent-red mb-2">加载失败</p>
        <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>{error}</p>
        <button
          onClick={loadRoot}
          className="mt-3 text-xs text-accent-primary hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  if (rootEntries.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center" style={{ color: "var(--text-muted)" }}>
        <Folder size={20} className="mb-2 opacity-40" />
        <p className="text-xs">工作区为空</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-4">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          工作区文件
        </span>
        <button
          onClick={loadRoot}
          title="刷新"
          className="p-1 rounded hover:bg-surface-3 transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* 文件树 */}
      <div className="flex-1 overflow-y-auto py-1">
        {rootEntries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            onFileOpen={handleFileOpen}
          />
        ))}
      </div>
    </div>
  );
}
