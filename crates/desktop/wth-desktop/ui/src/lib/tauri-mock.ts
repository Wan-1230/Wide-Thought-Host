// 浏览器预览模式 —— 仅在非 Tauri 环境（`npm run dev` 直接在浏览器打开）下安装
// 一个最小化的 __TAURI_INTERNALS__ 垫片，让 UI 可以脱离桌面壳完整渲染，
// 便于前端开发与视觉走查。真实 Tauri 环境中此模块不产生任何副作用。

type MockSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  model: string;
  pinned?: boolean;
};

const now = () => new Date().toISOString();

const MOCK_SETTINGS = {
  schema_version: 3,
  language: "zh-CN",
  close_action: "tray",
  sound_enabled: false,
  theme: "light",
  font_scale: "medium",
  font_family: "sans",
  custom_font_family: null,
  session_display: "standard",
  terminal_shell: null,
  active_workspace: "D:\\demo-project",
  recent_workspaces: [],
  default_provider_id: "openai-demo",
  providers: [],
  feature_toggles: {},
  legacy_migration_complete: true,
  github_user: null,
  reasoning_effort: "medium",
  edit_mode: "review",
  budget_usd: null,
  show_system_events: false,
  web_search_engine: "google",
  headroom_enabled: false,
  headroom_port: 8787,
  context_compression: true,
  context_window_tokens: 128000,
  compaction_ratio_percent: 70,
  price_per_million_tokens: 0,
  price_per_million_output_tokens: null,
  usage_stats: {
    total_tokens: 0,
    total_cost_usd: 0,
    today_tokens: 0,
    today_cost_usd: 0,
    week_tokens: 0,
    week_cost_usd: 0,
    last_updated: null,
  },
  subagents: [],
  shortcuts: {},
  onboarding_completed: true,
  prompt_templates: [],
  workflows: [],
  network: { proxy_mode: "off", proxy_url: null, request_timeout_secs: 120, retry_enabled: true, retry_max: 2 },
};

const MOCK_SESSIONS: MockSession[] = [
  {
    id: "demo-1",
    title: "重构登录页面的状态管理",
    created_at: now(),
    updated_at: now(),
    message_count: 6,
    model: "grok-4",
    pinned: true,
  },
  {
    id: "demo-2",
    title: "排查 CI 中 flaky 的 e2e 用例",
    created_at: now(),
    updated_at: now(),
    message_count: 12,
    model: "grok-4",
  },
  {
    id: "demo-3",
    title: "为 token-estimation 补充基准测试",
    created_at: now(),
    updated_at: now(),
    message_count: 4,
    model: "grok-4-mini",
  },
];

const MOCK_DEMO_MESSAGES = [
  {
    id: "m1",
    role: "user",
    content: "帮我把登录页的表单状态从 useState 迁移到 zustand，注意保留错误提示逻辑。",
    timestamp: now(),
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "我先看一下当前的登录页实现，然后分三步迁移：\n\n1. 新建 `authStore`，承载 `username` / `password` / `error` 三个字段\n2. 表单组件改为订阅 store，提交逻辑保持不变\n3. 回归错误提示路径\n\n**第一步**：创建 store：",
    timestamp: now(),
    tool_calls: [
      {
        id: "t1",
        name: "read_file",
        arguments: { path: "src/pages/Login.tsx" },
        status: "done",
        result: "ok",
      },
      {
        id: "t2",
        name: "write_file",
        arguments: { path: "src/stores/auth.ts" },
        status: "done",
        result: "已写入 42 行",
      },
    ],
  },
  {
    id: "m3",
    role: "user",
    content: "看起来不错，提交吧。",
    timestamp: now(),
  },
  {
    id: "m4",
    role: "assistant",
    content: "已完成提交 `a1b2c3d`，并同步更新了对应单测。✅",
    timestamp: now(),
  },
];

const MOCK_FILE_TREE = [
  { name: "src", path: "D:\\demo-project\\src", is_dir: true, size: 0, children: [
    { name: "App.tsx", path: "D:\\demo-project\\src\\App.tsx", is_dir: false, size: 4096 },
    { name: "main.tsx", path: "D:\\demo-project\\src\\main.tsx", is_dir: false, size: 512 },
    { name: "components", path: "D:\\demo-project\\src\\components", is_dir: true, size: 0, children: [
      { name: "Button.tsx", path: "D:\\demo-project\\src\\components\\Button.tsx", is_dir: false, size: 2048 },
    ] },
  ] },
  { name: "package.json", path: "D:\\demo-project\\package.json", is_dir: false, size: 1024 },
  { name: "README.md", path: "D:\\demo-project\\README.md", is_dir: false, size: 2048 },
];

const MOCK_PROVIDERS = [
  {
    id: "agnes-default",
    name: "Agnes AI (内置)",
    kind: "openai-compatible",
    base_url: "https://api.agnes-ai.cn/v1",
    model: "agnes-3.0-flash",
    enabled: true,
    builtin: true,
    has_api_key: true,
    is_default: true,
  },
  {
    id: "openai-demo",
    name: "OpenAI",
    kind: "openai",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o",
    enabled: true,
    has_api_key: true,
    is_default: false,
  },
  {
    id: "local-ollama",
    name: "Ollama（本地）",
    kind: "openai",
    base_url: "http://localhost:11434/v1",
    model: "qwen2.5:14b",
    enabled: true,
    local: true,
    has_api_key: false,
    is_default: false,
  },
];

// ── 事件回放：让浏览器预览里聊天流式可见 ─────────────────
// listen() 经由 plugin:event|listen 注册，handler 是 transformCallback 返回的 id。
const callbacks = new Map<number, (event: unknown) => void>();
const eventHandlers = new Map<string, number[]>();
const listenIdToHandler = new Map<number, number>();
let nextEventSeq = 1;

function emitEvent(name: string, payload: unknown) {
  const ids = eventHandlers.get(name) ?? [];
  for (const id of ids) {
    const cb = callbacks.get(id);
    if (cb) cb({ event: name, id: nextEventSeq++, payload });
  }
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** 模拟一轮真实 Agent 回复：工具调用卡 + Markdown 流式正文 + 用量。 */
async function simulateReply(sessionId: string, question: string) {
  await sleep(500);
  const toolId = `mock-t-${Date.now()}`;
  emitEvent("agent:stream", {
    session_id: sessionId,
    type: "tool_call_start",
    tool_id: toolId,
    tool_name: "read_file",
    arguments: { path: "src/main.tsx" },
    needs_approval: false,
  });
  await sleep(700);
  emitEvent("agent:stream", {
    session_id: sessionId,
    type: "tool_call_end",
    tool_id: toolId,
    result: "// 浏览器预览模式：模拟工具结果\nexport const demo = 1;",
  });
  await sleep(300);
  const reply = [
    `收到，关于「${question.slice(0, 40)}」：`,
    "",
    "这是一条**浏览器预览模式的模拟回复**，用于走查流式渲染：",
    "",
    "1. 工具调用卡片（上方）带状态图标与参数摘要",
    "2. 正文支持 Markdown 列表、`行内代码` 与代码块",
    "3. 流式光标会跟随正文末尾，结束时消失",
    "",
    "```rust",
    "fn main() {",
    "    println!(\"Wide Thought Host\");",
    "}",
    "```",
    "",
    "在真实桌面应用中，这里将由 wth 内核逐 token 回传。",
  ].join("\n");
  const chunkSize = 24;
  for (let i = 0; i < reply.length; i += chunkSize) {
    emitEvent("agent:stream", {
      session_id: sessionId,
      type: "text_delta",
      delta: reply.slice(i, i + chunkSize),
    });
    await sleep(28);
  }
  emitEvent("agent:stream", {
    session_id: sessionId,
    type: "done",
    usage: { prompt_tokens: 128, completion_tokens: 256, total_tokens: 384 },
  });
}

function mockInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "settings_get":
      return Promise.resolve(MOCK_SETTINGS);
    case "settings_update":
      return Promise.resolve(args?.settings ?? MOCK_SETTINGS);
    case "session_list":
      return Promise.resolve(MOCK_SESSIONS);
    case "session_create": {
      const a = (args?.args ?? {}) as { title?: string; model?: string };
      const s: MockSession = {
        id: `s-${Date.now()}`,
        title: a.title || "新会话",
        created_at: now(),
        updated_at: now(),
        message_count: 0,
        model: a.model || "",
      };
      MOCK_SESSIONS.unshift(s);
      return Promise.resolve(s);
    }
    case "session_load_messages":
      return Promise.resolve(args?.id === "demo-1" ? MOCK_DEMO_MESSAGES : []);
    case "session_save_messages":
      return Promise.resolve(null);
    case "session_delete": {
      const idx = MOCK_SESSIONS.findIndex((s) => s.id === args?.id);
      if (idx >= 0) MOCK_SESSIONS.splice(idx, 1);
      return Promise.resolve(null);
    }
    case "session_rename": {
      const s = MOCK_SESSIONS.find((x) => x.id === args?.id);
      if (s) {
        s.title = String(args?.title ?? s.title);
        s.updated_at = now();
      }
      return Promise.resolve(s ?? null);
    }
    case "session_set_pinned": {
      const s = MOCK_SESSIONS.find((x) => x.id === args?.id);
      if (s) {
        s.pinned = Boolean(args?.pinned);
        s.updated_at = now();
      }
      return Promise.resolve(s ?? null);
    }
    case "agent_send": {
      // ipc.ts: invoke("agent_send", { message: AgentMessage })
      const msg = ((args as { message?: unknown })?.message ?? {}) as { session_id?: string; content?: string };
      if (msg.session_id) void simulateReply(msg.session_id, msg.content || "");
      return Promise.resolve(null);
    }
    case "agent_abort":
      return Promise.resolve(null);
    case "workspace_get":
      return Promise.resolve({ path: "D:\\demo-project", name: "demo-project", exists: true, active: true });
    case "workspace_recent":
      return Promise.resolve([]);
    case "workspace_git_branch":
      return Promise.resolve("main");
    case "github_auth_status":
      return Promise.resolve({ state: "signed_out", user: null });
    case "provider_list":
      return Promise.resolve(MOCK_PROVIDERS);
    case "file_list":
      return Promise.resolve(MOCK_FILE_TREE);
    case "file_read":
      return Promise.resolve("// 浏览器预览模式：此处为演示占位内容\nexport const demo = 1;\n");
    case "capability_view":
      return Promise.resolve({
        kind: String(args?.kind ?? ""),
        title: "能力",
        subtitle: "",
        search_placeholder: "搜索",
        sources: [],
        items: [],
        stats: { sources: 0, items: 0, enabled: 0 },
      });
    case "local_providers_detect":
    case "mcp_list_servers":
    case "hook_list":
    case "session_search":
    case "list_slash_commands":
    case "subagent_list":
    case "workspace_recent_workspaces":
      return Promise.resolve([]);
    case "terminal_spawn":
      return Promise.resolve({ id: "t-1", pid: 4242, shell: "bash", cwd: "D:\\demo-project" });
    default:
      console.debug(`[tauri-mock] 未显式处理的命令 ${cmd}，返回 null`, args);
      return Promise.resolve(null);
  }
}

export function installTauriBrowserMock(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_INTERNALS__) return; // 真实 Tauri 环境：不安装

  let nextCallbackId = 1;
  let nextEventId = 1;

  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
      currentMonitor: null,
    },
    plugins: {},
    transformCallback(callback: unknown) {
      const id = nextCallbackId++;
      callbacks.set(id, typeof callback === "function" ? (callback as (e: unknown) => void) : () => {});
      return id;
    },
    invoke(cmd: string, args: Record<string, unknown> = {}) {
      if (cmd === "plugin:event|listen") {
        const eventId = nextEventId++;
        const name = String(args?.event ?? "");
        const handler = Number(args?.handler ?? 0);
        if (name && handler) {
          const list = eventHandlers.get(name) ?? [];
          list.push(handler);
          eventHandlers.set(name, list);
          // 记录 listenId → handlerId，unlisten 时精确移除（StrictMode 会挂载两次）
          listenIdToHandler.set(eventId, handler);
        }
        return Promise.resolve(eventId);
      }
      if (cmd === "plugin:event|unlisten") {
        // 注意参数名是 eventId（@tauri-apps/api v2 的 _unlisten 约定）
        const handlerId = listenIdToHandler.get(Number(args?.eventId ?? 0));
        if (handlerId !== undefined) {
          listenIdToHandler.delete(Number(args?.eventId ?? 0));
          for (const [name, list] of eventHandlers) {
            const idx = list.indexOf(handlerId);
            if (idx >= 0) {
              list.splice(idx, 1);
              if (list.length === 0) eventHandlers.delete(name);
            }
          }
        }
        return Promise.resolve(null);
      }
      return mockInvoke(cmd, args);
    },
    // 浏览器内无法接收 Rust 事件；保留空实现防止崩溃
    postMessage() {},
  };
  // @tauri-apps/api 的 _unlisten 依赖事件插件初始化脚本注入的内部对象；
  // 缺失时每次 unlisten 都会在 invoke 前抛 TypeError，导致监听器泄漏
  // （React StrictMode 下表现为流式内容重复追加）。真实 Tauri 环境由插件提供。
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    registerListener() {},
    unregisterListener() {},
  };
  // 供应用代码区分预览环境（如导出会话走 Blob 下载而非系统保存对话框）
  w.__WTH_BROWSER_PREVIEW__ = true;
  console.info("[tauri-mock] 浏览器预览模式已启用（非 Tauri 环境）");
}

installTauriBrowserMock();
