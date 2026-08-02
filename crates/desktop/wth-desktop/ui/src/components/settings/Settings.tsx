import { useEffect, useMemo, useState } from "react";
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
  subagentList,
  subagentAdd,
  subagentRemove,
  subagentToggle,
  memoryList,
  memoryDelete,
  type CapabilityItem,
  type CapabilitySource,
  type CapabilityView,
  type DesktopSettings,
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
} from "@/lib/ipc";
import { SegmentedControl } from "@/components/common/SegmentedControl";

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
  web_search_engine: "bing",
  headroom_enabled: false,
  headroom_port: 8787,
};

const blankProviderConfig: ProviderConfig = {
  id: "",
  name: "",
  kind: "openai-compatible",
  base_url: "",
  model: "",
  enabled: true,
};

// ─── Main Modal ──────────────────────────────────────

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialPage?: PageId;
}

export function SettingsModal({ open, onClose, initialPage }: SettingsModalProps) {
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
    return <PageModels providers={providers} onRefresh={onRefresh} onNotice={onNotice} />;
  }
  if (page === "appearance") {
    return <PageAppearance settings={settings} onSave={onSave} />;
  }
  if (page === "about") {
    return <PageAbout />;
  }
  if (page === "diagnostics") {
    return <PageDiagnostics onNotice={onNotice} />;
  }
  if (page === "shortcuts") {
    return <PageShortcuts />;
  }
  if (page === "usage") {
    return <PageUsage />;
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
  return <PageGeneral settings={settings} onSave={onSave} />;
}

// ─── General Page ────────────────────────────────────

function PageGeneral({ settings, onSave }: { settings: DesktopSettings; onSave: (v: DesktopSettings) => Promise<void> }) {
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
        <SettingRow label="预算上限 (USD)" hint="单次会话最大花费，留空为不限制">
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
      </section>

      <section className="section">
        <div className="stitle">搜索</div>
        <SettingRow label="Web 搜索引擎" hint="Agent 联网搜索时使用的引擎">
          <select
            className="control w-44"
            value={settings.web_search_engine}
            onChange={(e) => onSave({ ...settings, web_search_engine: e.target.value })}
          >
            <option value="bing">Bing</option>
            <option value="searxng">SearXNG</option>
            <option value="tavily">Tavily</option>
            <option value="brave">Brave</option>
            <option value="perplexity">Perplexity</option>
          </select>
        </SettingRow>
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
        <div className="stitle">Token 优化</div>
        <HeadroomSection settings={settings} onSave={onSave} />
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
  onRefresh,
  onNotice,
}: {
  providers: ProviderSummary[];
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

  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
      <div className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>我的模型</div>
          <button className="small-btn" onClick={startNew}>
            <Plus size={12} /> 新增
          </button>
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
  const [view, setView] = useState<CapabilityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    capabilityView("plugins").then(setView).catch((e) => onNotice(String(e))).finally(() => setLoading(false));
  }, []);

  const toggle = async (item: CapabilityItem, enabled: boolean) => {
    await onSave({ ...settings, feature_toggles: { ...settings.feature_toggles, [item.toggle_key]: enabled } });
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{view?.items.length ?? 0} 个插件</div>
        <div className="flex gap-2">
          <button className="small-btn" onClick={() => onNotice("本地导入功能待集成")}><FolderOpen size={12} /> 从本地导入</button>
          <button className="small-btn" onClick={() => onNotice("插件市场即将上线")}><Puzzle size={12} /> 从市场安装</button>
        </div>
      </div>
      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>加载中…</div>
        ) : (view?.items ?? []).length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>未安装插件。</div>
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
                      <div>权限：文件系统、网络</div>
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
    </>
  );
}

// ─── PageMemory ──────────────────────────────────────

function PageMemory({ onNotice }: { onNotice: (s: string) => void }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

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
                    模型：{agent.model}{agent.tools.length > 0 && ` · 工具：${agent.tools.join(", ")}`}
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

function PageShortcuts() {
  const shortcuts = [
    { keys: "Ctrl + K", action: "打开命令面板" },
    { keys: "Ctrl + N", action: "新建会话" },
    { keys: "Ctrl + ,", action: "打开设置" },
    { keys: "Ctrl + Shift + T", action: "切换终端面板" },
    { keys: "Ctrl + D", action: "切换深色/浅色" },
    { keys: "Escape", action: "关闭弹窗/取消" },
    { keys: "Ctrl + Enter", action: "发送消息" },
    { keys: "Ctrl + Shift + C", action: "复制最后回复" },
  ];

  return (
    <div className="space-y-2">
      {shortcuts.map((s) => (
        <div key={s.keys} className="setting-row">
          <div className="l">
            <div className="n">{s.action}</div>
          </div>
          <kbd
            className="rounded-md px-2.5 py-1 text-[11px] font-mono"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-3)" }}
          >
            {s.keys}
          </kbd>
        </div>
      ))}
    </div>
  );
}

// ─── Usage Page ──────────────────────────────────────

function PageUsage() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="今日 Token" value="—" hint="输入 + 输出" />
        <StatCard label="本周会话" value="—" hint="活跃会话数" />
        <StatCard label="累计消耗" value="—" hint="估算 USD" />
      </div>
      <div className="rounded-xl border p-6 text-center text-xs" style={{ borderColor: "var(--surface-3)", color: "var(--text-muted)" }}>
        用量统计功能即将上线，当前版本暂不支持历史数据聚合。
      </div>
    </div>
  );
}

// ─── Diagnostics Page ────────────────────────────────

function PageDiagnostics({ onNotice }: { onNotice: (s: string) => void }) {
  const checks = [
    ["WebView2", "正常"],
    ["Git", "待运行检查"],
    ["Shell", "自动检测"],
    ["Agent 核心", "已链接"],
    ["凭据存储", "Windows Credential Manager"],
  ];

  return (
    <>
      <div className="space-y-2">
        {checks.map(([a, b]) => (
          <div key={a} className="setting-row">
            <ShieldCheck size={15} style={{ color: "var(--accent-green)" }} />
            <div className="l"><div className="n">{a}</div></div>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{b}</span>
          </div>
        ))}
      </div>
      <button className="primary-btn mt-4" onClick={() => onNotice("诊断检查已刷新")}>
        运行诊断
      </button>
    </>
  );
}

// ─── About Page ──────────────────────────────────────

function PageAbout() {
  return (
    <div className="rounded-xl border p-6 space-y-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
      <div className="text-2xl font-bold">
        WTH <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>v0.1.0</span>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        基于 Tauri 2、React 和 WTH Agent Core。开源、隐私优先的桌面 AI 编码代理。
      </p>
      <div className="flex gap-2 flex-wrap">
        <a className="small-btn" href="https://github.com" target="_blank" rel="noreferrer">
          <Github size={12} /> 项目主页
        </a>
        <button className="small-btn"><Code2 size={12} /> Apache-2.0</button>
        <button className="small-btn"><CircleHelp size={12} /> 隐私说明</button>
      </div>
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
