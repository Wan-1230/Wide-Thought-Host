// Sidebar — 左侧会话与任务列表（可折叠）。
//
// 参考 Codex 的简洁结构 + Trae / WorkBuddy 的任务列表交互：
// - 展开 / 收起折叠（收起后仅保留图标）；
// - 顶部常驻「新建会话」按钮；
// - 会话列表独立内部滚动；hover 高亮并展示快捷操作；右键完整菜单；
// - 区分普通会话与 Agent 任务条目（任务条目带空闲/执行中状态标记）；
// - 底部固定：模型快速切换下拉框 + 设置入口（不随列表滚动）。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import type { ProviderSummary, SessionInfo } from "@/lib/ipc";
import { providerList, providerSetDefault } from "@/lib/ipc";
import { ContextMenu, contextMenuPointFromEvent, type ContextMenuPoint } from "@/components/common/ContextMenu";
import wthLogoDark from "@/assets/wth-logo-dark.png";
import wthLogoLight from "@/assets/wth-logo-light.png";
import wthMark from "@/assets/wth-mark.png";

/** 判定会话是否为 Agent 任务条目（委派/子会话标题以 [ 开头约定）。可按需自定义。 */
function isTaskSession(session: SessionInfo): boolean {
  return /^\[/.test(session.title || "");
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

interface SidebarProps {
  /** 是否折叠为图标栏 */
  collapsed: boolean;
  /** 当前主题，用于切换 Logo 深浅版本 */
  theme: "dark" | "light";
  sessions: SessionInfo[];
  activeId: string | null;
  /** 各会话的执行状态（true = 执行中） */
  streaming: Record<string, boolean>;
  providers: ProviderSummary[];
  onRefreshProviders: () => void;
  onNewSession: () => void;
  onSelect: (id: string) => void;
  onDeleteSession: (id: string) => Promise<void>;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDuplicateSession: (id: string) => Promise<void>;
  onTogglePinSession: (id: string, pinned: boolean) => Promise<void>;
  onExportSession: (id: string, format: "markdown" | "json") => void;
  onOpenSettings: () => void;
  searchQuery?: string;
}

/** 底部模型快速切换下拉框（不随列表滚动）。 */
function ModelSwitcher({ providers, onRefresh }: { providers: ProviderSummary[]; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = providers.find((p) => p.is_default) ?? providers[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await providerSetDefault(id);
      onRefresh();
      setOpen(false);
    } catch (error) {
      console.error("切换默认模型失败：", error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--surface-2)]"
        title="切换默认模型"
      >
        <Server size={14} style={{ color: "var(--accent-purple)" }} className="flex-shrink-0" />
        <span className="flex-1 min-w-0 text-[11.5px] truncate" style={{ color: "var(--text-primary)" }}>
          {current ? current.model || current.name : "未配置模型"}
        </span>
        <ChevronDown size={12} style={{ color: "var(--text-dim)" }} className="flex-shrink-0" />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1.5 rounded-xl border shadow-xl overflow-hidden z-30 animate-fade-in"
          style={{ background: "var(--surface-1)", borderColor: "var(--surface-3)" }}
        >
          <div className="px-3 py-1.5 text-[10px]" style={{ color: "var(--text-dim)" }}>选择默认模型</div>
          <div className="max-h-48 overflow-y-auto pb-1">
            {providers.length === 0 && (
              <div className="px-3 py-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
                暂无模型，请在设置中添加
              </div>
            )}
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => void pick(p.id)}
                disabled={Boolean(busyId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--surface-2)]"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[11.5px] truncate" style={{ color: "var(--text-primary)" }}>{p.name}</span>
                  <span className="block text-[10px] truncate font-mono" style={{ color: "var(--text-dim)" }}>{p.model}</span>
                </span>
                {busyId === p.id ? (
                  <Loader2 size={12} className="animate-spin flex-shrink-0" style={{ color: "var(--accent-blue)" }} />
                ) : (p.is_default || p.id === current?.id) ? (
                  <Check size={12} className="flex-shrink-0" style={{ color: "var(--accent-green)" }} />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  collapsed,
  theme,
  sessions,
  activeId,
  streaming,
  providers,
  onRefreshProviders,
  onNewSession,
  onSelect,
  onDeleteSession,
  onRenameSession,
  onDuplicateSession,
  onTogglePinSession,
  onExportSession,
  onOpenSettings,
  searchQuery = "",
}: SidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint | null>(null);
  const [menuSession, setMenuSession] = useState<SessionInfo | null>(null);
  /** 两步确认删除：第一次点击进确认态，2.5s 内再点才真正删除 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

  const requestDelete = (id: string) => {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    if (confirmingId === id) {
      setConfirmingId(null);
      void handleDelete(id);
      return;
    }
    setConfirmingId(id);
    confirmTimerRef.current = window.setTimeout(() => setConfirmingId(null), 2500);
  };

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title || "未命名会话").toLowerCase().includes(q));
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

  // ─── 折叠态：仅图标 ────────────────────────────────
  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center py-2 gap-1 overflow-y-auto sidebar-collapse-in">
        {/* 收起态：简化单色符号（浅色主题反色适配） */}
        <img
          src={wthMark}
          alt="WTH"
          className="w-6 h-6 mb-1 flex-shrink-0"
          style={{ filter: theme === "light" ? "invert(1)" : undefined, opacity: 0.9 }}
          draggable={false}
        />
        <button onClick={onNewSession} className="sidebar-icon-btn sidebar-icon-btn-primary" title="新建会话">
          <Plus size={16} />
        </button>
        <div className="w-6 my-1 border-t" style={{ borderColor: "var(--surface-3)" }} />
        {filteredSessions.slice(0, 12).map((s) => {
          const running = streaming[s.id];
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              title={s.title || "未命名会话"}
              className="sidebar-icon-btn relative"
              style={{
                background: s.id === activeId ? "var(--surface-2)" : "transparent",
                color: s.id === activeId ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {isTaskSession(s) ? <Bot size={14} /> : <MessageSquare size={14} />}
              {running && (
                <span
                  className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "var(--accent-green)" }}
                />
              )}
            </button>
          );
        })}
        <span className="flex-1" />
        <button onClick={onOpenSettings} className="sidebar-icon-btn" title="设置">
          <Settings2 size={15} />
        </button>
      </div>
    );
  }

  // ─── 展开态 ────────────────────────────────────────
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 顶部：主 Logo + 字标（随主题切换深/浅版本） */}
      <div className="px-3.5 pt-3 pb-1 flex-shrink-0 flex items-center">
        <img
          src={theme === "dark" ? wthLogoDark : wthLogoLight}
          alt="Wide Thought Host"
          className="h-[22px] w-auto select-none"
          draggable={false}
        />
      </div>

      {/* 顶部：新建会话按钮（醒目常驻） */}
      <div className="px-2.5 pt-2.5 pb-1.5 flex-shrink-0">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-medium
            transition-colors duration-150"
          style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
        >
          <Plus size={14} />
          新建会话
        </button>
      </div>

      {/* 会话 & 任务列表：独立内部滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-4 text-center" style={{ color: "var(--text-dim)" }}>
            <MessageSquare size={24} className="mb-2 opacity-25" />
            <p className="text-[11px]">还没有会话</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-6 text-[11px]" style={{ color: "var(--text-dim)" }}>没有匹配的会话</div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-2.5">
              <div className="px-2 py-1 text-[10px] font-medium tracking-wider" style={{ color: "var(--text-dim)" }}>
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((session) => {
                  const isActive = session.id === activeId;
                  const running = streaming[session.id];
                  const task = isTaskSession(session);
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
                      className="group relative rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors duration-150
                        hover:bg-[color:var(--surface-2)]"
                      style={{ background: isActive ? "var(--surface-2)" : "transparent" }}
                    >
                      <div className="flex items-center gap-1.5">
                        {task ? (
                          <Bot size={13} className="flex-shrink-0" style={{ color: "var(--accent-purple)" }} />
                        ) : (
                          <MessageSquare size={13} className="flex-shrink-0" style={{ color: "var(--text-dim)" }} />
                        )}
                        <span
                          className="text-[12.5px] truncate flex-1 leading-snug"
                          style={{
                            color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                            fontWeight: isActive ? 500 : 400,
                          }}
                        >
                          {session.title || "未命名会话"}
                        </span>
                        {session.pinned && <Pin size={10} style={{ color: "var(--accent-orange)" }} className="flex-shrink-0" />}
                      </div>

                      {/* 任务条目：状态标记；普通会话：相对时间 */}
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-dim)" }}>
                        {task ? (
                          running ? (
                            <>
                              <Loader2 size={9} className="animate-spin" style={{ color: "var(--accent-green)" }} />
                              <span style={{ color: "var(--accent-green)" }}>执行中</span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-dim)" }} />
                              <span>空闲</span>
                            </>
                          )
                        ) : (
                          <span>{relativeTime(session.updated_at || session.created_at)}</span>
                        )}
                      </div>

                      {/* hover 悬浮操作入口（隐藏时不拦截点击，避免误触） */}
                      <div
                        className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0
                          pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto
                          transition-opacity duration-150"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = window.prompt("输入新的会话名称", session.title || "未命名会话");
                            if (next && next.trim()) void onRenameSession(session.id, next.trim());
                          }}
                          title="重命名"
                          className="sidebar-row-action"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDuplicateSession(session.id);
                          }}
                          title="复制会话"
                          className="sidebar-row-action"
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            requestDelete(session.id);
                          }}
                          disabled={deletingId === session.id}
                          title={confirmingId === session.id ? "再次点击确认删除" : "删除"}
                          className="sidebar-row-action"
                          style={
                            confirmingId === session.id
                              ? { background: "var(--accent-red)", color: "#ffffff" }
                              : undefined
                          }
                        >
                          {deletingId === session.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Trash2 size={11} />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部固定区：模型快速切换 + 设置（不随列表滚动） */}
      <div className="flex-shrink-0 px-2 py-2 border-t space-y-0.5" style={{ borderColor: "var(--surface-3)" }}>
        <ModelSwitcher providers={providers} onRefresh={onRefreshProviders} />
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--surface-2)]"
          title="设置"
        >
          <Settings2 size={14} style={{ color: "var(--text-muted)" }} />
          <span className="text-[11.5px]" style={{ color: "var(--text-primary)" }}>设置</span>
        </button>
      </div>

      {/* 右键菜单 */}
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
                  key: "duplicate",
                  icon: <Copy size={14} />,
                  label: "复制会话",
                  onSelect: async () => {
                    await onDuplicateSession(menuSession.id);
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
                  key: "export-md",
                  icon: <Download size={14} />,
                  label: "导出为 Markdown",
                  onSelect: () => {
                    onExportSession(menuSession.id, "markdown");
                    closeMenu();
                  },
                },
                {
                  key: "export-json",
                  icon: <Download size={14} />,
                  label: "导出为 JSON",
                  onSelect: () => {
                    onExportSession(menuSession.id, "json");
                    closeMenu();
                  },
                },
                { type: "separator", key: "sep" },
                {
                  key: "delete",
                  icon: <Trash2 size={14} />,
                  label: "删除",
                  danger: true,
                  onSelect: async () => {
                    if (!window.confirm(`确定删除会话「${menuSession.title || "未命名会话"}」吗？此操作不可撤销。`)) {
                      closeMenu();
                      return;
                    }
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
