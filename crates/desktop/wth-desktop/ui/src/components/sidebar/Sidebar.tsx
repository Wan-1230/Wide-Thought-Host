import type { SessionInfo } from "@/lib/ipc";
import { Plus, MessageSquare, Trash2, Search } from "lucide-react";
import { useState } from "react";

interface SidebarProps {
  sessions: SessionInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function Sidebar({ sessions, activeId, onSelect, onNew }: SidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? sessions.filter((s) =>
        s.title.toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 flex items-center gap-2">
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-surface-2 border border-surface-4 rounded-md py-1.5 pl-8 pr-3 text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-accent-blue transition-colors"
          />
        </div>
        <button
          onClick={onNew}
          className="p-1.5 rounded-md bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue transition-colors"
          title="New Session"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2">
        {filtered.length === 0 ? (
          <div className="text-center text-gray-500 text-xs mt-8 px-4">
            {search ? "No matching sessions" : "No sessions yet.\nClick + to create one."}
          </div>
        ) : (
          filtered.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`w-full text-left px-3 py-2 rounded-md mb-0.5 flex items-center gap-2 transition-colors group ${
                activeId === session.id
                  ? "bg-accent-blue/10 text-accent-blue"
                  : "text-gray-400 hover:bg-surface-2 hover:text-gray-200"
              }`}
            >
              <MessageSquare size={14} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{session.title}</div>
                <div className="text-[10px] text-gray-500">
                  {session.message_count} messages · {session.model}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-surface-4">
        <div className="text-[10px] text-gray-500 text-center">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
