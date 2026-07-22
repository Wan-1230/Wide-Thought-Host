// Terminal — 嵌入式终端组件。
//
// 基于 xterm.js，通过 Rust PTY IPC 与系统 shell 通信。
// 目前 PTY 集成待完成，显示欢迎信息并支持基础交互。

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import {
  onTerminalData,
  onTerminalExit,
  terminalKill,
  terminalResize,
  terminalSpawn,
  terminalWrite,
} from "@/lib/ipc";
import { Terminal as TerminalIcon, Trash2, Plus, Copy, X } from "lucide-react";
import { ContextMenu, contextMenuPointFromEvent, type ContextMenuPoint } from "@/components/common/ContextMenu";

interface TabInfo {
  id: string;
  pid: number;
  title: string;
  shell: string;
  cwd: string;
  exited?: string;
}

export function TerminalPanel() {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const spawnRequested = useRef(false);
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint | null>(null);
  const [menuTab, setMenuTab] = useState<TabInfo | null>(null);

  const createTab = useCallback(async () => {
    try {
      const info = await terminalSpawn({ cols: 120, rows: 32 });
      const newTab: TabInfo = {
        id: info.id,
        pid: info.pid,
        title: `${info.shell.split(/[\\/]/).pop() || "终端"} ${tabs.length + 1}`,
        shell: info.shell,
        cwd: info.cwd,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTab(info.id);
      return info.id;
    } catch (e) {
      console.error("终端创建失败：", e);
      return null;
    }
  }, [tabs.length]);

  // 启动时自动创建首个终端
  useEffect(() => {
    if (!spawnRequested.current && tabs.length === 0) {
      spawnRequested.current = true;
      createTab();
    }
  }, [createTab, tabs.length]);

  // 初始化 xterm
  useEffect(() => {
    if (!termRef.current || !activeTab) return;

    // 清理旧实例
    if (xtermRef.current) {
      xtermRef.current.dispose();
    }

    const fitAddon = new FitAddon();
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      allowProposedApi: true,
      allowTransparency: false,
    });

    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();

    term.onData((data) => {
      terminalWrite(activeTab, data).catch(() => {});
    });

    xtermRef.current = term;
    fitRef.current = fitAddon;

    const syncSize = () => {
      fitAddon.fit();
      terminalResize(activeTab, term.cols, term.rows).catch(() => {});
    };
    syncSize();
    const resizeObserver = new ResizeObserver(syncSize);
    if (termRef.current) resizeObserver.observe(termRef.current);
    const handleResize = () => syncSize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [activeTab]);

  // 监听终端输出
  useEffect(() => {
    if (!activeTab) return;

    let unsubData: (() => void) | undefined;
    let unsubExit: (() => void) | undefined;
    onTerminalData((event) => {
      if (event.id === activeTab) xtermRef.current?.write(event.data);
    }).then((fn) => { unsubData = fn; });
    onTerminalExit((event) => {
      setTabs((current) => current.map((tab) => tab.id === event.id
        ? { ...tab, exited: event.message || `进程已退出（代码 ${event.exit_code ?? "未知"}）` }
        : tab));
      if (event.id === activeTab) {
        xtermRef.current?.writeln(`\r\n\x1b[33m${event.message || `进程已退出（代码 ${event.exit_code ?? "未知"}）`}\x1b[0m`);
      }
    }).then((fn) => { unsubExit = fn; });

    return () => {
      unsubData?.();
      unsubExit?.();
    };
  }, [activeTab]);

  const handleCloseTab = useCallback(async (id: string) => {
    try {
      await terminalKill(id);
    } catch {}
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTab === id) {
        setActiveTab(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, [activeTab]);

  const closeMenu = useCallback(() => {
    setMenuPoint(null);
    setMenuTab(null);
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* 标签栏 */}
      <div
        className="flex items-center border-b px-1 gap-0.5"
        style={{ background: "var(--surface-1)", borderColor: "var(--surface-4)" }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuTab(tab);
              setMenuPoint(contextMenuPointFromEvent(event));
            }}
            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-xs cursor-pointer border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-accent-primary bg-surface-0"
                : "border-transparent hover:bg-surface-2"
            }`}
            style={{
              color: activeTab === tab.id ? "var(--accent-primary)" : "var(--text-muted)",
            }}
          >
            <TerminalIcon size={11} />
            {tab.title}
            {tab.exited && <span className="text-[9px] text-accent-orange">已退出</span>}
            <button
              onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 transition-opacity"
              style={{ color: "var(--text-dim)" }}
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
        <button
          onClick={createTab}
          className="p-1.5 ml-1 rounded hover:bg-surface-2 transition-colors"
          style={{ color: "var(--text-muted)" }}
          title="新建终端"
        >
          <Plus size={13} />
        </button>
      </div>

      <ContextMenu
        open={Boolean(menuPoint && menuTab)}
        point={menuPoint}
        onClose={closeMenu}
        ariaLabel="终端菜单"
        items={
          menuTab
            ? [
                {
                  key: "new",
                  icon: <Plus size={14} />,
                  label: "新建终端",
                  onSelect: async () => {
                    closeMenu();
                    await createTab();
                  },
                },
                {
                  key: "copy",
                  icon: <Copy size={14} />,
                  label: "复制工作目录",
                  onSelect: async () => {
                    await navigator.clipboard.writeText(menuTab.cwd);
                    closeMenu();
                  },
                },
                {
                  type: "separator",
                  key: "sep",
                },
                {
                  key: "close",
                  icon: <X size={14} />,
                  label: "关闭标签",
                  danger: true,
                  onSelect: async () => {
                    await handleCloseTab(menuTab.id);
                    closeMenu();
                  },
                },
              ]
            : []
        }
      />

      {/* 终端容器 */}
      <div className="flex-1 overflow-hidden p-1">
        {activeTab ? (
          <div
            ref={termRef}
            className="h-full w-full rounded-md overflow-hidden"
          />
        ) : (
          <div className="h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
            <p className="text-sm">点击 + 创建终端</p>
          </div>
        )}
      </div>
    </div>
  );
}
