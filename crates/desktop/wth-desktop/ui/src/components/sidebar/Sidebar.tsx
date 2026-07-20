// Sidebar — 会话列表组件。
//
// 显示所有 chat sessions，支持选中切换、新建、删除。

import { useState } from "react";
import { Plus, Trash2, MessageSquare, Clock } from "lucide-react";
import type { SessionInfo } from "@/lib/ipc";
import { sessionDelete } from "@/lib/ipc";

interface SidebarProps {
  sessions: SessionInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString();
}

export function Sidebar({ sessions, activeId, onSelect, onNew }: SidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await sessionDelete(id);
      if (activeId === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        if (remaining.length > 0) onSelect(remaining[0].id);
      }
    } catch (err) {
      console.error("删除会话失败：", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 新建会话 */}
      <div className="px-2.5 py-2">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg
            text-xs font-medium transition-all duration-150 ease-out
            hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: "var(--surface-2)",
            color: "var(--accent-primary)",
            border: "1px solid var(--surface-4)",
          }}
        >
          <Plus size={13} />
          新建会话
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2">
        {sessions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-4 text-center" style={{ color: "var(--text-dim)" }}>
            <MessageSquare size={28} className="mb-3 opacity-25" />
            <p className="text-xs">还没有会话</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((session) => {
              const isActive = session.id === activeId;
              const isDeleting = deletingId === session.id;
              return (
                <div
                  key={session.id}
                  onClick={() => onSelect(session.id)}
                  className="group relative px-2.5 py-2 rounded-lg cursor-pointer
                    transition-all duration-150 ease-out hover:scale-[1.01] active:scale-[0.99]"
                  style={{
                    background: isActive ? "var(--surface-2)" : "transparent",
                  }}
                >
                  {/* 标题 */}
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-medium truncate flex-1 leading-tight"
                      style={{ color: isActive ? "var(--text-primary)" : "var(--text-muted)" }}
                    >
                      {session.title || "未命名会话"}
                    </span>
                  </div>

                  {/* 元信息 */}
                  <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: "var(--text-dim)" }}>
                    <Clock size={10} className="flex-shrink-0" />
                    <span>{relativeTime(session.updated_at || session.created_at)}</span>
                    {session.message_count > 0 && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] leading-none"
                        style={{
                          background: isActive ? "var(--surface-3)" : "var(--surface-2)",
                          color: isActive ? "var(--text-muted)" : "var(--text-dim)",
                        }}
                      >
                        {session.message_count}
                      </span>
                    )}
                  </div>

                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => handleDelete(e, session.id)}
                    disabled={isDeleting}
                    title="删除会话"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md
                      opacity-0 group-hover:opacity-100 transition-opacity duration-150
                      hover:bg-accent-red/10"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      {sessions.length > 0 && (
        <div
          className="px-3 py-2 border-t text-[10px]"
          style={{ borderColor: "var(--surface-4)", color: "var(--text-dim)" }}
        >
          {sessions.length} 个会话
        </div>
      )}
    </div>
  );
}
