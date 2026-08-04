// TitleBar — Tauri 原生风格自定义标题栏。
//
// 替代系统窗口装饰（tauri.conf.json 中 decorations: false）。
// 左侧：折叠按钮 + 软件名称；中间：当前会话/任务名称；
// 右侧：窗口控制按钮（最小化 / 最大化-还原 / 关闭）。
// 整栏作为窗口拖拽区域（data-tauri-drag-region）。

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from "lucide-react";
import { useUiStore } from "@/stores/ui";
import wthIcon from "@/assets/wth-icon.png";

interface TitleBarProps {
  /** 中间展示的当前会话 / 任务名称 */
  sessionTitle: string | null;
  /** 是否有正在流式生成的任务 */
  streaming?: boolean;
}

export function TitleBar({ sessionTitle, streaming = false }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    appWindow.isMaximized().then((m) => {
      if (!disposed) setMaximized(m);
    }).catch(() => {});
    // 监听窗口最大化状态变化（含双击标题栏、Win+↑ 等系统行为）
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then((m) => setMaximized(m)).catch(() => {});
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize().catch(console.error);
  const handleToggleMaximize = () => getCurrentWindow().toggleMaximize().catch(console.error);
  const handleClose = () => getCurrentWindow().close().catch(console.error);

  return (
    <header
      data-tauri-drag-region
      className="title-bar flex items-center h-10 flex-shrink-0 select-none"
      style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--surface-3)" }}
    >
      {/* 左侧：折叠按钮 + 软件名称 */}
      <div className="flex items-center gap-1.5 pl-2.5 pr-3 min-w-0" data-tauri-drag-region>
        <button
          onClick={toggleSidebar}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          className="title-bar-btn"
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <img src={wthIcon} alt="WTH" className="w-5 h-5 rounded theme-logo" draggable={false} />
        <span className="text-[12.5px] font-semibold tracking-wide" style={{ color: "var(--text-primary)" }}>
          Wide Thought Host
        </span>
      </div>

      {/* 中间：当前会话 / 任务名称 */}
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center justify-center min-w-0 px-2"
      >
        {sessionTitle ? (
          <div className="flex items-center gap-2 min-w-0 max-w-[46%]">
            {streaming && (
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                style={{ background: "var(--accent-green)" }}
                title="任务执行中"
              />
            )}
            <span
              className="text-[12px] truncate"
              style={{ color: "var(--text-muted)" }}
              title={sessionTitle}
            >
              {sessionTitle}
            </span>
          </div>
        ) : (
          <span className="text-[12px]" style={{ color: "var(--text-dim)" }}>
            开始新的任务
          </span>
        )}
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div className="flex items-center h-full flex-shrink-0">
        <button onClick={handleMinimize} className="win-ctrl" title="最小化" aria-label="最小化">
          <Minus size={14} />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="win-ctrl"
          title={maximized ? "向下还原" : "最大化"}
          aria-label={maximized ? "向下还原" : "最大化"}
        >
          {maximized ? <Copy size={11} /> : <Square size={11} />}
        </button>
        <button
          onClick={handleClose}
          className="win-ctrl win-ctrl-close"
          title="关闭"
          aria-label="关闭"
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
