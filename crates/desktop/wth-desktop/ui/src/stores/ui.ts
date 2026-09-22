// 布局 UI 状态仓库（仅界面层，不含业务逻辑）。
//
// 管理侧边栏折叠、右侧执行面板开合与宽度等纯视图状态。
// 侧边栏折叠与面板开合偏好持久化到 localStorage；
// 面板宽度与"窄窗口强制收起"标记不持久化。

import { create } from "zustand";

/** 右侧执行面板的页签。 */
export type InspectorTab = "log" | "plan" | "context";

/** 布局相关的响应式阈值（单位 px），可按需自定义。 */
export const LAYOUT_BREAKPOINTS = {
  /** 低于该宽度时左侧侧边栏自动折叠为图标栏 */
  sidebarAutoCollapse: 1080,
  /** 低于该宽度时右侧执行面板强制收起 */
  inspectorAutoCollapse: 1200,
} as const;

const STORAGE_KEY = "wth-ui-layout";

interface PersistedLayout {
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
}

function loadPersisted(): Partial<PersistedLayout> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedLayout>) : {};
  } catch {
    return {};
  }
}

function persist(state: PersistedLayout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级
  }
}

interface UiStore extends PersistedLayout {
  /** 窄窗口强制收起右侧面板（由窗口宽度驱动，不持久化） */
  inspectorForceCollapsed: boolean;
  /** 右侧面板宽度（px，可拖拽调整，不持久化） */
  inspectorWidth: number;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleInspector: () => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setInspectorForceCollapsed: (forced: boolean) => void;
  setInspectorWidth: (width: number) => void;
}

const persisted = loadPersisted();

export const useUiStore = create<UiStore>((set, get) => ({
  sidebarCollapsed: persisted.sidebarCollapsed ?? false,
  inspectorOpen: persisted.inspectorOpen ?? false,
  inspectorTab: persisted.inspectorTab ?? "log",
  inspectorForceCollapsed: false,
  inspectorWidth: 340,

  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),

  setSidebarCollapsed: collapsed => {
    set({ sidebarCollapsed: collapsed });
    const s = get();
    persist({
      sidebarCollapsed: s.sidebarCollapsed,
      inspectorOpen: s.inspectorOpen,
      inspectorTab: s.inspectorTab,
    });
  },

  toggleInspector: () => {
    const next = !(get().inspectorOpen && !get().inspectorForceCollapsed);
    set({ inspectorOpen: next, inspectorForceCollapsed: false });
    const s = get();
    persist({
      sidebarCollapsed: s.sidebarCollapsed,
      inspectorOpen: s.inspectorOpen,
      inspectorTab: s.inspectorTab,
    });
  },

  setInspectorOpen: open => {
    set({ inspectorOpen: open, inspectorForceCollapsed: false });
    const s = get();
    persist({
      sidebarCollapsed: s.sidebarCollapsed,
      inspectorOpen: s.inspectorOpen,
      inspectorTab: s.inspectorTab,
    });
  },

  setInspectorTab: tab => {
    set({ inspectorTab: tab });
    const s = get();
    persist({
      sidebarCollapsed: s.sidebarCollapsed,
      inspectorOpen: s.inspectorOpen,
      inspectorTab: s.inspectorTab,
    });
  },

  setInspectorForceCollapsed: forced => set({ inspectorForceCollapsed: forced }),

  setInspectorWidth: width => set({ inspectorWidth: Math.min(560, Math.max(260, width)) }),
}));
