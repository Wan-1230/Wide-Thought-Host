import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  Brain,
  CircleHelp,
  Code2,
  Cpu,
  DollarSign,
  FolderOpen,
  Github,
  Info,
  Palette,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import {
  capabilityView,
  openPathInExplorer,
  providerDelete,
  providerList,
  providerSetDefault,
  localProvidersDetect,
  providerTest,
  providerUpsert,
  settingsGet,
  settingsUpdate,
  mcpListServers,
  mcpAddServer,
  mcpRemoveServer,
  mcpTestServer,
  hookList,
  hookAdd,
  hookRemove,
  hookToggle,
  setServiceApiKey,
  clearServiceApiKey,
  subagentList,
  subagentAdd,
  subagentRemove,
  subagentToggle,
  memoryList,
  memoryWrite,
  diagnosticsGet,
  pluginImport,
  pluginMarketList,
  pluginMarketInstall,
  pluginUninstall,
  updateCheck,
  updateDownload,
  appInfo,
  workspaceIndexStatus,
  workspaceIndexRebuild,
  workspaceIndexClear,
  backupCreate,
  backupRestore,
  configExport,
  configImport,
  teamConfigExport,
  teamConfigImport,
  logList,
  memoryDelete,
  type CapabilityItem,
  type CapabilitySource,
  type PluginMarketItem,
  type PluginMarketEntry,
  type CapabilityView,
  type DesktopSettings,
  type WorkspaceIndexStatus,
  type UpdateProgress,
  type UpdateDownloadResult,
  type AppInfo,
  type ProviderConfig,
  type ProviderSummary,
  type FontScale,
  type FontFamily,
  type ReasoningEffort,
  type EditMode,
  type McpServerConfig,
  type HookConfig,
  type SubagentConfig,
  type MemoryEntry,
  type PromptTemplate,
  type DiagnosticItem,
  type UpdateCheckInfo,
} from "@/lib/ipc";
import { SegmentedControl } from "@/components/common/SegmentedControl";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";

// ─── Types ───────────────────────────────────────────

type PageId =
  | "general"
  | "models"
  | "appearance"
  | "mcp"
  | "skills"
  | "plugins"
  | "memory"
  | "hooks"
  | "subagents"
  | "shortcuts"
  | "usage"
  | "diagnostics"
  | "about";

const PAGE_META: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: "general", label: "通用", icon: <Settings2 size={13} /> },
  { id: "models", label: "模型与 API", icon: <Server size={13} /> },
  { id: "appearance", label: "外观", icon: <Palette size={13} /> },
  { id: "mcp", label: "MCP 与工具", icon: <Plug size={13} /> },
  { id: "skills", label: "技能", icon: <Sparkles size={13} /> },
  { id: "plugins", label: "插件", icon: <Puzzle size={13} /> },
  { id: "memory", label: "记忆", icon: <Brain size={13} /> },
  { id: "hooks", label: "Hooks", icon: <Webhook size={13} /> },
  { id: "subagents", label: "子智能体", icon: <Bot size={13} /> },
  { id: "shortcuts", label: "快捷键", icon: <Cpu size={13} /> },
  { id: "usage", label: "用量", icon: <DollarSign size={13} /> },
  { id: "diagnostics", label: "诊断", icon: <Activity size={13} /> },
  { id: "about", label: "关于", icon: <Info size={13} /> },
];

const emptySettings: DesktopSettings = {
  schema_version: 1,
  language: "zh-CN",
  close_action: "tray",
  sound_enabled: false,
  theme: "dark",
  font_scale: "medium",
  font_family: "sans",
  custom_font_family: null,
  session_display: "standard",
  terminal_shell: null,
  active_workspace: null,
  recent_workspaces: [],
  default_provider_id: null,
  providers: [],
  feature_toggles: {},
  legacy_migration_complete: false,
  github_user: null,
  reasoning_effort: "high",
  edit_mode: "auto",
  budget_usd: null,
  show_system_events: true,
  web_search_engine: "duckduckgo",
  searxng_url: null,
  headroom_enabled: false,
  headroom_port: 8787,
  context_compression: true,
  context_window_tokens: 128000,
  price_per_million_tokens: 2.0,
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
  onboarding_completed: false,
  prompt_templates: [],
  workflows: [],
  network: {
    proxy_mode: "off",
    proxy_url: null,
    request_timeout_secs: 15,
    retry_enabled: true,
    retry_max: 2,
  },
};

const blankProviderConfig: ProviderConfig = {
  id: "",
  name: "",
  kind: "openai-compatible",
  base_url: "",
  model: "",
  enabled: true,
  price_input: null,
  price_output: null,
};

// ─── Main Modal ──────────────────────────────────────

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialPage?: PageId;
  onSettingsSaved?: (settings: DesktopSettings) => void;
}

export function SettingsModal({ open, onClose, initialPage, onSettingsSaved }: SettingsModalProps) {
  const [page, setPage] = useState<PageId>(initialPage ?? "general");
  const [settings, setSettings] = useState<DesktopSettings>(emptySettings);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (initialPage) setPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const refresh = async () => {
    setBusy(true);
    try {
      const [next, list] = await Promise.all([settingsGet(), providerList()]);
      setSettings(next);
      setProviders(list);
      applyTheme(next);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const save = async (next: DesktopSettings) => {
    try {
      const saved = await settingsUpdate(next);
      setSettings(saved);
      applyTheme(saved);
      onSettingsSaved?.(saved);
      setNotice("设置已保存");
      setTimeout(() => setNotice(""), 2000);
    } catch (error) {
      setNotice(`保存失败：${error}`);
    }
  };

  if (!open) return null;

  const currentMeta = PAGE_META.find((p) => p.id === page) ?? PAGE_META[0]!;

  return (
    <div className="settings-mask" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-side">
          <div className="sg">设置</div>
          {PAGE_META.map((p) => (
            <div
              key={p.id}
              className="row"
              data-active={page === p.id}
              onClick={() => setPage(p.id)}
            >
              <span className="ico">{p.icon}</span>
              <span>{p.label}</span>
            </div>
          ))}
        </nav>

        <div className="settings-main">
          <div className="settings-head">
            <div>
              <h2>{currentMeta.label}</h2>
              <div className="desc">{getPageDesc(page)}</div>
            </div>
            <span className="grow" />
            <button type="button" className="close-btn" onClick={onClose}>
              <X size={14} />
            </button>
          </div>

          <div className="settings-body">
            {busy ? (
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                正在加载设置…
              </div>
            ) : (
              <SettingsBody
                page={page}
                settings={settings}
                providers={providers}
                onSave={save}
                onRefresh={refresh}
                onNotice={setNotice}
              />
            )}
          </div>
        </div>
      </div>

      {notice && (
        <div
          className="fixed bottom-5 right-5 px-4 py-2 rounded-xl shadow-lg text-xs cursor-pointer z-[200]"
          style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
          onClick={() => setNotice("")}
        >
          {notice}
        </div>
      )}
    </div>
  );
}

function getPageDesc(page: PageId): string {
  const map: Record<PageId, string> = {
    general: "控制桌面行为、语言与终端。",
    models: "管理模型与 API 密钥。",
    appearance: "主题、字体与显示密度。",
    mcp: "管理 MCP 服务器与外部工具。",
    skills: "浏览和启用本地技能。",
    plugins: "管理插件生态。",
    memory: "查看和管理 Agent 记忆。",
    hooks: "配置生命周期钩子。",
    subagents: "管理子智能体配置与委派。",
    shortcuts: "查看和自定义快捷键。",
    usage: "Token 消耗与用量统计。",
    diagnostics: "检查运行环境并导出信息。",
    about: "版本与许可信息。",
  };
  return map[page];
}

function applyTheme(settings: DesktopSettings) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(settings.theme);
  // font scale via CSS variable
  const scaleMap: Record<string, string> = { small: "0.875", medium: "1", large: "1.125" };
  root.style.setProperty("--font-scale", scaleMap[settings.font_scale] || "1");
  // font family via CSS variable
  const ffMap: Record<string, string> = {
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    system: 'system-ui, -apple-system, sans-serif',
    serif: '"Georgia", "Noto Serif SC", serif',
    custom: settings.custom_font_family || '"Inter", sans-serif',
  };
  root.style.setProperty("--ui-font-family", ffMap[settings.font_family] || ffMap.sans);
}

// ─── Settings Body Router ────────────────────────────

function SettingsBody({
  page,
  settings,
  providers,
  onSave,
  onRefresh,
  onNotice,
}: {
  page: PageId;
  settings: DesktopSettings;
  providers: ProviderSummary[];
  onSave: (value: DesktopSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (value: string) => void;
}) {
  if (page === "models") {
    return <PageModels providers={providers} settings={settings} onSave={onSave} onRefresh={onRefresh} onNotice={onNotice} />;
  }
  if (page === "appearance") {
    return <PageAppearance settings={settings} onSave={onSave} />;
  }
  if (page === "about") {
    return <PageAbout onNotice={onNotice} />;
  }
  if (page === "diagnostics") {
    return <PageDiagnostics onNotice={onNotice} />;
  }
  if (page === "shortcuts") {
    return <PageShortcuts settings={settings} onSave={onSave} onNotice={onNotice} />;
  }
  if (page === "usage") {
    return <PageUsage settings={settings} onSave={onSave} onNotice={onNotice} />;
  }
  if (page === "mcp") {
    return <PageMcp onNotice={onNotice} />;
  }
  if (page === "skills") {
    return <PageSkills settings={settings} onSave={onSave} onNotice={onNotice} />;
  }
  if (page === "plugins") {
    return <PagePlugins settings={settings} onSave={onSave} onNotice={onNotice} />;
  }
  if (page === "memory") {
    return <PageMemory onNotice={onNotice} />;
  }
  if (page === "hooks") {
    return <PageHooks onNotice={onNotice} />;
  }
  if (page === "subagents") {
    return <PageSubagents onNotice={onNotice} />;
  }
  return <PageGeneral settings={settings} onSave={onSave} onNotice={onNotice} onRefresh={onRefresh} />;
}

// ─── General Page ────────────────────────────────────

function PageGeneral({
  settings,
  onSave,
  onNotice,
  onRefresh,
}: {
  settings: DesktopSettings;
  onSave: (v: DesktopSettings) => Promise<void>;
  onNotice: (s: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  const [tavilyKey, setTavilyKey] = useState("");
  const [indexStatus, setIndexStatus] = useState<WorkspaceIndexStatus | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const loadIndex = async () => {
    try {
      setIndexStatus(await workspaceIndexStatus());
    } catch (e) {
      onNotice(`索引状态读取失败：${e}`);
    }
  };
  useEffect(() => {
    void loadIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <section className="section">
        <div className="stitle">行为</div>
        <SettingRow label="界面语言" hint="切换界面显示语言">
          <SegmentedControl
            options={[
              { value: "zh-CN", label: "中文" },
              { value: "en-US", label: "English" },
            ]}
            value={settings.language}
            onChange={(language) => onSave({ ...settings, language: language as DesktopSettings["language"] })}
          />
        </SettingRow>
        <SettingRow label="关闭主窗口" hint="选择关闭按钮的行为">
          <SegmentedControl
            options={[
              { value: "tray", label: "隐藏到托盘" },
              { value: "quit", label: "退出应用" },
            ]}
            value={settings.close_action}
            onChange={(close_action) => onSave({ ...settings, close_action: close_action as DesktopSettings["close_action"] })}
          />
        </SettingRow>
        <SettingRow label="任务完成提示音" hint="Agent 完成任务时播放声音">
          <Toggle checked={settings.sound_enabled} onChange={(sound_enabled) => onSave({ ...settings, sound_enabled })} />
        </SettingRow>
        <SettingRow label="显示系统事件" hint="在聊天中显示系统级事件消息">
          <SegmentedControl
            options={[
              { value: "true", label: "显示" },
              { value: "false", label: "隐藏" },
            ]}
            value={String(settings.show_system_events)}
            onChange={(v) => onSave({ ...settings, show_system_events: v === "true" })}
          />
        </SettingRow>
        <SettingRow label="首次使用引导" hint="重新显示三步引导：选择工作区、确认模型、示例提问">
          <button
            className="small-btn"
            onClick={() => onSave({ ...settings, onboarding_completed: false })}
          >
            重新运行引导
          </button>
        </SettingRow>
      </section>

      <section className="section">
        <div className="stitle">Agent 行为</div>
        <SettingRow label="推理力度" hint="控制模型思考深度，越高越精确但更慢">
          <SegmentedControl
            size="sm"
            options={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Med" },
              { value: "high", label: "High" },
              { value: "max", label: "Max" },
            ]}
            value={settings.reasoning_effort}
            onChange={(reasoning_effort) => onSave({ ...settings, reasoning_effort: reasoning_effort as ReasoningEffort })}
          />
        </SettingRow>
        <SettingRow label="编辑模式" hint="控制代码修改的审批策略">
          <SegmentedControl
            size="sm"
            options={[
              { value: "plan", label: "Plan" },
              { value: "review", label: "Review" },
              { value: "auto", label: "Auto" },
              { value: "yolo", label: "YOLO" },
            ]}
            value={settings.edit_mode}
            onChange={(edit_mode) => onSave({ ...settings, edit_mode: edit_mode as EditMode })}
          />
        </SettingRow>
        <SettingRow label="预算上限 (USD)" hint="累计消耗达到该金额后停止请求，留空为不限制">
          <input
            className="control w-28"
            type="number"
            min="0"
            step="0.5"
            placeholder="例如：10"
            value={settings.budget_usd ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              onSave({ ...settings, budget_usd: v === "" ? null : Number(v) });
            }}
          />
        </SettingRow>
        <SettingRow label="上下文自动压缩" hint="接近窗口上限时自动把早期对话压缩为摘要，避免超限">
          <Toggle
            checked={settings.context_compression}
            onChange={(context_compression) => onSave({ ...settings, context_compression })}
          />
        </SettingRow>
        <SettingRow label="上下文窗口 (Token)" hint="当前模型的上下文窗口大小，用于估算压缩阈值">
          <input
            className="control w-32"
            type="number"
            min="4096"
            step="1024"
            placeholder="例如：128000"
            value={settings.context_window_tokens}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) onSave({ ...settings, context_window_tokens: Math.floor(v) });
            }}
          />
        </SettingRow>
        <SettingRow label="Token 单价 (USD/百万)" hint="估算用量费用的统一单价，用于预算与用量统计">
          <input
            className="control w-28"
            type="number"
            min="0"
            step="0.1"
            placeholder="例如：2"
            value={settings.price_per_million_tokens}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 0) onSave({ ...settings, price_per_million_tokens: v });
            }}
          />
        </SettingRow>
        <SettingRow label="输出 Token 单价 (USD/百万)" hint="留空则按上方统一单价估算；输入/输出分价后预算估算更接近真实账单">
          <input
            className="control w-28"
            type="number"
            min="0"
            step="0.1"
            placeholder="例如：8"
            value={settings.price_per_million_output_tokens ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              const v = raw === "" ? null : Number(raw);
              if (v === null || v >= 0) onSave({ ...settings, price_per_million_output_tokens: v });
            }}
          />
        </SettingRow>
        <SettingRow label="测试命令（F-05 验证循环）" hint="代码修改完成后自动在工作区根目录运行（如 cargo test）；留空禁用">
          <input
            className="control w-64"
            placeholder="例如：cargo test"
            value={settings.test_cmd ?? ""}
            onChange={(e) => onSave({ ...settings, test_cmd: e.target.value || null })}
          />
        </SettingRow>
        <SettingRow label="自动修复轮数" hint="测试失败后自动回注错误并让模型修复的最大轮数">
          <input
            className="control w-20"
            type="number"
            min="0"
            max="10"
            value={settings.verify_max_rounds ?? 3}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 0 && v <= 10) onSave({ ...settings, verify_max_rounds: v });
            }}
          />
        </SettingRow>
      </section>

      <section className="section">
        <div className="stitle">搜索</div>
        <SettingRow label="Web 搜索引擎" hint="Agent 联网搜索时使用的引擎">
          <select
            className="control w-44"
            value={settings.web_search_engine}
            onChange={(e) => onSave({ ...settings, web_search_engine: e.target.value })}
          >
            <option value="duckduckgo">DuckDuckGo（无需 Key）</option>
            <option value="searxng">SearXNG（自托管）</option>
            <option value="tavily">Tavily</option>
            <option value="brave">Brave</option>
            <option value="bing">Bing</option>
            <option value="perplexity">Perplexity</option>
          </select>
        </SettingRow>
        {settings.web_search_engine === "searxng" && (
          <SettingRow label="SearXNG 实例地址" hint="自托管元搜索引擎，实例需开启 JSON 输出（formats 含 json）">
            <input
              className="control w-64"
              placeholder="例如：http://localhost:8080"
              value={settings.searxng_url ?? ""}
              onChange={(e) => onSave({ ...settings, searxng_url: e.target.value || null })}
            />
          </SettingRow>
        )}
        {["brave", "bing", "perplexity"].includes(settings.web_search_engine) && (
          <SearchKeyRow engine={settings.web_search_engine} onNotice={onNotice} />
        )}
        {settings.web_search_engine === "tavily" && (
          <SettingRow label="Tavily API Key" hint="写入 Windows 凭据管理器，仅用于 Tavily 搜索">
            <div className="flex items-center gap-2">
              <input
                className="control w-64"
                type="password"
                placeholder="tvly-xxxxxxxx"
                value={tavilyKey}
                onChange={(e) => setTavilyKey(e.target.value)}
              />
              <button
                onClick={async () => {
                  try {
                    if (tavilyKey.trim()) {
                      await setServiceApiKey("tavily", tavilyKey.trim());
                      onNotice("Tavily API Key 已保存");
                    } else {
                      await clearServiceApiKey("tavily");
                      onNotice("Tavily API Key 已清除");
                    }
                    setTavilyKey("");
                  } catch (error) {
                    onNotice(`保存失败：${String(error)}`);
                  }
                }}
                className="px-3 py-1.5 rounded-md text-[11px] font-medium text-white"
                style={{ background: "var(--accent-blue)" }}
              >
                保存
              </button>
            </div>
          </SettingRow>
        )}
      </section>

      <section className="section">
        <div className="stitle">网络</div>
        <SettingRow label="代理模式" hint="off=直连；system=跟随系统代理；custom=使用下方自定义地址">
          <SegmentedControl
            size="sm"
            options={[
              { value: "off", label: "关闭" },
              { value: "system", label: "系统代理" },
              { value: "custom", label: "自定义" },
            ]}
            value={settings.network.proxy_mode}
            onChange={(proxy_mode) =>
              onSave({
                ...settings,
                network: { ...settings.network, proxy_mode: proxy_mode as "off" | "system" | "custom" },
              })
            }
          />
        </SettingRow>
        {settings.network.proxy_mode === "custom" && (
          <SettingRow label="代理地址" hint="HTTP/HTTPS 代理，例如 Clash、v2ray 的本地端口">
            <input
              className="control w-72"
              placeholder="例如：http://127.0.0.1:7890"
              value={settings.network.proxy_url || ""}
              onChange={(e) =>
                onSave({
                  ...settings,
                  network: { ...settings.network, proxy_url: e.target.value.trim() || null },
                })
              }
            />
          </SettingRow>
        )}
        <SettingRow label="连接超时 (秒)" hint="建立连接阶段的超时时间，流式响应不受此限制；范围 5~120">
          <input
            className="control w-28"
            type="number"
            min="5"
            max="120"
            placeholder="例如：15"
            value={settings.network.request_timeout_secs}
            onChange={(e) => {
              const v = Math.min(120, Math.max(5, Number(e.target.value) || 15));
              onSave({ ...settings, network: { ...settings.network, request_timeout_secs: v } });
            }}
          />
        </SettingRow>
        <SettingRow label="自动重试" hint="连接失败或服务端 5xx 时自动重试；4xx（密钥/参数错误）不重试">
          <Toggle
            checked={settings.network.retry_enabled}
            onChange={(retry_enabled) => onSave({ ...settings, network: { ...settings.network, retry_enabled } })}
          />
        </SettingRow>
        {settings.network.retry_enabled && (
          <SettingRow label="重试次数" hint="最多重试次数，范围 0~3；重试间隔按 1s/2s 递增">
            <input
              className="control w-28"
              type="number"
              min="0"
              max="3"
              placeholder="例如：2"
              value={settings.network.retry_max}
              onChange={(e) => {
                const v = Math.min(3, Math.max(0, Number(e.target.value) || 0));
                onSave({ ...settings, network: { ...settings.network, retry_max: v } });
              }}
            />
          </SettingRow>
        )}
      </section>

      <section className="section">
        <div className="stitle">终端</div>
        <SettingRow label="首选 Shell" hint="选择 Agent 执行命令时使用的终端 Shell">
          <select
            className="control w-52"
            value={settings.terminal_shell || ""}
            onChange={(e) => onSave({ ...settings, terminal_shell: e.target.value || null })}
          >
            <option value="">自动检测</option>
            <option value="pwsh">PowerShell 7 (pwsh)</option>
            <option value="powershell">Windows PowerShell 5.1</option>
            <option value="cmd">CMD</option>
            <option value="bash">WSL / Git Bash</option>
          </select>
        </SettingRow>
      </section>

      <section className="section">
        <div className="stitle">工作区索引</div>
        <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
          对工作区文件建立轻量索引，供 @检索 快速定位代码。检测到本地 Ollama 且已拉取 embedding 模型时自动启用语义检索，否则使用关键词检索。
        </p>
        <div className="rounded-xl p-3 text-[11px] mb-2" style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}>
          {indexStatus ? (
            <div className="grid gap-1" style={{ color: "var(--text-muted)" }}>
              <div>工作区：<span style={{ color: "var(--text-primary)" }}>{indexStatus.workspace || "（未选择）"}</span></div>
              <div>已索引文件：<span style={{ color: "var(--text-primary)" }}>{indexStatus.file_count}</span> 个</div>
              <div>检索模式：<span style={{ color: "var(--text-primary)" }}>
                {indexStatus.semantic_engine === "ollama" ? "语义检索（Ollama）" : "关键词检索"}
              </span></div>
              {indexStatus.semantic_model && <div>语义模型：{indexStatus.semantic_model}</div>}
              <div className="truncate" title={indexStatus.cache_path}>缓存：{indexStatus.cache_path}</div>
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)" }}>正在读取索引状态…</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="small-btn"
            disabled={indexBusy}
            title="重新遍历工作区文件并重建索引缓存"
            onClick={async () => {
              setIndexBusy(true);
              try {
                setIndexStatus(await workspaceIndexRebuild());
                onNotice("索引重建完成");
              } catch (e) {
                onNotice(`重建失败：${e}`);
              } finally {
                setIndexBusy(false);
              }
            }}
          >
            {indexBusy ? "重建中…" : "重建索引"}
          </button>
          <button
            className="small-btn"
            disabled={indexBusy}
            title="删除索引缓存，下次检索时自动重建"
            onClick={async () => {
              if (!window.confirm("清除后下次 @检索 会重新建立索引。确定清除吗？")) return;
              setIndexBusy(true);
              try {
                setIndexStatus(await workspaceIndexClear());
                onNotice("索引已清除");
              } catch (e) {
                onNotice(`清除失败：${e}`);
              } finally {
                setIndexBusy(false);
              }
            }}
          >
            清除索引
          </button>
          <button className="small-btn" onClick={() => void loadIndex()} disabled={indexBusy}>
            刷新状态
          </button>
        </div>
      </section>

      <section className="section">
        <div className="stitle">Token 优化</div>
        <HeadroomSection settings={settings} onSave={onSave} />
      </section>

      <section className="section">
        <div className="stitle">数据与备份</div>
        <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
          一键备份全部本地数据（会话、设置、记忆、子智能体、Hooks、插件开关）。配置导出不含 API Key，可跨机器导入。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="small-btn"
            title="将会话、设置、技能等打包为 .wthbackup 文件"
            onClick={async () => {
              const stamp = new Date().toISOString().slice(0, 10);
              const target = await saveDialog({
                title: "导出备份",
                defaultPath: `wth-backup-${stamp}.wthbackup`,
                filters: [{ name: "WTH 备份", extensions: ["wthbackup"] }],
              });
              if (!target) return;
              try {
                const res = await backupCreate(target);
                onNotice(`备份完成：${res.file_count} 个文件，${(res.bytes / 1024).toFixed(1)} KB`);
              } catch (e) {
                onNotice(`备份失败：${e}`);
              }
            }}
          >
            导出备份
          </button>
          <button
            className="small-btn"
            title="从 .wthbackup 文件恢复数据（恢复前自动备份当前数据）"
            onClick={async () => {
              const source = await openDialog({
                title: "选择备份文件",
                multiple: false,
                filters: [{ name: "WTH 备份", extensions: ["wthbackup"] }],
              });
              if (!source) return;
              if (!window.confirm("恢复将覆盖当前数据（恢复前会自动备份当前数据）。确定继续吗？")) return;
              try {
                const msg = await backupRestore(String(source));
                onNotice(msg);
              } catch (e) {
                onNotice(`恢复失败：${e}`);
              }
            }}
          >
            恢复备份
          </button>
          <button
            className="small-btn"
            title="导出不含 API Key 的配置 JSON，可跨机器导入"
            onClick={async () => {
              const stamp = new Date().toISOString().slice(0, 10);
              const target = await saveDialog({
                title: "导出配置",
                defaultPath: `wth-config-${stamp}.json`,
                filters: [{ name: "JSON", extensions: ["json"] }],
              });
              if (!target) return;
              try {
                const msg = await configExport(target);
                onNotice(msg);
              } catch (e) {
                onNotice(`导出失败：${e}`);
              }
            }}
          >
            导出配置
          </button>
          <button
            className="small-btn"
            title="导入配置 JSON（凭据需重新填写）"
            onClick={async () => {
              const source = await openDialog({
                title: "选择配置文件",
                multiple: false,
                filters: [{ name: "JSON", extensions: ["json"] }],
              });
              if (!source) return;
              try {
                const msg = await configImport(String(source));
                onNotice(msg);
              } catch (e) {
                onNotice(`导入失败：${e}`);
              }
            }}
          >
            导入配置
          </button>
        </div>
      </section>

      <section className="section">
        <div className="stitle">提示词模板</div>
        <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
          聊天输入框左侧的模板入口可直接插入。支持变量：{`{{`}workspace{`}}`}（工作区名）、{`{{`}file{`}}`}、{`{{`}language{`}}`}。
        </p>
        <div className="space-y-2.5">
          {(settings.prompt_templates || []).length === 0 && (
            <div
              className="rounded-xl border border-dashed px-4 py-6 text-center text-[11px]"
              style={{ borderColor: "var(--surface-3)", color: "var(--text-dim)" }}
            >
              暂无提示词模板，点击下方「+ 新增模板」创建
            </div>
          )}
          {(settings.prompt_templates || []).map((tpl, idx) => (
            <div
              key={tpl.id}
              className="rounded-xl p-3 space-y-2.5"
              style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}
            >
              {/* 名称行：输入框 + 内置徽标 / 删除按钮 */}
              <div className="flex items-center gap-2">
                <input
                  className="control flex-1 min-w-0"
                  value={tpl.name}
                  placeholder="模板名称"
                  onChange={(e) => {
                    const next = [...(settings.prompt_templates || [])];
                    next[idx] = { ...tpl, name: e.target.value };
                    onSave({ ...settings, prompt_templates: next });
                  }}
                />
                {tpl.builtin && (
                  <span
                    className="flex-shrink-0 text-[10px] px-2 py-1 rounded-full leading-none"
                    style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
                  >
                    内置
                  </span>
                )}
                {!tpl.builtin && (
                  <button
                    className="icon-btn flex-shrink-0 !p-1.5"
                    title="删除模板"
                    onClick={() => {
                      const next = (settings.prompt_templates || []).filter((t) => t.id !== tpl.id);
                      onSave({ ...settings, prompt_templates: next });
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {/* 描述：独占一行，全宽 */}
              <div className="min-w-0">
                <label className="block text-[10px] mb-1" style={{ color: "var(--text-dim)" }}>
                  描述
                </label>
                <input
                  className="control block w-full"
                  value={tpl.description}
                  placeholder="模板描述（显示在模板列表）"
                  onChange={(e) => {
                    const next = [...(settings.prompt_templates || [])];
                    next[idx] = { ...tpl, description: e.target.value };
                    onSave({ ...settings, prompt_templates: next });
                  }}
                />
              </div>
              {/* 内容：全宽多行，等宽字体，纵向可拉伸 */}
              <div className="min-w-0">
                <label className="block text-[10px] mb-1" style={{ color: "var(--text-dim)" }}>
                  内容（支持变量占位符）
                </label>
                <textarea
                  className="control block w-full font-mono text-[11px] leading-relaxed resize-y"
                  rows={4}
                  style={{ minHeight: 96 }}
                  value={tpl.content}
                  placeholder="模板内容，可包含 {{workspace}} / {{file}} / {{language}} 变量"
                  onChange={(e) => {
                    const next = [...(settings.prompt_templates || [])];
                    next[idx] = { ...tpl, content: e.target.value };
                    onSave({ ...settings, prompt_templates: next });
                  }}
                />
              </div>
            </div>
          ))}
          <button
            className="small-btn"
            onClick={() => {
              const next = [
                ...(settings.prompt_templates || []),
                {
                  id: crypto.randomUUID(),
                  name: "新模板",
                  description: "",
                  content: "",
                  builtin: false,
                } as PromptTemplate,
              ];
              onSave({ ...settings, prompt_templates: next });
            }}
          >
            + 新增模板
          </button>
        </div>
      </section>

      <section className="section">
        <div className="stitle">团队共享</div>
        <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
          将子智能体、提示词模板与快捷键打包为 .wthconfig 文件分享给团队。不含任何 API Key。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="small-btn"
            title="导出团队配置（子智能体 + 模板 + 快捷键）"
            onClick={async () => {
              const stamp = new Date().toISOString().slice(0, 10);
              const target = await saveDialog({
                title: "导出团队配置",
                defaultPath: `wth-team-config-${stamp}.wthconfig`,
                filters: [{ name: "WTH 团队配置", extensions: ["wthconfig"] }],
              });
              if (!target) return;
              try {
                const msg = await teamConfigExport(target);
                onNotice(msg);
              } catch (e) {
                onNotice(`导出失败：${e}`);
              }
            }}
          >
            导出团队配置
          </button>
          <button
            className="small-btn"
            title="导入团队配置文件"
            onClick={async () => {
              const source = await openDialog({
                title: "选择团队配置文件",
                multiple: false,
                filters: [{ name: "WTH 团队配置", extensions: ["wthconfig"] }],
              });
              if (!source) return;
              if (!window.confirm("导入将覆盖当前的子智能体与提示词模板。确定继续吗？")) return;
              try {
                const msg = await teamConfigImport(String(source));
                onNotice(msg);
                await onRefresh?.();
              } catch (e) {
                onNotice(`导入失败：${e}`);
              }
            }}
          >
            导入团队配置
          </button>
        </div>
      </section>
    </>
  );
}

// ─── Headroom Section ────────────────────────────────

function HeadroomSection({ settings, onSave }: { settings: DesktopSettings; onSave: (v: DesktopSettings) => Promise<void> }) {
  const [status, setStatus] = useState<import("@/lib/ipc").HeadroomStatus | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    import("@/lib/ipc").then(({ headroomStatus }) => {
      headroomStatus().then(setStatus).catch(() => {});
    });
  }, []);

  const refresh = async () => {
    const { headroomStatus } = await import("@/lib/ipc");
    try { setStatus(await headroomStatus()); } catch {}
  };

  const toggle = async (on: boolean) => {
    const updated = { ...settings, headroom_enabled: on };
    await onSave(updated);
    if (on) {
      const { headroomStart } = await import("@/lib/ipc");
      try { setStatus(await headroomStart(settings.headroom_port || 8787)); } catch {}
    } else {
      const { headroomStop } = await import("@/lib/ipc");
      try { setStatus(await headroomStop()); } catch {}
    }
  };

  const doInstall = async () => {
    setInstalling(true);
    try {
      const { headroomInstall } = await import("@/lib/ipc");
      await headroomInstall();
      await refresh();
    } catch (e) {
      console.error("安装 headroom 失败:", e);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <SettingRow label="Headroom 上下文压缩" hint="本地代理压缩上下文，节省 60-92% token。一键安装，无需手动操作">
        <Toggle checked={settings.headroom_enabled} onChange={toggle} />
      </SettingRow>
      {status && (
        <div className="text-[11px] ml-1 mt-1 space-y-1" style={{ color: "var(--text-muted)" }}>
          {status.installed === false ? (
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--accent-orange)" }}>Headroom 未安装</span>
              <button
                className="small-btn"
                disabled={installing}
                onClick={doInstall}
              >
                {installing ? "安装中…" : "一键安装"}
              </button>
            </div>
          ) : status.running ? (
            <span style={{ color: "var(--accent-green)" }}>运行中 — {status.proxy_url}</span>
          ) : status.error ? (
            <span style={{ color: "var(--accent-red)" }}>{status.error}</span>
          ) : (
            <span>已安装 · 未启动</span>
          )}
        </div>
      )}
    </>
  );
}

// ─── Appearance Page ─────────────────────────────────

function PageAppearance({ settings, onSave }: { settings: DesktopSettings; onSave: (v: DesktopSettings) => Promise<void> }) {
  return (
    <>
      <section className="section">
        <div className="stitle">主题</div>
        <SettingRow label="模式" hint="深色或浅色外观">
          <SegmentedControl
            options={[
              { value: "dark", label: "深色" },
              { value: "light", label: "浅色" },
            ]}
            value={settings.theme}
            onChange={(theme) => onSave({ ...settings, theme: theme as DesktopSettings["theme"] })}
          />
        </SettingRow>
      </section>

      <section className="section">
        <div className="stitle">字体</div>
        <SettingRow label="字体缩放" hint="调整全局文字大小">
          <SegmentedControl
            options={[
              { value: "small", label: "小" },
              { value: "medium", label: "中" },
              { value: "large", label: "大" },
            ]}
            value={settings.font_scale}
            onChange={(font_scale) => onSave({ ...settings, font_scale: font_scale as FontScale })}
          />
        </SettingRow>
        <SettingRow label="字体族" hint="选择界面字体风格">
          <SegmentedControl
            size="sm"
            options={[
              { value: "sans", label: "Sans" },
              { value: "system", label: "System" },
              { value: "serif", label: "Serif" },
              { value: "custom", label: "自定义" },
            ]}
            value={settings.font_family}
            onChange={(font_family) => onSave({ ...settings, font_family: font_family as FontFamily })}
          />
        </SettingRow>
        {settings.font_family === "custom" && (
          <SettingRow label="自定义字体" hint='例如 "Microsoft YaHei", "PingFang SC", sans-serif'>
            <input
              className="control w-64"
              value={settings.custom_font_family || ""}
              placeholder='例如："Microsoft YaHei", "PingFang SC"'
              onChange={(e) => onSave({ ...settings, custom_font_family: e.target.value || null })}
            />
          </SettingRow>
        )}
      </section>

      <section className="section">
        <div className="stitle">显示</div>
        <SettingRow label="会话密度" hint="消息列表的紧凑程度">
          <SegmentedControl
            options={[
              { value: "standard", label: "标准" },
              { value: "compact", label: "紧凑" },
            ]}
            value={settings.session_display}
            onChange={(session_display) => onSave({ ...settings, session_display: session_display as DesktopSettings["session_display"] })}
          />
        </SettingRow>
      </section>
    </>
  );
}

// ─── Models Page ─────────────────────────────────────

// 带标签与提示的字段容器：让新手用户知道每个输入框该填什么。
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-medium mb-1" style={{ color: "var(--text-primary)" }}>
        <span>{label}</span>
        {hint && <span className="text-[10px] font-normal" style={{ color: "var(--text-dim)" }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function PageModels({
  providers,
  settings,
  onSave,
  onRefresh,
  onNotice,
}: {
  providers: ProviderSummary[];
  settings: DesktopSettings;
  onSave: (v: DesktopSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (s: string) => void;
}) {
  // 内置模型（如默认模型）由应用自带，不在列表中展示
  const visibleProviders = providers.filter((p) => !p.builtin);
  const NEW_PROVIDER_ID = "__new__";
  const [selectedId, setSelectedId] = useState<string | null>(visibleProviders[0]?.id ?? null);
  const [draft, setDraft] = useState<ProviderConfig>(blankProviderConfig);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (visibleProviders.length === 0) {
      setSelectedId(null);
      setDraft(blankProviderConfig);
      setApiKey("");
      return;
    }
    if (selectedId === NEW_PROVIDER_ID) return;
    if (!selectedId || !visibleProviders.some((p) => p.id === selectedId)) {
      setSelectedId(visibleProviders[0].id);
    }
  }, [visibleProviders, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(blankProviderConfig);
      setApiKey("");
      return;
    }
    const current = visibleProviders.find((p) => p.id === selectedId);
    if (!current) return;
    setDraft(current);
    setApiKey("");
  }, [visibleProviders, selectedId]);

  const selected = selectedId ? visibleProviders.find((p) => p.id === selectedId) ?? null : null;

  const save = async () => {
    try {
      const nextId = draft.id || selected?.id || crypto.randomUUID();
      const saved = await providerUpsert({ ...draft, id: nextId }, apiKey);
      await onRefresh();
      setSelectedId(saved.id);
      setApiKey("");
      onNotice("模型已保存");
    } catch (e) {
      onNotice(String(e));
    }
  };

  const startNew = () => {
    setSelectedId(NEW_PROVIDER_ID);
    setDraft({ ...blankProviderConfig, id: crypto.randomUUID() });
    setApiKey("");
  };

  // F-01: 检测本机 Ollama / vLLM 并注册为本地模型 Provider（无需 API Key）。
  const [detecting, setDetecting] = useState(false);
  const detectLocal = async () => {
    setDetecting(true);
    try {
      const endpoints = await localProvidersDetect();
      if (endpoints.length === 0) {
        onNotice("未检测到本地模型。可启动 Ollama（https://ollama.com）或 vLLM 后重试。");
      } else {
        const total = endpoints.reduce((n, e) => n + e.models.length, 0);
        onNotice("检测到本地模型 " + total + " 个（" + endpoints.map((e) => e.kind).join(" / ") + "），已加入模型列表");
        await onRefresh();
      }
    } catch (e) {
      onNotice(String(e));
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
      <div className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>我的模型</div>
          <div className="flex items-center gap-1">
            <button className="small-btn" onClick={detectLocal} disabled={detecting}>
              <Sparkles size={12} /> {detecting ? "检测中…" : "检测本地模型"}
            </button>
            <button className="small-btn" onClick={startNew}>
              <Plus size={12} /> 新增
            </button>
          </div>
        </div>
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
          {visibleProviders.length === 0 ? (
            <div className="text-xs px-2 py-4 text-center leading-relaxed" style={{ color: "var(--text-dim)" }}>
              {providers.some((p) => p.builtin) ? "正在使用内置默认模型" : "还没有配置模型"}
              <br />
              点击右上角「新增」添加你自己的模型
            </div>
          ) : (
            visibleProviders.map((provider) => (
              <button
                key={provider.id}
                onClick={() => setSelectedId(provider.id)}
                className="w-full text-left rounded-lg border px-3 py-2 transition-colors hover:bg-surface-2"
                style={{
                  borderColor: selectedId === provider.id ? "var(--accent-blue)" : "var(--surface-3)",
                  background: selectedId === provider.id ? "var(--surface-2)" : "transparent",
                }}
              >
                <div className="flex items-center gap-2 text-xs font-medium">
                  <span className="truncate">{provider.name}</span>
                  {provider.is_default && <Star size={11} fill="currentColor" />}
                </div>
                <div className="mt-0.5 text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                  {provider.model}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
        <div className="text-sm font-medium mb-1">备用模型链</div>
        <div className="text-[10px] mb-3" style={{ color: "var(--text-dim)" }}>
          主模型不可用（5xx / 429 / 网络错误）时按顺序自动降级；每个模型可单独配置单价
        </div>
        <div className="flex flex-col gap-1.5 mb-4">
          {(settings.fallback_provider_ids ?? []).map((id, idx) => (
            <div key={id} className="flex items-center justify-between rounded-lg border px-3 py-1.5" style={{ borderColor: "var(--surface-3)" }}>
              <span className="text-xs">
                {idx + 1}. {providers.find((p) => p.id === id)?.name ?? id}
              </span>
              <button
                className="text-[10px]"
                style={{ color: "var(--text-dim)" }}
                onClick={() =>
                  onSave({
                    ...settings,
                    fallback_provider_ids: (settings.fallback_provider_ids ?? []).filter((x) => x !== id),
                  })
                }
              >
                移除
              </button>
            </div>
          ))}
          <select
            className="control w-44"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onSave({
                  ...settings,
                  fallback_provider_ids: [...(settings.fallback_provider_ids ?? []), e.target.value],
                });
              }
            }}
          >
            <option value="">+ 添加备用模型</option>
            {providers
              .filter((p) => p.enabled && !(settings.fallback_provider_ids ?? []).includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="text-sm font-medium">{selected ? "编辑模型" : "添加模型"}</div>
          {selected && (
            <div className="flex items-center gap-2">
              <button className="small-btn" onClick={async () => { try { onNotice(await providerTest(selected.id)); } catch (e) { onNotice(String(e)); } }}>
                测试
              </button>
              {!selected.is_default && (
                <button className="small-btn" onClick={async () => { await providerSetDefault(selected.id); await onRefresh(); }}>
                  设为默认
                </button>
              )}
              <button className="icon-btn" title="删除" onClick={async () => { await providerDelete(selected.id); setSelectedId(null); await onRefresh(); }}>
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <Field label="显示名称" hint="用于在列表中识别，可随意命名">
            <input className="control w-full" placeholder="例如：我的本地模型 / 公司网关" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="模型名" hint="必须是 API 支持的确切名称">
            <input className="control w-full" placeholder="例如：gpt-4o、deepseek-chat、qwen-max" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          </Field>
          <Field label="API 地址" hint="OpenAI 兼容接口，通常以 /v1 结尾">
            <input className="control w-full" placeholder="例如：https://api.openai.com/v1" value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} />
          </Field>
          <Field label="API Key" hint="仅保存在本机，不会回显">
            <input className="control w-full" type="password" placeholder="粘贴你的 API Key（修改时留空表示不更换）" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="输入单价 (USD/百万)" hint="可选；留空用全局价">
              <input
                className="control w-full"
                type="number"
                min="0"
                step="0.1"
                placeholder="例如：2"
                value={draft.price_input ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v === null || v >= 0) setDraft({ ...draft, price_input: v });
                }}
              />
            </Field>
            <Field label="输出单价 (USD/百万)" hint="可选；留空用全局价">
              <input
                className="control w-full"
                type="number"
                min="0"
                step="0.1"
                placeholder="例如：8"
                value={draft.price_output ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v === null || v >= 0) setDraft({ ...draft, price_output: v });
                }}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--surface-3)" }}>
            <div>
              <div className="text-xs font-medium">启用该模型</div>
              <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>关闭后无法使用此模型，但不会删除配置</div>
            </div>
            <Toggle checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
          </div>
          <button className="primary-btn w-full" disabled={!draft.name || !draft.model || !draft.base_url} onClick={save}>
            <Save size={13} /> {selected ? "保存修改" : "添加模型"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PageMcp ─────────────────────────────────────────

function PageMcp({ onNotice }: { onNotice: (s: string) => void }) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", command: "", args: "", url: "" });

  const load = async () => {
    setLoading(true);
    try { setServers(await mcpListServers()); } catch (e) { onNotice(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);


  const addServer = async () => {
    if (!form.name.trim()) { onNotice("名称不能为空"); return; }
    try {
      await mcpAddServer({
        name: form.name,
        command: form.command || undefined,
        args: form.args ? form.args.split(/\s+/) : undefined,
        url: form.url || undefined,
        enabled: true,
      });
      setShowAdd(false);
      setForm({ name: "", command: "", args: "", url: "" });
      await load();
      onNotice("MCP 服务器已添加");
    } catch (e) { onNotice(String(e)); }
  };

  const statusColor = (s: string) => s === "online" ? "var(--accent-green)" : s === "error" ? "var(--accent-red)" : "var(--surface-4)";

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{servers.length} 个服务器</div>
        <button className="primary-btn" onClick={() => setShowAdd(!showAdd)}><Plus size={13} /> 添加服务器</button>
      </div>

      {showAdd && (
        <div className="mb-4 rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
          <div className="text-xs font-medium">新增 MCP 服务器</div>
          <Field label="服务器名称" hint="用于在列表中识别">
            <input className="control w-full" placeholder="例如：代码搜索服务器" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="启动命令" hint="通过 stdio 启动服务器的可执行文件">
            <input className="control w-full" placeholder="例如：npx、node、python" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
          </Field>
          <Field label="启动参数" hint="空格分隔的命令行参数">
            <input className="control w-full" placeholder="例如：-y @modelcontextprotocol/server-xxx" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} />
          </Field>
          <Field label="服务器 URL" hint="可选，使用 HTTP 传输时填写">
            <input className="control w-full" placeholder="例如：https://mcp.example.com/sse" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <button className="primary-btn" onClick={addServer}>确认添加</button>
            <button className="small-btn" onClick={() => setShowAdd(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>加载中…</div>
        ) : servers.length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>未配置 MCP 服务器。点击“添加服务器”开始。</div>
        ) : (
          servers.map((s) => (
            <div key={s.id} className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusColor(s.status) }} title={s.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{s.name}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {s.command ? `stdio · ${s.command}` : s.url ? `HTTP · ${s.url}` : "未配置传输"}
                    {s.tool_count > 0 && ` · ${s.tool_count} 工具`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button className="small-btn" onClick={async () => { try { onNotice(await mcpTestServer(s.id)); } catch (e) { onNotice(String(e)); } }}>测试</button>
                  <button className="icon-btn" title="删除" onClick={async () => { try { await mcpRemoveServer(s.id); await load(); } catch (e) { onNotice(String(e)); } }}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── PageSkills ──────────────────────────────────────

function PageSkills({ settings, onSave, onNotice }: { settings: DesktopSettings; onSave: (v: DesktopSettings) => Promise<void>; onNotice: (s: string) => void }) {
  const [view, setView] = useState<CapabilityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    capabilityView("skills").then(setView).catch((e) => onNotice(String(e))).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const items = view?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => [i.name, i.description, i.path].join(" ").toLowerCase().includes(q));
  }, [query, view]);

  const toggle = async (item: CapabilityItem, enabled: boolean) => {
    await onSave({ ...settings, feature_toggles: { ...settings.feature_toggles, [item.toggle_key]: enabled } });
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
          <Search size={13} style={{ color: "var(--text-muted)" }} />
          <input className="flex-1 bg-transparent border-none outline-none text-xs" placeholder="搜索技能…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="small-btn" onClick={() => { setLoading(true); capabilityView("skills").then(setView).finally(() => setLoading(false)); }}><RefreshCw size={12} /> 重新扫描</button>
      </div>
      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>正在扫描本机技能目录…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>未发现技能。请确认 ~/.wth/skills 或工作区 .wth/skills 目录存在。</div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{item.name}</div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{item.description}</div>
                <div className="text-[9px] mt-0.5 truncate" style={{ color: "var(--text-dim)" }}>{item.path}</div>
              </div>
              <Toggle checked={settings.feature_toggles[item.toggle_key] ?? item.enabled} onChange={(v) => void toggle(item, v)} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── PagePlugins ─────────────────────────────────────

function PagePlugins({ settings, onSave, onNotice }: { settings: DesktopSettings; onSave: (v: DesktopSettings) => Promise<void>; onNotice: (s: string) => void }) {
  const [tab, setTab] = useState<"installed" | "market">("installed");
  const [view, setView] = useState<CapabilityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [market, setMarket] = useState<PluginMarketItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const loadInstalled = async () => {
    setLoading(true);
    capabilityView("plugins").then(setView).catch((e) => onNotice(String(e))).finally(() => setLoading(false));
  };
  useEffect(() => { void loadInstalled(); }, []);

  const loadMarket = async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      const res = await pluginMarketList();
      setMarket(res.entries);
      if (res.error) setMarketError(res.error);
    } catch (e) {
      setMarketError(String(e));
    } finally {
      setMarketLoading(false);
    }
  };
  useEffect(() => {
    if (tab === "market") void loadMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const toggle = async (item: CapabilityItem, enabled: boolean) => {
    await onSave({ ...settings, feature_toggles: { ...settings.feature_toggles, [item.toggle_key]: enabled } });
  };

  const installFromMarket = async (item: PluginMarketItem) => {
    const entry: PluginMarketEntry = item.entry;
    const perms = entry.permissions.join("、") || "无特殊权限";
    const confirmMsg = item.installed
      ? `更新插件「${entry.name}」到 v${entry.version}？`
      : `安装插件「${entry.name}」v${entry.version}？\n作者：${entry.author}（${entry.verified ? "已验证" : "未验证"}）\n权限声明：${perms}\n\n高风险权限请谨慎确认。`;
    if (!window.confirm(confirmMsg)) return;
    setInstalling(entry.name);
    try {
      const msg = await pluginMarketInstall(entry);
      onNotice(msg);
      await loadMarket();
      await loadInstalled();
    } catch (e) {
      onNotice(String(e));
    } finally {
      setInstalling(null);
    }
  };

  const uninstallPlugin = async (name: string) => {
    if (!window.confirm(`确定卸载插件「${name}」？其技能与 hooks 将立即失效。`)) return;
    try {
      const msg = await pluginUninstall(name);
      onNotice(msg);
      await loadInstalled();
    } catch (e) {
      onNotice(String(e));
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <SegmentedControl
          size="sm"
          options={[
            { value: "installed", label: `已安装 (${view?.items.length ?? 0})` },
            { value: "market", label: "市场" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as "installed" | "market")}
        />
        <span className="grow" />
        {tab === "installed" ? (
          <button
            className="small-btn"
            onClick={async () => {
              const selected = await openDialog({ directory: true, multiple: false, title: "选择插件目录" });
              if (typeof selected !== "string") return;
              try {
                const msg = await pluginImport(selected);
                onNotice(msg);
                await loadInstalled();
              } catch (e) {
                onNotice(String(e));
              }
            }}
          >
            <FolderOpen size={12} /> 从本地导入
          </button>
        ) : (
          <button className="small-btn" onClick={() => void loadMarket()} disabled={marketLoading}>
            <RefreshCw size={12} /> 刷新市场
          </button>
        )}
      </div>

      {tab === "installed" ? (
        <div className="space-y-2">
          {loading ? (
            <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>加载中…</div>
          ) : (view?.items ?? []).length === 0 ? (
            <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>未安装插件。可切换到“市场”标签浏览并安装。</div>
          ) : (
            (view?.items ?? []).map((item) => (
              <div key={item.id} className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">{item.name}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{item.description}</div>
                    {expandedId === item.id && (
                      <div className="mt-2 text-[10px] space-y-1" style={{ color: "var(--text-dim)" }}>
                        <div>路径：{item.path}</div>
                        <div className="flex flex-wrap gap-1 mt-1">{item.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div>
                      </div>
                    )}
                    <button className="mt-1 text-[10px]" style={{ color: "var(--accent-blue)" }} onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                      {expandedId === item.id ? "收起详情" : "查看详情"}
                    </button>
                  </div>
                  <Toggle checked={settings.feature_toggles[item.toggle_key] ?? item.enabled} onChange={(v) => void toggle(item, v)} />
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {marketError && (
            <div className="rounded-xl p-3 text-[11px]" style={{ background: "var(--accent-red)", color: "#fff" }}>
              市场加载失败：{marketError}
            </div>
          )}
          {marketLoading ? (
            <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>正在加载插件市场…</div>
          ) : market.length === 0 ? (
            <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>
              {marketError ? "请检查网络后重试。" : "市场暂无插件。"}
            </div>
          ) : (
            market.map((item) => (
              <div key={item.entry.name} className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold truncate">{item.entry.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>v{item.entry.version}</span>
                      {item.entry.verified ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent-green)", color: "#fff" }}>已验证</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent-yellow)", color: "#000" }}>未验证</span>
                      )}
                      {item.has_update && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent-blue)", color: "#fff" }}>有更新</span>
                      )}
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{item.entry.description}</div>
                    <div className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>
                      作者：{item.entry.author} · 权限：{item.entry.permissions.join("、") || "无"}
                      {item.installed && item.installed_version && ` · 本地 v${item.installed_version}`}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {item.installed ? (
                      <>
                        <button
                          className="small-btn"
                          disabled={installing === item.entry.name}
                          onClick={() => void installFromMarket(item)}
                        >
                          {installing === item.entry.name ? "安装中…" : item.has_update ? "更新" : "重新安装"}
                        </button>
                        <button className="small-btn" style={{ color: "var(--accent-red)" }} onClick={() => void uninstallPlugin(item.entry.name)}>
                          卸载
                        </button>
                      </>
                    ) : (
                      <button
                        className="small-btn"
                        disabled={installing === item.entry.name}
                        onClick={() => void installFromMarket(item)}
                      >
                        {installing === item.entry.name ? "安装中…" : "安装"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}

// ─── PageMemory ──────────────────────────────────────

function PageMemory({ onNotice }: { onNotice: (s: string) => void }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [showNew, setShowNew] = useState(false);

  const handleSaveNew = async () => {
    try {
      await memoryWrite(newTitle.trim() || "记忆", newContent.trim());
      setNewTitle("");
      setNewContent("");
      setShowNew(false);
      await load();
      onNotice("记忆已保存");
    } catch (e) {
      onNotice(String(e));
    }
  };

  const load = async () => {
    setLoading(true);
    try { setEntries(await memoryList()); } catch (e) { onNotice(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);


  const allTags = useMemo(() => [...new Set(entries.flatMap((e) => e.tags))], [entries]);
  const filtered = tagFilter ? entries.filter((e) => e.tags.includes(tagFilter)) : entries;

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button className="small-btn" onClick={() => setShowNew((v) => !v)}>{showNew ? "收起新增" : "+ 新增记忆"}</button>
        <button className="small-btn" onClick={() => void load()}>刷新</button>
      </div>
      {showNew && (
        <div className="rounded-xl border p-3 mb-4 space-y-2" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
          <input
            className="w-full rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            placeholder="记忆标题（可选，留空自动生成）"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg border px-3 py-2 text-xs resize-y"
            style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            placeholder="记忆内容…"
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
          <button className="small-btn font-semibold" disabled={!newContent.trim()} onClick={handleSaveNew}>保存到记忆</button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button className={`small-btn ${!tagFilter ? "font-semibold" : ""}`} onClick={() => setTagFilter(null)}>全部</button>
        {allTags.map((tag) => (
          <button key={tag} className={`small-btn ${tagFilter === tag ? "font-semibold" : ""}`} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>{tag}</button>
        ))}
      </div>
      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>无记忆条目。</div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold truncate">{entry.title}</span>
                    <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>{entry.scope}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">{entry.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div>
                  <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{entry.summary}</div>
                  {expandedId === entry.id && (
                    <div className="mt-2 rounded-lg border p-2 text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)", color: "var(--text-muted)" }}>
                      {entry.content}
                    </div>
                  )}
                  <button className="mt-1 text-[10px]" style={{ color: "var(--accent-blue)" }} onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
                    {expandedId === entry.id ? "收起" : "展开全文"}
                  </button>
                </div>
                <button className="icon-btn shrink-0" title="删除" onClick={async () => {
                  try { await memoryDelete(entry.id); await load(); onNotice("记忆已删除"); } catch (e) { onNotice(String(e)); }
                }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── PageHooks ───────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  session_start: "会话开始",
  tool_before: "工具调用前",
  tool_after: "工具调用后",
  message_before: "消息发送前",
  message_after: "消息发送后",
};

function PageHooks({ onNotice }: { onNotice: (s: string) => void }) {
  const [hooks, setHooks] = useState<HookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", trigger: "tool_after", command: "" });

  const load = async () => {
    setLoading(true);
    try { setHooks(await hookList()); } catch (e) { onNotice(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);


  const addHook = async () => {
    if (!form.name.trim() || !form.command.trim()) { onNotice("名称和命令不能为空"); return; }
    try {
      await hookAdd({ name: form.name, trigger: form.trigger as HookConfig["trigger"], command: form.command, enabled: true });
      setShowAdd(false);
      setForm({ name: "", trigger: "tool_after", command: "" });
      await load();
      onNotice("Hook 已添加");
    } catch (e) { onNotice(String(e)); }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{hooks.length} 个 Hooks</div>
        <button className="primary-btn" onClick={() => setShowAdd(!showAdd)}><Plus size={13} /> 添加 Hook</button>
      </div>

      {showAdd && (
        <div className="mb-4 rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
          <div className="text-xs font-medium">新增 Hook</div>
          <Field label="Hook 名称" hint="用于在列表中识别">
            <input className="control w-full" placeholder="例如：格式化代码" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="触发时机" hint="选择事件发生后执行">
            <select className="control w-full" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
              {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="执行命令" hint="触发时运行的命令">
            <input className="control w-full" placeholder="例如：npx prettier --write" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <button className="primary-btn" onClick={addHook}>确认添加</button>
            <button className="small-btn" onClick={() => setShowAdd(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>加载中…</div>
        ) : hooks.length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>未配置 Hooks。</div>
        ) : (
          hooks.map((hook) => (
            <div key={hook.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold truncate">{hook.name}</span>
                  <Pill>{TRIGGER_LABELS[hook.trigger] || hook.trigger}</Pill>
                </div>
                <div className="text-[10px] mt-0.5 font-mono truncate" style={{ color: "var(--text-muted)" }}>{hook.command}</div>
              </div>
              <button className="icon-btn" title="删除" onClick={async () => { try { await hookRemove(hook.id); await load(); } catch (e) { onNotice(String(e)); } }}><Trash2 size={13} /></button>
              <Toggle checked={hook.enabled} onChange={async (v) => { try { await hookToggle(hook.id, v); await load(); } catch (e) { onNotice(String(e)); } }} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── PageSubagents ───────────────────────────────────

function PageSubagents({ onNotice }: { onNotice: (s: string) => void }) {
  const [agents, setAgents] = useState<SubagentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", system_prompt: "", model: "", tools: "" });

  const load = async () => {
    setLoading(true);
    try { setAgents(await subagentList()); } catch (e) { onNotice(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);


  const addAgent = async () => {
    if (!form.name.trim()) { onNotice("名称不能为空"); return; }
    try {
      await subagentAdd({
        name: form.name,
        description: form.description,
        system_prompt: form.system_prompt,
        model: form.model || "gpt-4.1",
        tools: form.tools ? form.tools.split(",").map((t) => t.trim()) : [],
        enabled: true,
      });
      setShowAdd(false);
      setForm({ name: "", description: "", system_prompt: "", model: "", tools: "" });
      await load();
      onNotice("子智能体已创建");
    } catch (e) { onNotice(String(e)); }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{agents.length} 个子智能体</div>
        <button className="primary-btn" onClick={() => setShowAdd(!showAdd)}><Plus size={13} /> 创建子智能体</button>
      </div>

      {showAdd && (
        <div className="mb-4 rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
          <div className="text-xs font-medium">新建子智能体</div>
          <Field label="子智能体名称" hint="用于在列表中识别">
            <input className="control w-full" placeholder="例如：代码审查员" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="用途描述" hint="说明它擅长做什么，帮助模型理解职责">
            <input className="control w-full" placeholder="例如：专门负责审查代码质量与潜在缺陷" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="系统提示词" hint="定义角色与行为，留空使用默认">
            <textarea className="control w-full h-20 resize-none" placeholder="例如：你是一名资深代码审查员，重点关注安全性…" value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} />
          </Field>
          <Field label="绑定模型" hint="留空使用默认模型">
            <input className="control w-full" placeholder="例如：gpt-4o、deepseek-chat" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="可用工具" hint="逗号分隔，留空表示不限制">
            <input className="control w-full" placeholder="例如：shell, git, lsp" value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <button className="primary-btn" onClick={addAgent}>确认创建</button>
            <button className="small-btn" onClick={() => setShowAdd(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>加载中…</div>
        ) : agents.length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>未配置子智能体。点击“创建子智能体”开始。</div>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)" }}>
                  <Bot size={15} style={{ color: "var(--accent-purple)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{agent.name}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{agent.description || "无描述"}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                    模型：{agent.model || "默认"}{agent.tools.length > 0 && ` · 工具：${agent.tools.join(", ")}`}
                  </div>
                </div>
                <button className="icon-btn" title="删除" onClick={async () => { try { await subagentRemove(agent.id); await load(); } catch (e) { onNotice(String(e)); } }}><Trash2 size={13} /></button>
                <Toggle checked={agent.enabled} onChange={async (v) => { try { await subagentToggle(agent.id, v); await load(); } catch (e) { onNotice(String(e)); } }} />
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── Shortcuts Page ──────────────────────────────────

const SHORTCUT_ACTIONS: { id: string; label: string; desc: string; global?: boolean }[] = [
  { id: "toggle_window", label: "显示/隐藏窗口", desc: "全局生效，修改后需重启应用", global: true },
  { id: "command_palette", label: "打开命令面板", desc: "Ctrl+K" },
  { id: "new_session", label: "新建会话", desc: "Ctrl+N" },
  { id: "open_settings", label: "打开设置", desc: "Ctrl+," },
  { id: "toggle_terminal", label: "切换终端面板", desc: "Ctrl+Shift+T" },
  { id: "toggle_theme", label: "切换深色/浅色", desc: "Ctrl+D" },
  { id: "send_message", label: "发送消息", desc: "Ctrl+Enter" },
];

const DEFAULT_SHORTCUTS: Record<string, string> = {
  toggle_window: "Alt+W",
  command_palette: "Ctrl+K",
  new_session: "Ctrl+N",
  open_settings: "Ctrl+,",
  toggle_terminal: "Ctrl+Shift+T",
  toggle_theme: "Ctrl+D",
  send_message: "Ctrl+Enter",
};

function formatKeys(keys: string): string {
  return keys.split("+").map((p) => p.trim()).join(" + ");
}

function PageShortcuts({
  settings,
  onSave,
  onNotice,
}: {
  settings: DesktopSettings;
  onSave: (v: DesktopSettings) => Promise<void>;
  onNotice: (s: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    ...DEFAULT_SHORTCUTS,
    ...(settings.shortcuts || {}),
  }));
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const recordingRef = useRef<string | null>(null);
  recordingRef.current = recordingId;

  // 录制组合键：全局捕获，仅允许带修饰键的组合
  useEffect(() => {
    if (!recordingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Super");
      if (parts.length === 0) return;
      let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (key === " ") key = "Space";
      if (key === "Control" || key === "Alt" || key === "Shift" || key === "Meta" || key.startsWith("Arrow")) return;
      const combo = [...parts, key].join("+");
      const id = recordingRef.current;
      if (id) {
        setDraft((prev) => ({ ...prev, [id]: combo }));
        setRecordingId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingId]);

  const handleSave = async () => {
    const seen = new Map<string, string>();
    for (const [id, keys] of Object.entries(draft)) {
      const normalized = keys.trim();
      if (!normalized) continue;
      const prev = seen.get(normalized);
      if (prev) {
        const labelA = SHORTCUT_ACTIONS.find((a) => a.id === prev)?.label || prev;
        const labelB = SHORTCUT_ACTIONS.find((a) => a.id === id)?.label || id;
        onNotice(`快捷键冲突：「${labelA}」与「${labelB}」使用了相同的 ${formatKeys(normalized)}`);
        return;
      }
      seen.set(normalized, id);
    }
    try {
      await onSave({ ...settings, shortcuts: draft });
      onNotice("快捷键已保存；全局快捷键（显示/隐藏窗口）需重启应用后生效");
    } catch (e) {
      onNotice(String(e));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <button className="small-btn font-semibold" onClick={handleSave}>保存快捷键</button>
        <button
          className="small-btn"
          onClick={() => {
            setDraft({ ...DEFAULT_SHORTCUTS });
            onNotice("已恢复默认快捷键，点击「保存快捷键」生效");
          }}
        >
          恢复默认
        </button>
      </div>
      {SHORTCUT_ACTIONS.map((s) => {
        const keys = draft[s.id] || DEFAULT_SHORTCUTS[s.id];
        const recording = recordingId === s.id;
        return (
          <div key={s.id} className="setting-row">
            <div className="l">
              <div className="n">{s.label}</div>
              {s.desc && (
                <div className="d" style={{ color: "var(--text-dim)" }}>{s.desc}</div>
              )}
            </div>
            <button
              className="rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors"
              style={{
                background: recording ? "var(--accent-blue)" : "var(--surface-2)",
                border: "1px solid var(--surface-3)",
                color: recording ? "#fff" : "var(--text-primary)",
                minWidth: "7rem",
              }}
              title={recording ? "按下新的组合键…" : "点击后按新的组合键"}
              onClick={() => setRecordingId(recording ? null : s.id)}
            >
              {recording ? "按下组合键…" : formatKeys(keys)}
            </button>
          </div>
        );
      })}
      <p className="text-[10px] pt-1" style={{ color: "var(--text-dim)" }}>
        点击按键框后直接按下组合键（如 Ctrl+Shift+K）即可录入；保存后前端快捷键立即生效。
      </p>
    </div>
  );
}

// ─── Usage Page ──────────────────────────────────────

function PageUsage({
  settings,
  onSave,
  onNotice,
}: {
  settings: DesktopSettings;
  onSave: (v: DesktopSettings) => Promise<void>;
  onNotice: (s: string) => void;
}) {
  const stats = settings.usage_stats;
  const fmt = (n: number) => n.toLocaleString();
  const resetStats = async () => {
    if (!window.confirm("确定清除全部用量统计吗？")) return;
    await onSave({
      ...settings,
      usage_stats: {
        total_tokens: 0,
        total_cost_usd: 0,
        today_tokens: 0,
        today_cost_usd: 0,
        week_tokens: 0,
        week_cost_usd: 0,
        last_updated: null,
      },
    });
    onNotice("用量统计已清除");
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="今日 Token" value={stats.today_tokens > 0 ? fmt(stats.today_tokens) : "0"} hint="输入 + 输出" />
        <StatCard label="本周 Token" value={stats.week_tokens > 0 ? fmt(stats.week_tokens) : "0"} hint="近 7 天" />
        <StatCard
          label="累计消耗"
          value={stats.total_cost_usd > 0 ? `$${stats.total_cost_usd.toFixed(2)}` : "$0.00"}
          hint={`${fmt(stats.total_tokens)} Tokens 总量`}
        />
      </div>
      <div className="rounded-xl border p-4 text-xs space-y-2" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
        <div className="flex items-center justify-between">
          <span style={{ color: "var(--text-muted)" }}>
            用量来自模型响应的真实 usage 数据，按 Token 单价估算费用，仅保存在本地。
          </span>
          <button
            onClick={resetStats}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-4)", color: "var(--text-primary)" }}
          >
            <Trash2 size={11} />
            清除统计
          </button>
        </div>
        {stats.last_updated && (
          <div style={{ color: "var(--text-dim)" }}>最近更新：{stats.last_updated}</div>
        )}
      </div>
    </div>
  );
}

// ─── Diagnostics Page ────────────────────────────────

function PageDiagnostics({ onNotice }: { onNotice: (s: string) => void }) {
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logFilter, setLogFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setItems(await diagnosticsGet());
    } catch (e) {
      onNotice(`诊断失败：${e}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);


  const statusColor = (status: string) =>
    status === "ok" ? "var(--accent-green)" : status === "warn" ? "var(--accent-yellow)" : "var(--accent-red)";
  const statusLabel = (status: string) =>
    status === "ok" ? "正常" : status === "warn" ? "警告" : "异常";

  return (
    <>
      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>正在采集诊断数据…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>暂无诊断数据。</div>
        ) : (
          items.map((item) => (
            <div key={item.name} className="setting-row">
              <ShieldCheck size={15} style={{ color: statusColor(item.status) }} />
              <div className="l">
                <div className="n">{item.name}</div>
                <div className="d text-[10px]" style={{ color: "var(--text-dim)" }}>
                  {item.detail.split("\n").length > 1 ? (
                    expanded === item.name ? (
                      <pre className="whitespace-pre-wrap text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{item.detail}</pre>
                    ) : (
                      <span>{item.detail.split("\n")[0]}…</span>
                    )
                  ) : (
                    item.detail
                  )}
                </div>
                {item.detail.split("\n").length > 1 && (
                  <button
                    className="mt-1 text-[10px]"
                    style={{ color: "var(--accent-blue)" }}
                    onClick={() => setExpanded(expanded === item.name ? null : item.name)}
                  >
                    {expanded === item.name ? "收起" : "展开全部"}
                  </button>
                )}
              </div>
              <span className="text-xs" style={{ color: statusColor(item.status) }}>{statusLabel(item.status)}</span>
            </div>
          ))
        )}
      </div>
      <button className="primary-btn mt-4" onClick={() => void load()} disabled={loading}>
        重新运行诊断
      </button>

      <div className="mt-6">
        <div className="stitle">实时日志</div>
        <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
          最近 200 条运行日志（已脱敏，不含密钥），每 2 秒自动刷新。
        </p>
        <div className="flex items-center gap-2 mb-2">
          <input
            className="control flex-1"
            placeholder="输入关键词过滤日志…"
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
          />
          <button
            className="small-btn"
            onClick={() => {
              const text = logs.join("\n");
              void navigator.clipboard.writeText(text);
              onNotice(`已复制 ${logs.length} 条日志`);
            }}
          >
            复制日志
          </button>
          <button
            className="small-btn"
            onClick={() => {
              logList().then(setLogs).catch(() => {});
            }}
          >
            刷新
          </button>
        </div>
        <div
          className="rounded-lg p-3 font-mono text-[10px] leading-relaxed overflow-auto max-h-64 whitespace-pre-wrap"
          style={{ background: "var(--surface-1)", color: "var(--text-muted)" }}
        >
          {logs.length === 0 ? (
            <span>暂无运行日志</span>
          ) : (
            logs
              .filter((line) => {
                const q = logFilter.trim().toLowerCase();
                if (!q) return true;
                return line.toLowerCase().includes(q);
              })
              .slice(-200)
              .map((line, i) => {
                const color = line.includes(" ERROR ") || line.includes(" error ")
                  ? "var(--accent-red)"
                  : line.includes(" WARN ") || line.includes(" warn ")
                    ? "var(--accent-yellow)"
                    : line.includes(" DEBUG ")
                      ? "var(--accent-blue)"
                      : "var(--text-muted)";
                return (
                  <div key={i} style={{ color }}>
                    {line}
                  </div>
                );
              })
          )}
        </div>
      </div>
    </>
  );
}

// ─── About Page ──────────────────────────────────────

function PageAbout({ onNotice }: { onNotice: (s: string) => void }) {
  const [app, setApp] = useState<AppInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [downloadResult, setDownloadResult] = useState<UpdateDownloadResult | null>(null);

  useEffect(() => {
    void appInfo().then(setApp).catch(() => {});
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const info = await updateCheck();
      setResult(info);
      if (!info.has_update) onNotice(`已是最新版本 v${info.current_version}`);
    } catch (e) {
      onNotice(`检查更新失败：${e}`);
    } finally {
      setChecking(false);
    }
  };

  const runDownload = async () => {
    setDownloading(true);
    setProgress(null);
    setDownloadResult(null);
    const dispose = await listen<UpdateProgress>("update:progress", (event) => {
      setProgress(event.payload);
    });
    try {
      const res = await updateDownload();
      setDownloadResult(res);
      if (!res.verified) {
        onNotice("下载完成，但 Release 未声明哈希，未能自动校验，请谨慎安装。");
      } else {
        onNotice(`安装包下载完成（${(res.bytes / 1024 / 1024).toFixed(1)} MB），SHA-256 校验通过。`);
      }
    } catch (e) {
      onNotice(`下载失败：${e}`);
    } finally {
      dispose();
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-xl border p-6 space-y-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
      <div className="text-2xl font-bold">
        WTH <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>v{app?.version ?? "…"}</span>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        基于 Tauri 2、React 和 WTH Agent Core。开源、隐私优先的桌面 AI 编码代理。
      </p>
      <div className="flex gap-2 flex-wrap text-[10px]" style={{ color: "var(--text-dim)" }}>
        <span>构建时间：{app?.build_time || "未知"}</span>
        <span>
          签名状态：
          {app?.signed ? (
            <span style={{ color: "var(--accent-green)" }}>已签名</span>
          ) : (
            <span style={{ color: "var(--accent-yellow)" }}>未签名（SmartScreen 可能提示未知发布者）</span>
          )}
        </span>
      </div>
      <div className="flex gap-2 flex-wrap">
        <a className="small-btn" href="https://github.com/Wan-1230/Wide-Thought-Host" target="_blank" rel="noreferrer">
          <Github size={12} /> 项目主页
        </a>
        <a className="small-btn" href="https://github.com/Wan-1230/Wide-Thought-Host/blob/main/docs/user-guide/getting-started.md" target="_blank" rel="noreferrer">
          <CircleHelp size={12} /> 用户手册
        </a>
        <button className="small-btn" onClick={runCheck} disabled={checking}>
          {checking ? "检查中…" : "检查更新"}
        </button>
      </div>

      {result && result.has_update && (
        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--accent-yellow)", background: "var(--surface-1)" }}>
          <div className="text-xs font-semibold">
            发现新版本 v{result.latest_version}（当前 v{result.current_version}）
          </div>
          {result.notes && (
            <div className="text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto" style={{ color: "var(--text-muted)" }}>
              {result.notes}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {!downloadResult && (
              <button className="small-btn font-semibold" onClick={() => void runDownload()} disabled={downloading}>
                {downloading ? "下载中…" : "下载并安装"}
              </button>
            )}
            {result.release_url && (
              <button className="small-btn" onClick={() => openUrl(result.release_url)}>
                打开下载页
              </button>
            )}
          </div>
          {progress && (
            <div className="space-y-1">
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                下载中：{(progress.received / 1024 / 1024).toFixed(1)} / {(progress.total / 1024 / 1024).toFixed(1)} MB（{progress.percent}%）
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
                <div className="h-full transition-all" style={{ width: `${progress.percent}%`, background: "var(--accent-blue)" }} />
              </div>
            </div>
          )}
          {downloadResult && (
            <div className="rounded-xl p-3 text-[11px] space-y-1" style={{ background: "var(--surface-2)" }}>
              <div>安装包已就绪：{downloadResult.file_name}（{(downloadResult.bytes / 1024 / 1024).toFixed(1)} MB）</div>
              <div style={{ color: "var(--text-muted)" }}>SHA-256：{downloadResult.sha256.slice(0, 24)}… {downloadResult.verified ? "（校验通过）" : "（未校验）"}</div>
              <div className="flex gap-2 pt-1">
                <button
                  className="small-btn font-semibold"
                  style={{ color: "var(--accent-green)" }}
                  onClick={() => {
                    const ok = window.confirm("即将启动安装程序，请先保存工作并关闭 WTH。确定继续吗？");
                    if (ok) void openUrl(downloadResult.file_path);
                  }}
                >
                  启动安装程序
                </button>
                <button className="small-btn" onClick={() => void openPathInExplorer(downloadResult.file_path)}>
                  打开所在文件夹
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ───────────────────────────────

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="l">
        <div className="n">{label}</div>
        {hint && <div className="h">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors"
      style={{ background: checked ? "var(--accent-blue)" : "var(--surface-4)" }}
    >
      <span
        className="block w-4 h-4 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "none" }}
      />
    </button>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
      <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{hint}</div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px]" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
      {children}
    </span>
  );
}

/** F-08: 通用搜索引擎 Key 输入行（Brave / Bing / Perplexity）。 */
function SearchKeyRow({
  engine,
  onNotice,
}: {
  engine: string;
  onNotice: (msg: string) => void;
}) {
  const [key, setKey] = useState("");
  const labels: Record<string, { label: string; placeholder: string }> = {
    brave: { label: "Brave API Key", placeholder: "BSA..." },
    bing: { label: "Bing API Key", placeholder: "Azure 订阅密钥" },
    perplexity: { label: "Perplexity API Key", placeholder: "pplx-xxxxxxxx" },
  };
  const meta = labels[engine] ?? { label: engine, placeholder: "" };
  return (
    <SettingRow label={meta.label} hint="写入 Windows 凭据管理器，仅用于当前搜索引擎">
      <div className="flex items-center gap-2">
        <input
          className="control w-64"
          type="password"
          placeholder={meta.placeholder}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          onClick={async () => {
            try {
              if (key.trim()) {
                await setServiceApiKey(engine, key.trim());
                onNotice(`${meta.label} 已保存`);
              } else {
                await clearServiceApiKey(engine);
                onNotice(`${meta.label} 已清除`);
              }
              setKey("");
            } catch (error) {
              onNotice(`保存失败：${String(error)}`);
            }
          }}
          className="px-3 py-1.5 rounded-md text-[11px] font-medium text-white"
          style={{ background: "var(--accent-blue)" }}
        >
          保存
        </button>
      </div>
    </SettingRow>
  );
}
