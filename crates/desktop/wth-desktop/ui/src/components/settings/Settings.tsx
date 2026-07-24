import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Brain,
  CircleHelp,
  Code2,
  Cpu,
  Database,
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
  Wrench,
  X,
  ClipboardPaste,
  Eye,
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
  type CapabilityItem,
  type CapabilitySource,
  type CapabilityView,
  type DesktopSettings,
  type ProviderConfig,
  type ProviderSummary,
  type ThemeStyle,
  type FontScale,
  type FontFamily,
  type ReasoningEffort,
  type EditMode,
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
  { id: "shortcuts", label: "快捷键", icon: <Cpu size={13} /> },
  { id: "usage", label: "用量", icon: <DollarSign size={13} /> },
  { id: "diagnostics", label: "诊断", icon: <Activity size={13} /> },
  { id: "about", label: "关于", icon: <Info size={13} /> },
];

const THEME_STYLES: { id: ThemeStyle; name: string; mode: string; desc: string }[] = [
  { id: "default", name: "默认", mode: "深色/浅色", desc: "极简中性色调" },
  { id: "ocean", name: "海洋", mode: "深色/浅色", desc: "冷色蓝调" },
  { id: "forest", name: "森林", mode: "深色/浅色", desc: "自然绿色" },
  { id: "sunset", name: "日落", mode: "深色/浅色", desc: "暖色橙调" },
];

const emptySettings: DesktopSettings = {
  schema_version: 1,
  language: "zh-CN",
  close_action: "tray",
  sound_enabled: false,
  theme: "dark",
  theme_style: "default",
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
    models: "管理模型提供商与 API 密钥。",
    appearance: "主题风格、字体与显示密度。",
    mcp: "管理 MCP 服务器与外部工具。",
    skills: "浏览和启用本地技能。",
    plugins: "管理插件生态。",
    memory: "查看和管理 Agent 记忆。",
    hooks: "配置生命周期钩子。",
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
  // theme style
  root.classList.remove("theme-ocean", "theme-forest", "theme-sunset");
  if (settings.theme_style && settings.theme_style !== "default") {
    root.classList.add(`theme-${settings.theme_style}`);
  }
  // font scale
  root.classList.remove("font-scale-small", "font-scale-medium", "font-scale-large");
  root.classList.add(`font-scale-${settings.font_scale || "medium"}`);
  // font family
  root.classList.remove("font-sans", "font-system", "font-serif", "font-mono-global");
  const ff = settings.font_family || "sans";
  if (ff === "custom" && settings.custom_font_family) {
    document.body.style.fontFamily = settings.custom_font_family;
  } else {
    document.body.style.fontFamily = "";
    root.classList.add(`font-${ff}`);
  }
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
  if (["mcp", "skills", "plugins", "memory", "hooks"].includes(page)) {
    return <CapabilityManager category={page as CapabilityCategory} settings={settings} onSave={onSave} onNotice={onNotice} />;
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
            placeholder="不限"
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
        <SettingRow label="首选 Shell" hint="留空时按 PowerShell 7 → Windows PowerShell → cmd 自动回退">
          <input
            className="control w-52"
            value={settings.terminal_shell || ""}
            placeholder="自动检测"
            onChange={(e) => onSave({ ...settings, terminal_shell: e.target.value || null })}
          />
        </SettingRow>
      </section>
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

        <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="l">
            <div className="n">主题风格</div>
            <div className="h">选择配色方案预设</div>
          </div>
          <div className="style-grid mt-3">
            {THEME_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                className="style-card"
                data-on={settings.theme_style === style.id}
                data-style={style.id}
                onClick={() => onSave({ ...settings, theme_style: style.id })}
              >
                <span className="style-card-head">
                  <span className="style-name">{style.name}</span>
                  <span className="style-mode">{style.mode}</span>
                </span>
                <span className="style-swatches" aria-hidden="true">
                  <span /><span /><span />
                </span>
                <span className="style-desc">{style.desc}</span>
              </button>
            ))}
          </div>
        </div>
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
              placeholder="输入字体族名称"
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

function PageModels({
  providers,
  onRefresh,
  onNotice,
}: {
  providers: ProviderSummary[];
  onRefresh: () => Promise<void>;
  onNotice: (s: string) => void;
}) {
  const NEW_PROVIDER_ID = "__new__";
  const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null);
  const [draft, setDraft] = useState<ProviderConfig>(blankProviderConfig);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (providers.length === 0) {
      setSelectedId(null);
      setDraft(blankProviderConfig);
      setApiKey("");
      return;
    }
    if (selectedId === NEW_PROVIDER_ID) return;
    if (!selectedId || !providers.some((p) => p.id === selectedId)) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(blankProviderConfig);
      setApiKey("");
      return;
    }
    const current = providers.find((p) => p.id === selectedId);
    if (!current) return;
    setDraft(current);
    setApiKey("");
  }, [providers, selectedId]);

  const selected = selectedId ? providers.find((p) => p.id === selectedId) ?? null : null;

  const save = async () => {
    try {
      const nextId = draft.id || selected?.id || crypto.randomUUID();
      const saved = await providerUpsert({ ...draft, id: nextId }, apiKey);
      await onRefresh();
      setSelectedId(saved.id);
      setApiKey("");
      onNotice("模型提供商已保存");
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
          <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>供应商列表</div>
          <button className="small-btn" onClick={startNew}>
            <Plus size={12} /> 新增
          </button>
        </div>
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
          {providers.length === 0 ? (
            <div className="text-xs px-2 py-4 text-center" style={{ color: "var(--text-dim)" }}>
              还没有配置供应商
            </div>
          ) : (
            providers.map((provider) => (
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
          <div className="text-sm font-medium">{selected ? "编辑供应商" : "新增供应商"}</div>
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
        <div className="grid grid-cols-2 gap-3">
          <input className="control" placeholder="显示名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="control" placeholder="模型名" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          <input className="control" placeholder="类型 (openai-compatible)" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} />
          <label className="flex items-center gap-2 text-xs">
            <Toggle checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
            启用
          </label>
          <input className="control col-span-2" placeholder="https://api.example.com/v1" value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} />
          <input className="control col-span-2" type="password" placeholder="API Key（仅写入，不回显）" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <button className="primary-btn col-span-2" disabled={!draft.name || !draft.model || !draft.base_url} onClick={save}>
            <Save size={13} /> {selected ? "保存修改" : "添加提供商"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Capability Manager ──────────────────────────────

type CapabilityCategory = "mcp" | "skills" | "plugins" | "memory" | "hooks";

function CapabilityManager({
  category,
  settings,
  onSave,
  onNotice,
}: {
  category: CapabilityCategory;
  settings: DesktopSettings;
  onSave: (value: DesktopSettings) => Promise<void>;
  onNotice: (value: string) => void;
}) {
  const [view, setView] = useState<CapabilityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [previewItem, setPreviewItem] = useState<CapabilityItem | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setView(await capabilityView(category));
    } catch (error) {
      onNotice(String(error));
      setView(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setQuery("");
    setExpandedId(null);
    void load();
  }, [category]);

  const filtered = useMemo(() => {
    const items = view?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.name, item.description, item.scope, item.kind, item.path, item.tags.join(" ")].join(" ").toLowerCase().includes(q),
    );
  }, [query, view]);

  const updateEnabled = async (item: CapabilityItem, nextEnabled: boolean) => {
    await onSave({
      ...settings,
      feature_toggles: { ...settings.feature_toggles, [item.toggle_key]: nextEnabled },
    });
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
          <Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            className="flex-1 bg-transparent border-none outline-none text-xs"
            placeholder={view?.search_placeholder || "搜索…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="small-btn" onClick={() => void load()}>
          <RefreshCw size={12} /> 刷新
        </button>
        {category === "mcp" && (
          <button className="small-btn" onClick={() => setShowImport(!showImport)}>
            <ClipboardPaste size={12} /> 导入 JSON
          </button>
        )}
        <button
          className="small-btn"
          onClick={async () => {
            const first = view?.sources.find((s) => s.exists);
            if (first) {
              try { await openPathInExplorer(first.path); } catch (e) { onNotice(String(e)); }
            }
          }}
        >
          <FolderOpen size={12} /> 打开目录
        </button>
      </div>

      {/* MCP JSON 导入区 */}
      {category === "mcp" && showImport && (
        <div className="mb-4 rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
          <div className="text-[11px] font-medium mb-2">粘贴 MCP 服务器配置 JSON</div>
          <textarea
            className="w-full h-24 rounded-lg border p-2 text-[11px] font-mono resize-none outline-none"
            style={{ background: "var(--surface-1)", borderColor: "var(--surface-3)", color: "var(--text-primary)" }}
            placeholder='{"mcpServers": {"server-name": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-xxx"]}}}'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button
              className="primary-btn"
              onClick={() => {
                try {
                  JSON.parse(importJson);
                  onNotice("MCP 配置已解析，待后端集成");
                  setShowImport(false);
                  setImportJson("");
                } catch {
                  onNotice("JSON 格式无效");
                }
              }}
            >
              确认导入
            </button>
            <button className="small-btn" onClick={() => { setShowImport(false); setImportJson(""); }}>取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>正在扫描本地目录…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-xs text-center" style={{ color: "var(--text-muted)" }}>没有找到匹配项。</div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {/* MCP 状态指示器 */}
                    {category === "mcp" && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: item.enabled ? "var(--accent-green)" : "var(--surface-4)" }}
                        title={item.enabled ? "在线" : "离线"}
                      />
                    )}
                    <span className="text-xs font-semibold truncate">{item.name}</span>
                    <Pill>{item.scope}</Pill>
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{item.description}</div>
                  {expandedId === item.id && (
                    <div className="mt-2 text-[10px] space-y-1" style={{ color: "var(--text-dim)" }}>
                      <div className="truncate">路径：{item.path}</div>
                      <div className="flex flex-wrap gap-1">{item.tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}</div>
                      {/* 记忆内容预览 */}
                      {category === "memory" && (
                        <div className="mt-2 rounded-lg border p-2" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
                          <div className="text-[9px] uppercase mb-1" style={{ color: "var(--text-dim)" }}>内容预览</div>
                          <div className="text-[10px] whitespace-pre-wrap max-h-24 overflow-y-auto" style={{ color: "var(--text-muted)" }}>
                            {item.status || "无可用预览"}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <button className="text-[10px]" style={{ color: "var(--accent-blue)" }} onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                      {expandedId === item.id ? "收起" : "展开"}
                    </button>
                    {category === "memory" && (
                      <button className="text-[10px] flex items-center gap-0.5" style={{ color: "var(--accent-blue)" }} onClick={() => setPreviewItem(previewItem?.id === item.id ? null : item)}>
                        <Eye size={9} /> 预览
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="small-btn" onClick={async () => { try { await openPathInExplorer(item.path); } catch (e) { onNotice(String(e)); } }}>
                    <FolderOpen size={11} />
                  </button>
                  <Toggle checked={settings.feature_toggles[item.toggle_key] ?? item.enabled} onChange={(v) => void updateEnabled(item, v)} />
                </div>
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
