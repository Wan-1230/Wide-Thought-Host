// @vitest-environment jsdom
// App 外壳冒烟测试 —— 装配完整性、快捷键/命令面板入口、原生菜单事件接线、错误边界。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { useChatStore } from "@/stores/chat";
import { useUiStore } from "@/stores/ui";
import { makeSettings, SESSION_FIXTURE } from "@/test/fixtures";
import { installStorageShim, setWideViewport } from "@/test/jsdom-shims";
import { tauri } from "@/test/tauri-stub";

let settings = makeSettings();

function seedSessions() {
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    messages: {},
    streaming: {},
    phase: {},
    usage: {},
    parallel: {},
  });
}

beforeEach(() => {
  installStorageShim();
  setWideViewport();
  tauri.reset();
  seedSessions();
  useUiStore.setState({ sidebarCollapsed: false, inspectorOpen: false, inspectorTab: "log" });
  settings = makeSettings();

  tauri.on("settings_get", () => settings);
  tauri.on("settings_update", a => (a as { settings: unknown }).settings);
  tauri.on("session_list", () => [
    SESSION_FIXTURE,
    { ...SESSION_FIXTURE, id: "s-2", title: "排查 CI flaky", pinned: true },
  ]);
  tauri.on("session_create", () => ({
    ...SESSION_FIXTURE,
    id: "s-new",
    title: "新会话",
    message_count: 0,
    pinned: false,
  }));
  tauri.on("session_load_messages", () => []);
  tauri.on("session_save_messages", () => null);
  tauri.on("provider_list", () => []);
  tauri.on("workspace_get", () => ({ path: "D:/demo", name: "demo", exists: true, active: true }));
  tauri.on("workspace_git_branch", () => "main");
  tauri.on("workspace_recent", () => []);
  tauri.on("github_auth_status", () => ({ state: "signed_out", user: null }));
  tauri.on("file_list", () => []);
  tauri.on("list_slash_commands", () => []);
  tauri.on("subagent_list", () => []);
  tauri.on("workspace_search", () => []);
  tauri.on("session_search", () => []);
});

afterEach(cleanup);

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(screen.getByText("重构登录页")).toBeTruthy());
}

/** 命令面板本体；侧边栏也有同名按钮，必须限定作用域才能定位面板条目。 */
function palette(): HTMLElement {
  const el = document.querySelector(".glass-panel");
  if (!el) throw new Error("命令面板未渲染");
  return el as HTMLElement;
}

describe("外壳装配", () => {
  it("标题栏 / 侧边栏 / 状态栏就位，未选中会话时展示起始页而非输入框", async () => {
    await renderApp();
    expect(screen.getByText("Wide Thought Host")).toBeTruthy();
    expect(screen.getByText("你今天想做点什么？")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/输入消息/)).toBeNull();
    expect(screen.getByTitle("工作区").textContent).toContain("demo");
    expect(screen.getByText("就绪")).toBeTruthy();
    expect(screen.getByText("未登录")).toBeTruthy();
    expect(screen.getByText("重构登录页")).toBeTruthy();
    expect(screen.getByText("排查 CI flaky")).toBeTruthy();
  });

  it("点侧边栏会话后切到对话视图并激活该会话", async () => {
    await renderApp();
    fireEvent.click(screen.getByText("重构登录页"));
    await waitFor(() => expect(screen.getByPlaceholderText(/输入消息/)).toBeTruthy());
    expect(useChatStore.getState().activeSessionId).toBe(SESSION_FIXTURE.id);
  });

  it("侧边栏按后端返回的排序渲染，而不是按插入顺序", async () => {
    await renderApp();
    const titles = screen
      .getAllByText(/重构登录页|排查 CI flaky/)
      .map(el => el.textContent)
      .filter((v, i, arr) => v && arr.indexOf(v) === i);
    // s-2 置顶，必须排在前面
    expect(titles[0]).toBe("排查 CI flaky");
  });

  it("未加载到会话时不会崩，标题栏显示占位文案", async () => {
    tauri.on("session_list", () => []);
    render(<App />);
    await waitFor(() => expect(screen.getByText("Wide Thought Host")).toBeTruthy());
    expect(screen.getByText("开始新的任务")).toBeTruthy();
  });
});

describe("快捷键与命令面板", () => {
  it("Ctrl+K 打开命令面板，Escape 关闭", async () => {
    await renderApp();
    expect(screen.queryByPlaceholderText("搜索会话或执行命令…")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("搜索会话或执行命令…")).toBeTruthy();
    expect(within(palette()).getByText("新建会话")).toBeTruthy();
    expect(within(palette()).getByText("打开设置")).toBeTruthy();

    fireEvent.keyDown(screen.getByPlaceholderText("搜索会话或执行命令…"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("搜索会话或执行命令…")).toBeNull());
  });

  it("命令面板按输入过滤，无匹配时给出明确空态", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText("搜索会话或执行命令…");
    fireEvent.change(input, { target: { value: "zzz-nothing" } });
    expect(screen.getByText("没有匹配结果")).toBeTruthy();
  });

  it("Ctrl+K 是开关：再按一次收起面板", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.queryByPlaceholderText("搜索会话或执行命令…")).toBeNull());
  });

  it("Ctrl+, 打开设置弹窗", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await waitFor(() => expect(document.querySelector(".settings-modal")).toBeTruthy());
    // 弹窗内容确实挂载了，而不是只出现一个空壳
    expect(screen.getByText("控制桌面行为、语言与终端。")).toBeTruthy();
  });

  it("Ctrl+D 在明暗主题间切换并写到根元素 class 上", async () => {
    await renderApp();
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("设置里的自定义快捷键生效，默认组合让位", async () => {
    settings = makeSettings({ shortcuts: { command_palette: "Ctrl+Shift+P" } });
    await renderApp();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByPlaceholderText("搜索会话或执行命令…")).toBeNull();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    expect(screen.getByPlaceholderText("搜索会话或执行命令…")).toBeTruthy();
  });
});

describe("原生菜单事件接线", () => {
  it("menu:new-session 触发 session_create 并把新会话设为激活", async () => {
    await renderApp();
    tauri.emit("menu:new-session", null);
    await waitFor(() => expect(tauri.count("session_create")).toBe(1));
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe("s-new"));
  });

  it("menu:open-session 携带会话 id 时直接切换激活会话", async () => {
    await renderApp();
    tauri.emit("menu:open-session", "s-2");
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe("s-2"));
  });

  it("menu:open-session 空 payload 不动当前会话（避免切到空白屏）", async () => {
    await renderApp();
    useChatStore.getState().setActiveSession("s-1");
    tauri.emit("menu:open-session", "");
    await new Promise(r => setTimeout(r, 0));
    expect(useChatStore.getState().activeSessionId).toBe("s-1");
  });

  it("menu:quick-ask 打开快捷提问输入框", async () => {
    await renderApp();
    expect(screen.queryByPlaceholderText("输入问题，回车发送（将在新会话中执行）")).toBeNull();
    tauri.emit("menu:quick-ask", null);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("输入问题，回车发送（将在新会话中执行）")).toBeTruthy(),
    );
  });
});

describe("错误边界", () => {
  function Boom(): never {
    throw new Error("组件内部炸了");
  }

  it("子树抛错时渲染可见的错误界面而不是白屏", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expect(spy).toHaveBeenCalled();
      expect(screen.getByText("出现了一些问题")).toBeTruthy();
      expect(screen.getByText("组件内部炸了")).toBeTruthy();
      expect(document.body.textContent).not.toBe("");
    } finally {
      spy.mockRestore();
    }
  });

  it("点「重试」清除错误态并重新渲染子树", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let fail = true;
      function Flaky() {
        if (fail) throw new Error("暂时失败");
        return <span>恢复了</span>;
      }
      const { rerender } = render(
        <ErrorBoundary>
          <Flaky />
        </ErrorBoundary>,
      );
      expect(screen.getByText("出现了一些问题")).toBeTruthy();
      fail = false;
      fireEvent.click(screen.getByRole("button", { name: /重试/ }));
      rerender(
        <ErrorBoundary>
          <Flaky />
        </ErrorBoundary>,
      );
      expect(screen.getByText("恢复了")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("健康子树不受边界影响", () => {
    render(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeTruthy();
    expect(screen.queryByText("出现了一些问题")).toBeNull();
  });
});
