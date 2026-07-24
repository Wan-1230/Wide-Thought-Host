import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Moon, Plus, Settings, Sun } from "lucide-react";
import type { SessionInfo } from "@/lib/ipc";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  sessions: SessionInfo[];
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  action: () => void;
}

export function CommandPalette({
  open,
  onClose,
  sessions,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const commands = useMemo<CommandItem[]>(() => {
    const actions: CommandItem[] = [
      {
        id: "new-session",
        label: "新建会话",
        hint: "Ctrl+N",
        icon: <Plus size={14} />,
        action: () => { onNewSession(); onClose(); },
      },
      {
        id: "open-settings",
        label: "打开设置",
        hint: "Ctrl+,",
        icon: <Settings size={14} />,
        action: () => { onOpenSettings(); onClose(); },
      },
      {
        id: "toggle-theme",
        label: "切换深色/浅色主题",
        icon: <Sun size={14} />,
        action: () => { onToggleTheme(); onClose(); },
      },
    ];

    const sessionItems: CommandItem[] = sessions.slice(0, 20).map((s) => ({
      id: `session-${s.id}`,
      label: s.title || "未命名会话",
      hint: s.model,
      icon: <MessageSquare size={14} />,
      action: () => { onSelectSession(s.id); onClose(); },
    }));

    return [...actions, ...sessionItems];
  }, [sessions, onNewSession, onOpenSettings, onToggleTheme, onSelectSession, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[activeIndex]?.action();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,.45)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden"
        style={{ background: "var(--surface-1)", borderColor: "var(--surface-3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--surface-3)" }}>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>⌘</span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: "var(--text-primary)" }}
            placeholder="搜索会话或执行命令…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              没有匹配结果
            </div>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{
                  background: index === activeIndex ? "var(--surface-2)" : "transparent",
                  color: "var(--text-primary)",
                }}
                onClick={item.action}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span style={{ color: "var(--text-muted)" }}>{item.icon}</span>
                <span className="flex-1 text-xs font-medium truncate">{item.label}</span>
                {item.hint && (
                  <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>{item.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
