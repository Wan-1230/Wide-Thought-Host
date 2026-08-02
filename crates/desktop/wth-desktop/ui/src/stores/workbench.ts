// 工作台状态：编辑器标签页与 Diff 审查模态框。

import { create } from "zustand";

export interface EditorFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
}

export interface DiffData {
  path: string;
  before: string;
  after: string;
}

interface WorkbenchStore {
  editorVisible: boolean;
  openFiles: EditorFile[];
  activeFile: string | null;
  diffModal: DiffData | null;

  openEditor: () => void;
  closeEditor: () => void;
  openFile: (path: string, name: string, content: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  markSaved: (path: string, content: string) => void;
  showDiff: (data: DiffData) => void;
  closeDiff: () => void;
}

export const useWorkbenchStore = create<WorkbenchStore>((set) => ({
  editorVisible: false,
  openFiles: [],
  activeFile: null,
  diffModal: null,

  openEditor: () => set({ editorVisible: true }),
  closeEditor: () => set({ editorVisible: false }),

  openFile: (path, name, content) =>
    set((state) => {
      const exists = state.openFiles.some((f) => f.path === path);
      const openFiles = exists
        ? state.openFiles.map((f) => (f.path === path ? { ...f, content } : f))
        : [...state.openFiles, { path, name, content, dirty: false }];
      return { editorVisible: true, openFiles, activeFile: path };
    }),

  closeFile: (path) =>
    set((state) => {
      const openFiles = state.openFiles.filter((f) => f.path !== path);
      let activeFile = state.activeFile;
      if (activeFile === path) {
        activeFile = openFiles.length > 0 ? openFiles[openFiles.length - 1].path : null;
      }
      return { openFiles, activeFile };
    }),

  setActiveFile: (path) => set({ activeFile: path }),

  updateFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, dirty: true } : f
      ),
    })),

  markSaved: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, dirty: false } : f
      ),
    })),

  showDiff: (data) => set({ diffModal: data }),
  closeDiff: () => set({ diffModal: null }),
}));