// chat store 单元测试：会话排序、消息追加/截断、并行子智能体、用量累积。
import { describe, expect, it, beforeEach } from "vitest";
import { useChatStore, THINKING_MESSAGE, type ChatMessage } from "./chat";
import type { UsageInfo } from "@/lib/ipc";

function resetStore() {
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    messages: {},
    streaming: {},
    usage: {},
    parallel: {},
  });
}

function msg(role: ChatMessage["role"], content: string, id = `${Math.random()}`): ChatMessage {
  return { id, role, content, timestamp: new Date().toISOString() };
}

beforeEach(resetStore);

describe("会话管理", () => {
  it("setSessions 按置顶优先、更新时间倒序排序", () => {
    useChatStore.getState().setSessions([
      { id: "old", title: "旧", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", message_count: 0, model: "", pinned: false },
      { id: "new", title: "新", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z", message_count: 0, model: "", pinned: false },
      { id: "pin", title: "置顶", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", message_count: 0, model: "", pinned: true },
    ]);
    const ids = useChatStore.getState().sessions.map((s) => s.id);
    expect(ids).toEqual(["pin", "new", "old"]);
  });

  it("removeSession 清理消息与激活会话", () => {
    useChatStore.getState().setSessions([
      { id: "a", title: "A", created_at: "", updated_at: "2026-01-01T00:00:00Z", message_count: 0, model: "", pinned: false },
      { id: "b", title: "B", created_at: "", updated_at: "2026-01-02T00:00:00Z", message_count: 0, model: "", pinned: false },
    ]);
    useChatStore.getState().setActiveSession("a");
    useChatStore.getState().addMessage("a", msg("user", "你好"));
    useChatStore.getState().removeSession("a");
    const state = useChatStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(state.messages["a"]).toBeUndefined();
    expect(state.activeSessionId).toBe("b");
  });
});

describe("消息流", () => {
  it("addMessage 追加消息", () => {
    useChatStore.getState().addMessage("s1", msg("user", "第一条"));
    useChatStore.getState().addMessage("s1", msg("assistant", "回复"));
    expect(useChatStore.getState().messages["s1"]).toHaveLength(2);
  });

  it("appendToLastMessage 累积增量", () => {
    useChatStore.getState().addMessage("s1", msg("user", "q"));
    useChatStore.getState().addMessage("s1", msg("assistant", ""));
    useChatStore.getState().appendToLastMessage("s1", "你好");
    useChatStore.getState().appendToLastMessage("s1", "世界");
    const last = useChatStore.getState().messages["s1"][1];
    expect(last.content).toBe("你好世界");
  });

  it("appendToLastMessage 替换思考占位符", () => {
    useChatStore.getState().addMessage("s1", msg("assistant", THINKING_MESSAGE));
    useChatStore.getState().appendToLastMessage("s1", "实际内容");
    const last = useChatStore.getState().messages["s1"][0];
    expect(last.content).toBe("实际内容");
  });

  it("finalizeAssistantMessage 仅兜底空回复", () => {
    useChatStore.getState().addMessage("s1", msg("assistant", THINKING_MESSAGE));
    useChatStore.getState().finalizeAssistantMessage("s1", "（无输出）");
    expect(useChatStore.getState().messages["s1"][0].content).toBe("（无输出）");

    resetStore();
    useChatStore.getState().addMessage("s1", msg("assistant", "已有内容"));
    useChatStore.getState().finalizeAssistantMessage("s1", "兜底");
    expect(useChatStore.getState().messages["s1"][0].content).toBe("已有内容");
  });

  it("truncateMessages 截断到指定消息之前", () => {
    useChatStore.getState().setMessages("s1", [
      msg("user", "a", "m1"),
      msg("assistant", "b", "m2"),
      msg("user", "c", "m3"),
    ]);
    useChatStore.getState().truncateMessages("s1", "m3");
    const ids = useChatStore.getState().messages["s1"].map((m) => m.id);
    expect(ids).toEqual(["m1", "m2"]);
  });
});

describe("并行子智能体", () => {
  it("registerParallelRun 初始化批次并逐项完成", () => {
    useChatStore.getState().registerParallelRun("s1", ["代码审查", "安全审查"]);
    let p = useChatStore.getState().parallel["s1"];
    expect(p.total).toBe(2);
    expect(p.done).toBe(0);

    useChatStore.getState().completeParallelRun("s1", "sub1", true, "代码审查");
    p = useChatStore.getState().parallel["s1"];
    expect(p.done).toBe(1);
    expect(p.statuses["sub1"]).toBe("done");

    useChatStore.getState().completeParallelRun("s1", "sub2", false, "安全审查");
    p = useChatStore.getState().parallel["s1"];
    expect(p.done).toBe(2);
    expect(p.statuses["sub2"]).toBe("error");
  });

  it("clearParallelRun 移除批次状态", () => {
    useChatStore.getState().registerParallelRun("s1", ["审查"]);
    useChatStore.getState().clearParallelRun("s1");
    expect(useChatStore.getState().parallel["s1"]).toBeUndefined();
  });
});

describe("用量统计", () => {
  it("addUsage 跨消息累积", () => {
    const usage: UsageInfo = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    useChatStore.getState().addUsage("s1", usage);
    useChatStore.getState().addUsage("s1", usage);
    const total = useChatStore.getState().usage["s1"];
    expect(total.total_tokens).toBe(30);
    expect(total.prompt_tokens).toBe(20);
  });
});

describe("工具调用生命周期（Q-02）", () => {
  function assistantMsg(id = "a1"): ChatMessage {
    return { id, role: "assistant", content: "", timestamp: new Date().toISOString() };
  }

  it("addToolCall 只挂在最后一条 assistant 消息上", () => {
    useChatStore.getState().setMessages("s1", [assistantMsg()]);
    useChatStore.getState().addToolCall("s1", {
      id: "t1", name: "file_read", arguments: { path: "a.rs" }, status: "running",
    });
    const last = useChatStore.getState().messages["s1"][0];
    expect(last.tool_calls).toHaveLength(1);
    expect(last.tool_calls![0].name).toBe("file_read");

    // 没有 assistant 消息时不产生副作用
    useChatStore.getState().addToolCall("s2", {
      id: "t2", name: "bash", arguments: {}, status: "running",
    });
    expect(useChatStore.getState().messages["s2"]).toBeUndefined();
  });

  it("updateToolCall 更新状态，updateToolCallResult 写入结果", () => {
    useChatStore.getState().setMessages("s1", [assistantMsg()]);
    useChatStore.getState().addToolCall("s1", {
      id: "t1", name: "file_edit", arguments: {}, status: "pending", needsApproval: true,
    });
    useChatStore.getState().updateToolCall("s1", "t1", { status: "done" });
    let tc = useChatStore.getState().messages["s1"][0].tool_calls![0];
    expect(tc.status).toBe("done");
    expect(tc.needsApproval).toBe(true);

    useChatStore.getState().updateToolCallResult("s1", "t1", { ok: true });
    tc = useChatStore.getState().messages["s1"][0].tool_calls![0];
    expect(tc.result).toEqual({ ok: true });
  });

  it("未知 toolId 的更新无副作用", () => {
    useChatStore.getState().setMessages("s1", [assistantMsg()]);
    useChatStore.getState().addToolCall("s1", {
      id: "t1", name: "git_status", arguments: {}, status: "running",
    });
    useChatStore.getState().updateToolCall("s1", "nope", { status: "done" });
    const tc = useChatStore.getState().messages["s1"][0].tool_calls![0];
    expect(tc.status).toBe("running");
  });
});

describe("消息截断（Q-02，重新生成/rewind 基础）", () => {
  it("truncateMessages 保留目标消息之前的内容", () => {
    useChatStore.getState().setMessages("s1", [
      msg("user", "第一问", "m1"),
      msg("assistant", "第一答", "m2"),
      msg("user", "第二问", "m3"),
      msg("assistant", "第二答", "m4"),
    ]);
    useChatStore.getState().truncateMessages("s1", "m3");
    const left = useChatStore.getState().messages["s1"];
    expect(left.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("truncateMessages 对不存在的消息 id 无副作用", () => {
    useChatStore.getState().setMessages("s1", [msg("user", "唯一", "m1")]);
    useChatStore.getState().truncateMessages("s1", "nope");
    expect(useChatStore.getState().messages["s1"]).toHaveLength(1);
  });
});
