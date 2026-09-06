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
    id: "openai-demo",
    name: "OpenAI",
    kind: "openai",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o",
    enabled: true,
    has_api_key: true,
    is_default: true,
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
    case "agent_send":
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

  const callbacks = new Map<number, (event: unknown) => void>();
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
        return Promise.resolve(eventId);
      }
      if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
      return mockInvoke(cmd, args);
    },
    // 浏览器内无法接收 Rust 事件；保留空实现防止崩溃
    postMessage() {},
  };
  console.info("[tauri-mock] 浏览器预览模式已启用（非 Tauri 环境）");
}

installTauriBrowserMock();
