// @vitest-environment jsdom
// ChatView 冒烟测试 —— 重点是产品硬要求：高危工具的「确认执行 / 拒绝」不得被折叠进
// 工具卡片里，必须直接外露在对话流中；以及 Diff 审查入口确实能把差异送到 DiffModal。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatView } from "@/components/chat/ChatView";
import type { ChatMessage } from "@/stores/chat";
import { useChatStore } from "@/stores/chat";
import { useWorkbenchStore } from "@/stores/workbench";
import { makeSettings } from "@/test/fixtures";
import { installStorageShim, setWideViewport } from "@/test/jsdom-shims";
import { tauri } from "@/test/tauri-stub";

const SESSION = "s-1";

function message(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: "assistant",
    content: "",
    timestamp: "2026-09-02T00:00:00Z",
    ...partial,
  };
}

function seedChat(msgs: ChatMessage[]) {
  useChatStore.setState({
    activeSessionId: SESSION,
    messages: { [SESSION]: msgs },
    streaming: { [SESSION]: false },
    phase: {},
    usage: {},
  });
}

function approveCall() {
  return screen.queryByRole("button", { name: "确认执行" });
}

function denyCall() {
  return screen.queryByRole("button", { name: "拒绝" });
}

/** 步骤卡（StepProgressCard）的折叠开关，按标题文案定位。 */
function stepCardToggle(): HTMLElement {
  const label = screen.queryByText(/^正在执行步骤|^任务完成 ·/);
  if (!label) throw new Error("找不到工具调用步骤卡");
  const btn = label.closest("button");
  if (!btn) throw new Error("步骤卡标题不在可点击的折叠按钮内");
  return btn;
}

beforeEach(() => {
  installStorageShim();
  setWideViewport();
  tauri.reset();
  useWorkbenchStore.setState({
    diffModal: null,
    openFiles: [],
    activeFile: null,
    editorVisible: false,
  });
  tauri.on("settings_get", () => makeSettings());
  tauri.on("settings_update", a => (a as { settings: unknown }).settings);
  tauri.on("workspace_get", () => ({ path: "D:/p", name: "p", exists: true, active: true }));
  tauri.on("workspace_git_branch", () => "main");
  tauri.on("list_slash_commands", () => []);
  tauri.on("subagent_list", () => []);
  tauri.on("session_list", () => []);
  tauri.on("file_list", () => []);
  tauri.on("workspace_search", () => []);
  tauri.on("agent_approve_tool", () => null);
  tauri.on("agent_deny_tool", () => null);
  tauri.on("agent_abort", () => null);
  tauri.on("agent_send", () => null);
  tauri.on("session_save_messages", () => null);
});

afterEach(cleanup);

describe("消息流渲染", () => {
  it("按顺序渲染用户与助手消息，助手正文按 Markdown 解析", () => {
    seedChat([
      message({ id: "m1", role: "user", content: "把登录页迁移到 zustand" }),
      message({
        id: "m2",
        role: "assistant",
        content: "先看**当前实现**，再分三步迁移。",
      }),
    ]);
    render(<ChatView sessionTitle="重构登录页" />);
    expect(screen.getByText("把登录页迁移到 zustand")).toBeTruthy();
    const strong = screen.getByText("当前实现");
    expect(strong.tagName).toBe("STRONG");
  });

  it("系统事件与思考占位各自有独立呈现", () => {
    seedChat([
      message({ id: "m1", role: "system", content: "已连接到工作区" }),
      message({ id: "m2", role: "assistant", content: "模型正在思考…" }),
    ]);
    render(<ChatView />);
    expect(screen.getByText("已连接到工作区")).toBeTruthy();
    expect(screen.getByText("模型正在思考…")).toBeTruthy();
  });

  it("代码块走本地语法高亮，不产生额外网络请求", () => {
    seedChat([
      message({ id: "m1", role: "assistant", content: "```ts\nconst a: number = 1;\n```" }),
    ]);
    render(<ChatView />);
    expect(document.querySelector("pre")).toBeTruthy();
    expect(
      document.querySelectorAll("[class*='token'], [class*='language-']").length,
    ).toBeGreaterThan(0);
    expect(tauri.all().some(c => /^https?:/.test(c.cmd))).toBe(false);
  });
});

describe("工具调用卡片", () => {
  it("已完成的调用收进步骤卡，展开前不渲染明细", () => {
    seedChat([
      message({
        id: "m1",
        role: "assistant",
        content: "已读取文件。",
        tool_calls: [
          {
            id: "t1",
            name: "read_file",
            arguments: { path: "a.ts" },
            result: "ok",
            status: "done",
          },
        ],
      }),
    ]);
    render(<ChatView />);
    expect(screen.getByText("任务完成 · 1 个步骤")).toBeTruthy();
    expect(screen.queryByText("read_file")).toBeNull();
    fireEvent.click(stepCardToggle());
    expect(screen.getByText("read_file")).toBeTruthy();
  });

  it("待确认的调用把工具名与命令摘要直接外露", () => {
    seedChat([
      message({
        id: "m1",
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "t1",
            name: "bash",
            arguments: { command: "rm -rf ./target" },
            status: "pending",
            needsApproval: true,
          },
        ],
      }),
    ]);
    render(<ChatView />);
    expect(screen.getByText("高危操作待确认 ·", { exact: false })).toBeTruthy();
    // 用户必须能在批准前看到真正要执行的命令，且命令与审批按钮处于同一个外露区块
    const approvalBlock = (approveCall() as HTMLElement).closest('[class*="border-t"]');
    expect(approvalBlock?.textContent).toContain("rm -rf ./target");
    expect(screen.getByText("等待确认")).toBeTruthy();
  });
});

describe("审批控件（产品硬要求：不得折叠）", () => {
  function seedPending() {
    seedChat([
      message({
        id: "m1",
        role: "assistant",
        content: "需要执行命令。",
        tool_calls: [
          {
            id: "t1",
            name: "bash",
            arguments: { command: "rm -rf ./target" },
            status: "pending",
            needsApproval: true,
          },
        ],
      }),
    ]);
  }

  it("步骤卡处于折叠态时，确认/拒绝按钮依然在 DOM 中且可点", () => {
    seedPending();
    render(<ChatView />);
    const approve = approveCall();
    const deny = denyCall();
    expect(approve).toBeTruthy();
    expect(deny).toBeTruthy();
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    // 折叠区内才有的「参数」明细此时不应出现，证明审批区不在折叠块里
    expect(screen.queryByText("参数")).toBeNull();
  });

  it("确认执行 → agent_approve_tool(sessionId, toolCallId)，卡片转入执行中", async () => {
    seedPending();
    render(<ChatView />);
    fireEvent.click(approveCall() as HTMLElement);
    await waitFor(() => expect(tauri.count("agent_approve_tool")).toBe(1));
    expect(tauri.last("agent_approve_tool")?.args).toEqual({
      sessionId: SESSION,
      toolCallId: "t1",
    });
    await waitFor(() =>
      expect(useChatStore.getState().messages[SESSION][0].tool_calls?.[0].status).toBe("running"),
    );
    expect(approveCall()).toBeNull();
  });

  it("拒绝 → agent_deny_tool 并在 store 里落一条 denied 结果，审批区消失", async () => {
    seedPending();
    render(<ChatView />);
    fireEvent.click(denyCall() as HTMLElement);
    await waitFor(() => expect(tauri.count("agent_deny_tool")).toBe(1));
    expect(tauri.last("agent_deny_tool")?.args).toEqual({ sessionId: SESSION, toolCallId: "t1" });
    await waitFor(() => expect(approveCall()).toBeNull());
    const call = useChatStore.getState().messages[SESSION][0].tool_calls?.[0];
    expect(call?.status).toBe("done");
    expect(call?.result).toEqual({ denied: true, message: "用户拒绝了该操作" });
  });

  it("后端批准失败时审批控件仍在原位，可以重试（不能把按钮吞掉）", async () => {
    tauri.on("agent_approve_tool", () => Promise.reject(new Error("会话已结束")));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      seedPending();
      render(<ChatView />);
      fireEvent.click(approveCall() as HTMLElement);
      await waitFor(() => expect(tauri.count("agent_approve_tool")).toBe(1));
      await waitFor(() => expect(approveCall()).toBeTruthy());
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = original;
    }
  });

  it("同一轮多个待确认调用各自独立暴露一组按钮", () => {
    seedChat([
      message({
        id: "m1",
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "t1", name: "bash", arguments: { command: "ls" }, status: "pending" },
          { id: "t2", name: "file_delete", arguments: { path: "x" }, status: "pending" },
        ],
      }),
    ]);
    render(<ChatView />);
    expect(screen.getAllByRole("button", { name: "确认执行" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "拒绝" })).toHaveLength(2);
  });
});

describe("Diff 审查入口", () => {
  it("展开工具结果后出现「查看 Diff / 撤销」，点击把差异写入工作台 store", () => {
    seedChat([
      message({
        id: "m1",
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "t1",
            name: "edit_file",
            arguments: { path: "src/a.ts" },
            status: "done",
            result: { path: "src/a.ts", before_full: "const a = 1;", after_full: "const a = 2;" },
          },
        ],
      }),
    ]);
    render(<ChatView />);
    fireEvent.click(stepCardToggle());
    const card = screen.getByText("edit_file");
    fireEvent.click(card.closest("button") as HTMLElement);
    const openDiff = screen.getByText("查看 Diff / 撤销");
    fireEvent.click(openDiff);
    expect(useWorkbenchStore.getState().diffModal).toEqual({
      path: "src/a.ts",
      before: "const a = 1;",
      after: "const a = 2;",
    });
  });

  it("结果里没有前后全文时不提供 Diff 入口", () => {
    seedChat([
      message({
        id: "m1",
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "t1", name: "git_status", arguments: {}, status: "done", result: "clean" },
        ],
      }),
    ]);
    render(<ChatView />);
    fireEvent.click(stepCardToggle());
    fireEvent.click(screen.getByText("git_status").closest("button") as HTMLElement);
    expect(screen.queryByText("查看 Diff / 撤销")).toBeNull();
  });
});

describe("输入区", () => {
  it("空输入时发送按钮禁用，有内容后可发送并落到 agent_send", async () => {
    seedChat([]);
    render(<ChatView />);
    const send = screen.getByTitle("发送") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "你好" } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(tauri.count("agent_send")).toBe(1));
    const payload = tauri.last("agent_send")?.args as {
      message: { session_id: string; content: string };
    };
    expect(payload.message.session_id).toBe(SESSION);
    expect(payload.message.content).toBe("你好");
    const stored = useChatStore.getState().messages[SESSION];
    expect(stored.map(m => m.role)).toEqual(["user", "assistant"]);
  });

  it("生成中禁用输入并暴露中止按钮", () => {
    seedChat([message({ id: "m1", role: "assistant", content: "部分内容" })]);
    useChatStore.setState({ streaming: { [SESSION]: true } });
    render(<ChatView />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTitle("中止")).toBeTruthy();
    expect(screen.queryByTitle("发送")).toBeNull();
  });
});
