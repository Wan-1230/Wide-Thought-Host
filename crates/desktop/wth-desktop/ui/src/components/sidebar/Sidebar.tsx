// Sidebar — 会话列表组件。
//
// 显示所有 chat sessions，支持选中切换、搜索过滤、删除。
// 新建按钮由父组件在标题区提供。

import { useState, useMemo } from "react";
import { Pin, PinOff, Pencil, Trash2, MessageSquare, Clock, FolderOpen } from "lucide-react";
import type { SessionInfo } from "@/lib/ipc";
import { ContextMenu, contextMenuPointFromEvent, type ContextMenuPoint } from "@/components/common/ContextMenu";

interface SidebarProps {
  sessions: SessionInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDeleteSession: (id: string) => Promise<void>;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onTogglePinSession: (id: string, pinned: boolean) => Promise<void>;
  searchQuery?: string;
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

export function Sidebar({ sessions, activeId, onSelect, onDeleteSession, onRenameSession, onTogglePinSession, searchQuery = "" }: SidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint | null>(null);
  const [menuSession, setMenuSession] = useState<SessionInfo | null>(null);

  // 搜索过滤
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      (s.title || "未命名会话").toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  const closeMenu = () => {
    setMenuPoint(null);
    setMenuSession(null);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDeleteSession(id);
    } catch (err) {
      console.error("删除会话失败：", err);
    } finally {
      setDeletingId(null);
      closeMenu();
    }
  };

  // 分组：今天 / 本周 / 更早
  const groups = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const today: SessionInfo[] = [];
    const thisWeek: SessionInfo[] = [];
    const earlier: SessionInfo[] = [];

    for (const s of filteredSessions) {
      const t = new Date(s.updated_at || s.created_at).getTime();
      const diff = now - t;
      if (diff < day) today.push(s);
      else if (diff < 7 * day) thisWeek.push(s);
      else earlier.push(s);
    }

    return [
      { label: "今天", items: today },
      { label: "本周", items: thisWeek },
      { label: "更早", items: earlier },
    ].filter((g) => g.items.length > 0);
  }, [filteredSessions]);

  if (sessions.length === 0) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center px-4 text-center"
        style={{ color: "var(--text-dim)" }}
      >
        <MessageSquare size={26} className="mb-2.5 opacity-25" />
        <p className="text-xs">还没有会话</p>
        <p className="text-[10px] mt-1 opacity-70">点击右上角 + 开始</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-2 pb-2">
      {groups.length === 0 ? (
        <div className="text-center py-6 text-[11px]" style={{ color: "var(--text-dim)" }}>
          没有匹配的会话
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="mb-3">
            <div
              className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-dim)" }}
            >
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((session) => {
                const isActive = session.id === activeId;
                const isDeleting = deletingId === session.id;
                return (
                  <div
                    key={session.id}
                    onClick={() => onSelect(session.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuSession(session);
                      setMenuPoint(contextMenuPointFromEvent(e));
                    }}
                    className="group relative px-2.5 py-1.5 rounded-md cursor-pointer
                      transition-colors duration-150"
                    style={{
                      background: isActive ? "var(--surface-2)" : "transparent",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[12.5px] truncate flex-1 leading-snug"
                        style={{
                          color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                          fontWeight: isActive ? 500 : 400,
                        }}
                      >
                        {session.title || "未命名会话"}
                      </span>
                    </div>

                    {session.message_count > 0 && (
                      <div
                        className="text-[10px] mt-0.5 flex items-center gap-1"
                        style={{ color: "var(--text-dim)" }}
                      >
                        <Clock size={9} />
                        <span>{relativeTime(session.updated_at || session.created_at)}</span>
                      </div>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                      disabled={isDeleting}
                      title="删除"
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded
                        opacity-0 group-hover:opacity-100 transition-opacity duration-150
                        hover:bg-accent-red/10"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Trash2 size={11} />
                    </button>
                    {session.pinned && (
                      <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: "var(--accent-orange)" }}>
                        <Pin size={10} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
      <ContextMenu
        open={Boolean(menuPoint && menuSession)}
        point={menuPoint}
        onClose={closeMenu}
        ariaLabel="会话菜单"
        items={
          menuSession
            ? [
                {
                  key: "open",
                  icon: <MessageSquare size={14} />,
                  label: "打开会话",
                  onSelect: () => {
                    onSelect(menuSession.id);
                    closeMenu();
                  },
                },
                {
                  key: "rename",
                  icon: <Pencil size={14} />,
                  label: "重命名",
                  onSelect: async () => {
                    const next = window.prompt("输入新的会话名称", menuSession.title || "未命名会话");
                    if (!next || !next.trim()) return;
                    await onRenameSession(menuSession.id, next.trim());
                    closeMenu();
                  },
                },
                {
                  key: "pin",
                  icon: menuSession.pinned ? <PinOff size={14} /> : <Pin size={14} />,
                  label: menuSession.pinned ? "取消置顶" : "置顶",
                  onSelect: async () => {
                    await onTogglePinSession(menuSession.id, !menuSession.pinned);
                    closeMenu();
                  },
                },
                {
                  type: "separator",
                  key: "sep",
                },
                {
                  key: "delete",
                  icon: <Trash2 size={14} />,
                  label: "删除",
                  danger: true,
                  onSelect: async () => {
                    await handleDelete(menuSession.id);
                  },
                },
              ]
            : []
        }
      />
    </div>
  );
}
