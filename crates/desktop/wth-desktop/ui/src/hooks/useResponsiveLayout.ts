// 响应式布局 Hook — 监听窗口宽度，驱动侧边栏 / 右侧面板自动收起。

import { useEffect, useState } from "react";
import { LAYOUT_BREAKPOINTS, useUiStore } from "@/stores/ui";

/**
 * 监听窗口宽度变化：
 * - 窗口变窄（< sidebarAutoCollapse）时自动折叠左侧侧边栏；
 * - 窗口变窄（< inspectorAutoCollapse）时强制收起右侧执行面板。
 * 返回当前窗口宽度，供组件做更细粒度的自适应。
 */
export function useResponsiveLayout(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  const setSidebarCollapsed = useUiStore(s => s.setSidebarCollapsed);
  const setInspectorForceCollapsed = useUiStore(s => s.setInspectorForceCollapsed);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setWidth(w);
      if (w < LAYOUT_BREAKPOINTS.sidebarAutoCollapse) {
        // 窄窗口自动折叠侧边栏（用户仍可手动展开）
        setSidebarCollapsed(true);
      }
      setInspectorForceCollapsed(w < LAYOUT_BREAKPOINTS.inspectorAutoCollapse);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setSidebarCollapsed, setInspectorForceCollapsed]);

  return width;
}
