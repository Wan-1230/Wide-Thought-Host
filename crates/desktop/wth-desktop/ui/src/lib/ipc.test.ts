// lib/ipc.ts 契约测试：断言每个封装函数映射到正确的 Tauri 命令名与 payload 形状。
// 红了通常意味着 Rust 侧 command 的参数被改名/新增，而前端封装忘了跟上。
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const win = {
    isMaximized: vi.fn((): Promise<boolean> => Promise.resolve(false)),
    minimize: vi.fn((): Promise<void> => Promise.resolve()),
    toggleMaximize: vi.fn((): Promise<void> => Promise.resolve()),
    close: vi.fn((): Promise<void> => Promise.resolve()),
    onResized: vi.fn(
      (_handler: (event: unknown) => void): Promise<() => void> => Promise.resolve(() => {}),
    ),
  };
  return {
    invoke: vi.fn(
      (_cmd: string, _args?: Record<string, unknown>): Promise<unknown> => Promise.resolve(null),
    ),
    listen: vi.fn(
      (_event: string, _handler: unknown): Promise<() => void> => Promise.resolve(() => {}),
    ),
    getCurrentWindow: vi.fn(() => win),
    window: win,
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: h.getCurrentWindow }));

import * as ipc from "@/lib/ipc";

// ─── 夹具 ────────────────────────────────────────────

const settings = { schema_version: 3, edit_mode: "yolo" } as ipc.DesktopSettings;

const provider: ipc.ProviderConfig = {
  id: "p1",
  name: "P",
  kind: "openai",
  base_url: "http://x",
  model: "m",
  enabled: true,
};

const mcpConfig = {
  name: "srv",
  command: "node",
  args: [] as string[],
  env: {},
  url: "",
  transport: "stdio",
  enabled: true,
};

const subagent = {
  name: "reviewer",
  description: "d",
  system_prompt: "sp",
  model: "m",
  tools: [] as string[],
  enabled: true,
};

const workflow: ipc.WorkflowConfig = { id: "w", name: "n", description: "d", nodes: [] };

const marketEntry: ipc.PluginMarketEntry = {
  name: "p",
  description: "d",
  version: "1.0.0",
  author: "a",
  download_url: "file:///x",
  sha256: "0",
  permissions: [],
  verified: true,
};

// ─── invoke 命令映射 ─────────────────────────────────

type InvokeRow = {
  name: string;
  call: () => Promise<unknown>;
  cmd: string;
  args?: unknown;
};

const invokeRows: InvokeRow[] = [
  {
    name: "agentSend",
    cmd: "agent_send",
    args: { message: { session_id: "s", content: "hi" } },
    call: () => ipc.agentSend({ session_id: "s", content: "hi" }),
  },
  {
    name: "agentAbort",
    cmd: "agent_abort",
    args: { sessionId: "s" },
    call: () => ipc.agentAbort("s"),
  },
  {
    name: "agentApproveTool",
    cmd: "agent_approve_tool",
    args: { sessionId: "s", toolCallId: "t" },
    call: () => ipc.agentApproveTool("s", "t"),
  },
  {
    name: "agentDenyTool",
    cmd: "agent_deny_tool",
    args: { sessionId: "s", toolCallId: "t" },
    call: () => ipc.agentDenyTool("s", "t"),
  },
  {
    name: "subagentRun",
    cmd: "subagent_run",
    args: { subagentId: "a", task: "t", parentSessionId: "p" },
    call: () => ipc.subagentRun("a", "t", "p"),
  },
  {
    name: "setServiceApiKey",
    cmd: "set_service_api_key",
    args: { service: "tavily", apiKey: "k" },
    call: () => ipc.setServiceApiKey("tavily", "k"),
  },
  {
    name: "clearServiceApiKey",
    cmd: "clear_service_api_key",
    args: { service: "tavily" },
    call: () => ipc.clearServiceApiKey("tavily"),
  },
  {
    name: "fileRead",
    cmd: "file_read",
    args: { args: { path: "/a" } },
    call: () => ipc.fileRead("/a"),
  },
  {
    name: "fileWrite",
    cmd: "file_write",
    args: { args: { path: "/a", content: "c" } },
    call: () => ipc.fileWrite("/a", "c"),
  },
  {
    name: "fileDelete",
    cmd: "file_delete",
    args: { path: "/a" },
    call: () => ipc.fileDelete("/a"),
  },
  {
    name: "fileList",
    cmd: "file_list",
    args: { args: { path: "/a", recursive: false } },
    call: () => ipc.fileList("/a"),
  },
  {
    name: "fileList(recursive)",
    cmd: "file_list",
    args: { args: { path: "/a", recursive: true } },
    call: () => ipc.fileList("/a", true),
  },
  {
    name: "terminalSpawn",
    cmd: "terminal_spawn",
    args: { args: null },
    call: () => ipc.terminalSpawn(),
  },
  {
    name: "terminalSpawn(args)",
    cmd: "terminal_spawn",
    args: { args: { shell: "bash", cols: 80 } },
    call: () => ipc.terminalSpawn({ shell: "bash", cols: 80 }),
  },
  {
    name: "terminalWrite",
    cmd: "terminal_write",
    args: { id: "t", data: "ls" },
    call: () => ipc.terminalWrite("t", "ls"),
  },
  {
    name: "terminalResize",
    cmd: "terminal_resize",
    args: { args: { id: "t", cols: 80, rows: 24 } },
    call: () => ipc.terminalResize("t", 80, 24),
  },
  {
    name: "terminalKill",
    cmd: "terminal_kill",
    args: { id: "t" },
    call: () => ipc.terminalKill("t"),
  },
  { name: "settingsGet", cmd: "settings_get", call: () => ipc.settingsGet() },
  {
    name: "settingsUpdate",
    cmd: "settings_update",
    args: { settings },
    call: () => ipc.settingsUpdate(settings),
  },
  { name: "providerList", cmd: "provider_list", call: () => ipc.providerList() },
  {
    name: "providerUpsert",
    cmd: "provider_upsert",
    args: { input: { ...provider, api_key: null } },
    call: () => ipc.providerUpsert(provider),
  },
  {
    name: "providerUpsert(key)",
    cmd: "provider_upsert",
    args: { input: { ...provider, api_key: "secret" } },
    call: () => ipc.providerUpsert(provider, "secret"),
  },
  {
    name: "providerDelete",
    cmd: "provider_delete",
    args: { id: "p1" },
    call: () => ipc.providerDelete("p1"),
  },
  {
    name: "providerSetDefault",
    cmd: "provider_set_default",
    args: { id: "p1" },
    call: () => ipc.providerSetDefault("p1"),
  },
  {
    name: "providerTest",
    cmd: "provider_test",
    args: { id: "p1" },
    call: () => ipc.providerTest("p1"),
  },
  { name: "metricsSummary", cmd: "metrics_summary", call: () => ipc.metricsSummary() },
  { name: "tasksListRecent", cmd: "tasks_list_recent", call: () => ipc.tasksListRecent() },
  {
    name: "localProvidersDetect",
    cmd: "local_providers_detect",
    call: () => ipc.localProvidersDetect(),
  },
  { name: "workspaceGet", cmd: "workspace_get", call: () => ipc.workspaceGet() },
  { name: "workspaceRecent", cmd: "workspace_recent", call: () => ipc.workspaceRecent() },
  {
    name: "workspaceSelect",
    cmd: "workspace_select",
    args: { path: "/w" },
    call: () => ipc.workspaceSelect("/w"),
  },
  { name: "workspaceClear", cmd: "workspace_clear", call: () => ipc.workspaceClear() },
  { name: "workspaceGitBranch", cmd: "workspace_git_branch", call: () => ipc.workspaceGitBranch() },
  { name: "githubAuthStatus", cmd: "github_auth_status", call: () => ipc.githubAuthStatus() },
  { name: "githubAuthStart", cmd: "github_auth_start", call: () => ipc.githubAuthStart() },
  { name: "githubAuthPoll", cmd: "github_auth_poll", call: () => ipc.githubAuthPoll() },
  { name: "githubAuthCancel", cmd: "github_auth_cancel", call: () => ipc.githubAuthCancel() },
  { name: "githubAuthLogout", cmd: "github_auth_logout", call: () => ipc.githubAuthLogout() },
  {
    name: "capabilityView",
    cmd: "capability_view",
    args: { kind: "skills" },
    call: () => ipc.capabilityView("skills"),
  },
  {
    name: "openPathInExplorer",
    cmd: "open_path_in_explorer",
    args: { path: "/p" },
    call: () => ipc.openPathInExplorer("/p"),
  },
  { name: "sessionList", cmd: "session_list", call: () => ipc.sessionList() },
  {
    name: "sessionCreate",
    cmd: "session_create",
    args: { args: { title: "t", model: "m" } },
    call: () => ipc.sessionCreate("t", "m"),
  },
  {
    name: "sessionDelete",
    cmd: "session_delete",
    args: { id: "s" },
    call: () => ipc.sessionDelete("s"),
  },
  {
    name: "sessionRename",
    cmd: "session_rename",
    args: { id: "s", title: "t" },
    call: () => ipc.sessionRename("s", "t"),
  },
  {
    name: "sessionSetPinned",
    cmd: "session_set_pinned",
    args: { id: "s", pinned: true },
    call: () => ipc.sessionSetPinned("s", true),
  },
  {
    name: "sessionExport",
    cmd: "session_export",
    args: { id: "s", format: "md" },
    call: () => ipc.sessionExport("s", "md"),
  },
  {
    name: "openInExplorer",
    cmd: "open_in_explorer",
    args: { path: "/p" },
    call: () => ipc.openInExplorer("/p"),
  },
  { name: "mcpListServers", cmd: "mcp_list_servers", call: () => ipc.mcpListServers() },
  {
    name: "mcpAddServer",
    cmd: "mcp_add_server",
    args: { config: mcpConfig },
    call: () => ipc.mcpAddServer(mcpConfig),
  },
  {
    name: "mcpRemoveServer",
    cmd: "mcp_remove_server",
    args: { id: "m" },
    call: () => ipc.mcpRemoveServer("m"),
  },
  {
    name: "mcpTestServer",
    cmd: "mcp_test_server",
    args: { id: "m" },
    call: () => ipc.mcpTestServer("m"),
  },
  { name: "hookList", cmd: "hook_list", call: () => ipc.hookList() },
  {
    name: "hookAdd",
    cmd: "hook_add",
    args: { config: { name: "h", trigger: "tool_before", command: "c", enabled: true } },
    call: () => ipc.hookAdd({ name: "h", trigger: "tool_before", command: "c", enabled: true }),
  },
  { name: "hookRemove", cmd: "hook_remove", args: { id: "h" }, call: () => ipc.hookRemove("h") },
  {
    name: "hookToggle",
    cmd: "hook_toggle",
    args: { id: "h", enabled: false },
    call: () => ipc.hookToggle("h", false),
  },
  { name: "subagentList", cmd: "subagent_list", call: () => ipc.subagentList() },
  {
    name: "subagentAdd",
    cmd: "subagent_add",
    args: { config: subagent },
    call: () => ipc.subagentAdd(subagent),
  },
  {
    name: "subagentRemove",
    cmd: "subagent_remove",
    args: { id: "a" },
    call: () => ipc.subagentRemove("a"),
  },
  {
    name: "subagentToggle",
    cmd: "subagent_toggle",
    args: { id: "a", enabled: true },
    call: () => ipc.subagentToggle("a", true),
  },
  { name: "diagnosticsGet", cmd: "diagnostics_get", call: () => ipc.diagnosticsGet() },
  { name: "appInfo", cmd: "app_info", call: () => ipc.appInfo() },
  {
    name: "pluginImport",
    cmd: "plugin_import",
    args: { sourceDir: "/d" },
    call: () => ipc.pluginImport("/d"),
  },
  {
    name: "pluginMarketList",
    cmd: "plugin_market_list",
    args: { source: "official" },
    call: () => ipc.pluginMarketList("official"),
  },
  {
    name: "pluginMarketInstall",
    cmd: "plugin_market_install",
    args: { entry: marketEntry },
    call: () => ipc.pluginMarketInstall(marketEntry),
  },
  {
    name: "pluginUninstall",
    cmd: "plugin_uninstall",
    args: { name: "p" },
    call: () => ipc.pluginUninstall("p"),
  },
  { name: "updateCheck", cmd: "update_check", call: () => ipc.updateCheck() },
  { name: "updateDownload", cmd: "update_download", call: () => ipc.updateDownload() },
  {
    name: "workspaceSearch",
    cmd: "workspace_search",
    args: { query: "q", limit: 10 },
    call: () => ipc.workspaceSearch("q", 10),
  },
  {
    name: "workspaceIndexStatus",
    cmd: "workspace_index_status",
    call: () => ipc.workspaceIndexStatus(),
  },
  {
    name: "workspaceIndexRebuild",
    cmd: "workspace_index_rebuild",
    call: () => ipc.workspaceIndexRebuild(),
  },
  {
    name: "workspaceIndexClear",
    cmd: "workspace_index_clear",
    call: () => ipc.workspaceIndexClear(),
  },
  { name: "memoryList", cmd: "memory_list", call: () => ipc.memoryList() },
  {
    name: "memoryWrite",
    cmd: "memory_write",
    args: { title: "t", content: "c", tags: ["x"], scope: "workspace" },
    call: () => ipc.memoryWrite("t", "c", ["x"], "workspace"),
  },
  {
    name: "memoryDelete",
    cmd: "memory_delete",
    args: { id: "m" },
    call: () => ipc.memoryDelete("m"),
  },
  { name: "headroomStatus", cmd: "headroom_status", call: () => ipc.headroomStatus() },
  {
    name: "headroomIsInstalled",
    cmd: "headroom_is_installed",
    call: () => ipc.headroomIsInstalled(),
  },
  {
    name: "headroomStart",
    cmd: "headroom_start",
    args: { port: 8787 },
    call: () => ipc.headroomStart(8787),
  },
  { name: "headroomStop", cmd: "headroom_stop", call: () => ipc.headroomStop() },
  { name: "headroomInstall", cmd: "headroom_install", call: () => ipc.headroomInstall() },
  { name: "listSlashCommands", cmd: "list_slash_commands", call: () => ipc.listSlashCommands() },
  {
    name: "resolveSkill",
    cmd: "resolve_skill",
    args: { name: "s" },
    call: () => ipc.resolveSkill("s"),
  },
  {
    name: "backupCreate",
    cmd: "backup_create",
    args: { targetPath: "/b" },
    call: () => ipc.backupCreate("/b"),
  },
  {
    name: "backupRestore",
    cmd: "backup_restore",
    args: { sourcePath: "/b" },
    call: () => ipc.backupRestore("/b"),
  },
  {
    name: "configExport",
    cmd: "config_export",
    args: { targetPath: "/c" },
    call: () => ipc.configExport("/c"),
  },
  {
    name: "configImport",
    cmd: "config_import",
    args: { sourcePath: "/c" },
    call: () => ipc.configImport("/c"),
  },
  {
    name: "sessionSaveMessages",
    cmd: "session_save_messages",
    args: { id: "s", messages: [1, 2] },
    call: () => ipc.sessionSaveMessages("s", [1, 2]),
  },
  {
    name: "sessionLoadMessages",
    cmd: "session_load_messages",
    args: { id: "s" },
    call: () => ipc.sessionLoadMessages("s"),
  },
  { name: "logList", cmd: "log_list", call: () => ipc.logList() },
  { name: "workflowList", cmd: "workflow_list", call: () => ipc.workflowList() },
  {
    name: "workflowSave",
    cmd: "workflow_save",
    args: { config: workflow },
    call: () => ipc.workflowSave(workflow),
  },
  {
    name: "workflowDelete",
    cmd: "workflow_delete",
    args: { id: "w" },
    call: () => ipc.workflowDelete("w"),
  },
  {
    name: "workflowRun",
    cmd: "workflow_run",
    args: { configId: "w", input: "i" },
    call: () => ipc.workflowRun("w", "i"),
  },
  {
    name: "workflowValidate",
    cmd: "workflow_validate",
    args: { configId: "w" },
    call: () => ipc.workflowValidate("w"),
  },
  {
    name: "teamConfigExport",
    cmd: "team_config_export",
    args: { targetPath: "/t" },
    call: () => ipc.teamConfigExport("/t"),
  },
  {
    name: "teamConfigImport",
    cmd: "team_config_import",
    args: { sourcePath: "/t" },
    call: () => ipc.teamConfigImport("/t"),
  },
  {
    name: "sessionSearch",
    cmd: "session_search",
    args: { query: "q", limit: 5 },
    call: () => ipc.sessionSearch("q", 5),
  },
];

/** 取出最后一次 listen() 注册的处理器，用于手工投递一条后端事件。 */
function lastListenHandler(): (event: { payload: unknown }) => void {
  const call = h.listen.mock.calls[h.listen.mock.calls.length - 1];
  if (!call) throw new Error("没有任何 listen() 调用被记录");
  return call[1] as (event: { payload: unknown }) => void;
}

describe("invoke 命令映射", () => {
  beforeEach(() => {
    h.invoke.mockClear();
    h.listen.mockClear();
  });

  for (const row of invokeRows) {
    it(`${row.name}() → invoke("${row.cmd}")`, async () => {
      await row.call();
      expect(h.invoke).toHaveBeenCalledTimes(1);
      if (row.args === undefined) {
        expect(h.invoke).toHaveBeenCalledWith(row.cmd);
      } else {
        expect(h.invoke).toHaveBeenCalledWith(row.cmd, row.args);
      }
    });
  }

  it("settingsUpdate 原样透传整个 settings 对象（不裁剪字段）", async () => {
    await ipc.settingsUpdate(settings);
    const payload = h.invoke.mock.calls[0]?.[1] as { settings: unknown };
    expect(payload.settings).toBe(settings);
  });
});

// ─── 事件订阅 ────────────────────────────────────────

/** 所有事件回调 payload 的联合，让表格能把同一个 cb 传给不同监听器。 */
type AnyEventPayload =
  | ipc.StreamChunk
  | ipc.SubagentResultEvent
  | ipc.ApprovalEvent
  | { id: string; data: string }
  | ipc.TerminalExit
  | ipc.WorkflowProgressEvent
  | ipc.WorkflowDoneEvent
  | ipc.UpdateProgress;

type ListenRow = {
  name: string;
  event: string;
  payload: AnyEventPayload;
  register: (cb: (payload: AnyEventPayload) => void) => Promise<unknown>;
};

const listenRows: ListenRow[] = [
  {
    name: "onAgentStream",
    event: "agent:stream",
    payload: { session_id: "s", type: "text_delta", delta: "x" },
    register: cb => ipc.onAgentStream(cb),
  },
  {
    name: "onSubagentResult",
    event: "agent:subagent_result",
    payload: {
      parent_session_id: "p",
      sub_session_id: "s",
      subagent_name: "n",
      status: "done",
    },
    register: cb => ipc.onSubagentResult(cb),
  },
  {
    name: "onAgentApproval",
    event: "agent:approval",
    payload: { session_id: "s", tool_id: "t", tool_name: "bash", arguments: {} },
    register: cb => ipc.onAgentApproval(cb),
  },
  {
    name: "onTerminalData",
    event: "terminal:data",
    payload: { id: "t", data: "out" },
    register: cb => ipc.onTerminalData(cb),
  },
  {
    name: "onTerminalExit",
    event: "terminal:exit",
    payload: { id: "t" },
    register: cb => ipc.onTerminalExit(cb),
  },
  {
    name: "onWorkflowProgress",
    event: "workflow:progress",
    payload: {
      run_id: "r",
      config_id: "c",
      node_id: "n",
      node_name: "x",
      status: "ok",
      error: "",
    },
    register: cb => ipc.onWorkflowProgress(cb),
  },
  {
    name: "onWorkflowDone",
    event: "workflow:done",
    payload: { run_id: "r", config_id: "c", config_name: "n", status: "ok", results: [] },
    register: cb => ipc.onWorkflowDone(cb),
  },
  {
    name: "onUpdateProgress",
    event: "update:progress",
    payload: { received: 1, total: 2, percent: 50 },
    register: cb => ipc.onUpdateProgress(cb),
  },
];

describe("事件订阅", () => {
  beforeEach(() => {
    h.listen.mockClear();
    h.window.onResized.mockClear();
  });

  for (const row of listenRows) {
    it(`${row.name} 订阅 ${row.event} 并把 payload 交给回调`, async () => {
      const cb = vi.fn();
      const pending = row.register(cb);
      expect(h.listen).toHaveBeenCalledWith(row.event, expect.any(Function));
      lastListenHandler()({ payload: row.payload });
      expect(cb).toHaveBeenCalledWith(row.payload);
      await expect(pending).resolves.toBeInstanceOf(Function);
    });
  }

  it("onMenuNewSession / onMenuQuickAsk 只转发信号，不读 payload", async () => {
    const newSession = vi.fn();
    const quickAsk = vi.fn();

    await ipc.onMenuNewSession(newSession);
    expect(h.listen).toHaveBeenLastCalledWith("menu:new-session", expect.any(Function));
    lastListenHandler()({ payload: null });
    expect(newSession).toHaveBeenCalledTimes(1);

    await ipc.onMenuQuickAsk(quickAsk);
    expect(h.listen).toHaveBeenLastCalledWith("menu:quick-ask", expect.any(Function));
    lastListenHandler()({ payload: null });
    expect(quickAsk).toHaveBeenCalledTimes(1);
  });

  it("onMenuOpenSession 把会话 id 作为字符串交给回调", async () => {
    const cb = vi.fn();
    await ipc.onMenuOpenSession(cb);
    expect(h.listen).toHaveBeenCalledWith("menu:open-session", expect.any(Function));
    lastListenHandler()({ payload: "s-9" });
    expect(cb).toHaveBeenCalledWith("s-9");
  });

  it("onWindowResized 走 Window.onResized 且回调不接收尺寸参数", async () => {
    const cb = vi.fn();
    await ipc.onWindowResized(cb);
    expect(h.window.onResized).toHaveBeenCalledWith(expect.any(Function));
    const resizeCalls = h.window.onResized.mock.calls;
    const handler = resizeCalls[resizeCalls.length - 1]?.[0];
    handler({ payload: { width: 100, height: 50 } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]).toHaveLength(0);
  });
});

// ─── 窗口控制 ────────────────────────────────────────

describe("窗口控制", () => {
  it("四个窗口动作各自路由到 Window 的对应方法", async () => {
    await ipc.windowIsMaximized();
    expect(h.window.isMaximized).toHaveBeenCalledTimes(1);
    await ipc.windowMinimize();
    expect(h.window.minimize).toHaveBeenCalledTimes(1);
    await ipc.windowToggleMaximize();
    expect(h.window.toggleMaximize).toHaveBeenCalledTimes(1);
    await ipc.windowClose();
    expect(h.window.close).toHaveBeenCalledTimes(1);
  });

  it("每次调用都重新解析当前窗口（不缓存 Window 实例）", async () => {
    h.getCurrentWindow.mockClear();
    await ipc.windowMinimize();
    await ipc.windowClose();
    expect(h.getCurrentWindow).toHaveBeenCalledTimes(2);
  });
});

// ─── 完整性护栏 ──────────────────────────────────────

describe("封装层完整性", () => {
  it("ipc.ts 的每个运行时导出都被本契约测试覆盖", () => {
    const covered = new Set<string>([
      ...invokeRows.map(r => r.name.replace(/\(.*$/, "")),
      ...listenRows.map(r => r.name),
      "onMenuNewSession",
      "onMenuQuickAsk",
      "onMenuOpenSession",
      "onWindowResized",
      "windowIsMaximized",
      "windowMinimize",
      "windowToggleMaximize",
      "windowClose",
    ]);
    const exported = Object.keys(ipc).filter(
      k => typeof (ipc as unknown as Record<string, unknown>)[k] === "function",
    );
    expect(exported.filter(k => !covered.has(k))).toEqual([]);
  });
});
