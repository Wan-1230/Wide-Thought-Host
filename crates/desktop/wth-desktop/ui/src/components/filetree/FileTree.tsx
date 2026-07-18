import { useEffect, useState } from "react";
import { fileList, fileRead } from "@/lib/ipc";
import type { FileEntry } from "@/lib/ipc";
import { Folder, File, ChevronRight, ChevronDown, FolderOpen } from "lucide-react";

export function FileTree() {
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Default to current working directory
    const cwd = localStorage.getItem("wth-workspace") || ".";
    setRootPath(cwd);
    loadDir(cwd);
  }, []);

  const loadDir = async (path: string) => {
    setLoading(true);
    try {
      const files = await fileList(path);
      setEntries(files);
    } catch (e) {
      console.error("Failed to list directory:", e);
    }
    setLoading(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Path bar */}
      <div className="p-2 border-b border-surface-4">
        <div className="text-[10px] text-gray-500 truncate px-1" title={rootPath}>
          {rootPath || "No workspace"}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="text-xs text-gray-500 text-center mt-4">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-gray-500 text-center mt-4">
            Empty directory
          </div>
        ) : (
          entries.map((entry) => (
            <FileTreeItem key={entry.path} entry={entry} depth={0} />
          ))
        )}
      </div>
    </div>
  );
}

function FileTreeItem({ entry, depth }: { entry: FileEntry; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = entry.is_dir && entry.children && entry.children.length > 0;

  const handleClick = async () => {
    if (entry.is_dir) {
      setExpanded(!expanded);
    } else {
      // Open file in editor
      try {
        const content = await fileRead(entry.path);
        console.log(`Loaded ${entry.name}: ${content.length} bytes`);
        // TODO: Open in Monaco editor
      } catch (e) {
        console.error(`Failed to read ${entry.path}:`, e);
      }
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-1 px-2 py-1 text-xs hover:bg-surface-2 transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={entry.path}
      >
        {entry.is_dir && (
          <span className="text-gray-500">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
        {entry.is_dir ? (
          expanded ? (
            <FolderOpen size={14} className="text-accent-blue shrink-0" />
          ) : (
            <Folder size={14} className="text-accent-blue shrink-0" />
          )
        ) : (
          <File size={14} className="text-gray-500 shrink-0" />
        )}
        <span className="text-gray-300 truncate">{entry.name}</span>
      </button>
      {expanded && hasChildren && (
        <div>
          {entry.children!.map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}
