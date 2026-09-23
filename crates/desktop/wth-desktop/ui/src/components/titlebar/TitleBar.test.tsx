// @vitest-environment jsdom
// TitleBar 冒烟测试 —— 同时锁住「窗口控制必须经 lib/ipc 落到 plugin:window|* 命令」这条链路。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleBar } from "@/components/titlebar/TitleBar";
import { useUiStore } from "@/stores/ui";
import { installStorageShim } from "@/test/jsdom-shims";
import { tauri } from "@/test/tauri-stub";

afterEach(cleanup);

beforeEach(() => {
  installStorageShim();
  tauri.reset();
  useUiStore.setState({ sidebarCollapsed: false, inspectorOpen: true, inspectorTab: "log" });
});

describe("窗口控制按钮", () => {
  beforeEach(() => {
    tauri.on("plugin:window|is_maximized", () => false);
  });

  it("最小化/最大化/关闭分别打到对应的 Tauri 窗口命令", async () => {
    render(<TitleBar sessionTitle={null} />);
    await waitFor(() => expect(tauri.count("plugin:window|is_maximized")).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    fireEvent.click(screen.getByRole("button", { name: "最大化" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(tauri.last("plugin:window|minimize")?.args).toEqual({ label: "main" });
    expect(tauri.last("plugin:window|toggle_maximize")?.args).toEqual({ label: "main" });
    expect(tauri.last("plugin:window|close")?.args).toEqual({ label: "main" });
  });

  it("命令 reject 时不让组件崩溃（桌面端窗口 API 可能不可用）", async () => {
    tauri.on("plugin:window|minimize", () => Promise.reject(new Error("窗口已销毁")));
    render(<TitleBar sessionTitle={null} />);
    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    await waitFor(() => expect(tauri.count("plugin:window|minimize")).toBe(1));
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });
});

describe("最大化状态", () => {
  it("is_maximized 为 true 时按钮语义切换为「向下还原」", async () => {
    tauri.on("plugin:window|is_maximized", () => true);
    render(<TitleBar sessionTitle={null} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "向下还原" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "最大化" })).toBeNull();
  });

  it("is_maximized 查询失败时保持未最大化文案，不阻塞渲染", async () => {
    tauri.on("plugin:window|is_maximized", () => Promise.reject(new Error("不支持")));
    render(<TitleBar sessionTitle="任务 A" />);
    await waitFor(() => expect(tauri.count("plugin:window|is_maximized")).toBe(1));
    expect(screen.getByRole("button", { name: "最大化" })).toBeTruthy();
    expect(screen.getByText("任务 A")).toBeTruthy();
  });
});

describe("标题区内容", () => {
  beforeEach(() => {
    tauri.on("plugin:window|is_maximized", () => false);
  });

  it("无会话时展示占位文案，有会话时展示会话标题", () => {
    const { rerender } = render(<TitleBar sessionTitle={null} />);
    expect(screen.getByText("开始新的任务")).toBeTruthy();
    rerender(<TitleBar sessionTitle="排查 CI flaky" />);
    expect(screen.queryByText("开始新的任务")).toBeNull();
    expect(screen.getByText("排查 CI flaky")).toBeTruthy();
  });

  it("streaming 为真才出现「任务执行中」指示", () => {
    const { rerender } = render(<TitleBar sessionTitle="A" streaming={false} />);
    expect(screen.queryByTitle("任务执行中")).toBeNull();
    rerender(<TitleBar sessionTitle="A" streaming />);
    expect(screen.getByTitle("任务执行中")).toBeTruthy();
  });
});

describe("侧边栏折叠开关", () => {
  beforeEach(() => {
    tauri.on("plugin:window|is_maximized", () => false);
  });

  it("点击折叠按钮翻转 store 状态并写回 localStorage", async () => {
    render(<TitleBar sessionTitle={null} />);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "折叠侧边栏" }));
    await waitFor(() => expect(useUiStore.getState().sidebarCollapsed).toBe(true));
    expect(window.localStorage.getItem("wth-ui-layout")).toContain('"sidebarCollapsed":true');

    // 折叠后按钮语义变为「展开侧边栏」，保证用户还能点回来
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeTruthy();
  });
});
