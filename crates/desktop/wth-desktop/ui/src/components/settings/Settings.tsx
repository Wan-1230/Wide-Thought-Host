import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Brain,
  ChevronRight,
  CircleHelp,
  Code2,
  Database,
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
} from "@/lib/ipc";

type Category =
  | "general"
  | "models"
  | "appearance"
  | "mcp"
  | "skills"
  | "plugins"
  | "memory"
  | "hooks"
  | "diagnostics"
  | "about";

type CapabilityCategory = Exclude<Category, "general" | "models" | "appearance" | "diagnostics" | "about">;

const groups: { title: string; items: { id: Category; label: string; icon: ReactNode }[] }[] = [
  {
    title: "基础",
    items: [
      { id: "general", label: "通用", icon: <Settings2 size={16} /> },
      { id: "models", label: "模型与 API", icon: <Server size={16} /> },
      { id: "appearance", label: "外观", icon: <Palette size={16} /> },
    ],
  },
  {
    title: "扩展能力",
    items: [
      { id: "mcp", label: "MCP 与工具", icon: <Plug size={16} /> },
      { id: "skills", label: "技能", icon: <Sparkles size={16} /> },
      { id: "plugins", label: "插件", icon: <Puzzle size={16} /> },
      { id: "memory", label: "记忆", icon: <Brain size={16} /> },
      { id: "hooks", label: "Hooks", icon: <Webhook size={16} /> },
    ],
  },
  {
    title: "系统",
    items: [
      { id: "diagnostics", label: "诊断", icon: <Activity size={16} /> },
      { id: "about", label: "关于", icon: <Info size={16} /> },
    ],
  },
];

const emptySettings: DesktopSettings = {
  schema_version: 1,
  language: "zh-CN",
  close_action: "tray",
  sound_enabled: false,
  theme: "light",
  session_display: "standard",
  terminal_shell: null,
  active_workspace: null,
  recent_workspaces: [],
  default_provider_id: null,
  providers: [],
  feature_toggles: {},
  legacy_migration_complete: false,
  github_user: null,
};

const blankProviderConfig: ProviderConfig = {
  id: "",
  name: "",
  kind: "openai-compatible",
  base_url: "",
  model: "",
  enabled: true,
};

export function SettingsPanel() {
  const [category, setCategory] = useState<Category>("general");
  const [settings, setSettings] = useState<DesktopSettings>(emptySettings);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    setBusy(true);
    try {
      const [next, list] = await Promise.all([settingsGet(), providerList()]);
      setSettings(next);
      setProviders(list);
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(next.theme);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const save = async (next: DesktopSettings) => {
    try {
      const saved = await settingsUpdate(next);
      setSettings(saved);
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(saved.theme);
      setNotice("设置已保存");
    } catch (error) {
      setNotice(`保存失败：${error}`);
    }
  };

  return (
    <div className="h-full flex" style={{ background: "var(--bg-body)" }}>
      <aside
        className="w-64 border-r overflow-y-auto p-3"
        style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}
      >
        <div className="px-2 pb-3 text-sm font-semibold">设置中心</div>
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <div className="px-2 mb-1 text-[10px] uppercase tracking-widest" style={{ color: "var(--text-dim)" }}>
              {group.title}
            </div>
            {group.items.map((item) => {
              const active = category === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCategory(item.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] mb-0.5 hover:bg-surface-2"
                  style={{
                    background: active ? "var(--surface-2)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronRight size={12} />
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          {busy ? (
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              正在加载设置…
            </div>
          ) : (
            <SettingsContent
              category={category}
              settings={settings}
              providers={providers}
              onSave={save}
              onRefresh={refresh}
              onNotice={setNotice}
            />
          )}

          {notice && (
            <div
              className="fixed bottom-5 right-5 px-4 py-2 rounded-xl shadow-lg text-xs cursor-pointer"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
              onClick={() => setNotice("")}
            >
              {notice}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function SettingsContent({
  category,
  settings,
  providers,
  onSave,
  onRefresh,
  onNotice,
}: {
  category: Category;
  settings: DesktopSettings;
  providers: ProviderSummary[];
  onSave: (value: DesktopSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (value: string) => void;
}) {
  if (category === "models") {
    return <Models providers={providers} onRefresh={onRefresh} onNotice={onNotice} />;
  }
  if (category === "about") {
    return <About />;
  }
  if (category === "diagnostics") {
    return <Diagnostics onNotice={onNotice} />;
  }
  if (["mcp", "skills", "plugins", "memory", "hooks"].includes(category)) {
    return <CapabilityManager category={category as CapabilityCategory} settings={settings} onSave={onSave} onNotice={onNotice} />;
  }

  const general = category === "general";
  return (
    <Section
      title={general ? "通用" : "外观"}
      subtitle={general ? "控制桌面行为、语言与终端。" : "主题与会话密度会立即应用。"}
    >
      {general ? (
        <>
          <SelectRow
            label="界面语言"
            value={settings.language}
            options={[
              ["zh-CN", "简体中文"],
              ["en-US", "English"],
            ]}
            onChange={(language) =>
              onSave({ ...settings, language: language as DesktopSettings["language"] })
            }
          />
          <SelectRow
            label="关闭主窗口"
            value={settings.close_action}
            options={[
              ["tray", "隐藏到系统托盘"],
              ["quit", "退出应用"],
            ]}
            onChange={(close_action) =>
              onSave({ ...settings, close_action: close_action as DesktopSettings["close_action"] })
            }
          />
          <ToggleRow
            label="任务完成提示声音"
            checked={settings.sound_enabled}
            onChange={(sound_enabled) => onSave({ ...settings, sound_enabled })}
          />
          <FieldRow label="首选 Shell" hint="留空时按 PowerShell 7、Windows PowerShell、cmd 自动回退">
            <input
              className="control"
              value={settings.terminal_shell || ""}
              placeholder="自动检测"
              onChange={(e) => onSave({ ...settings, terminal_shell: e.target.value || null })}
            />
          </FieldRow>
        </>
      ) : (
        <>
          <SelectRow
            label="主题"
            value={settings.theme}
            options={[
              ["light", "浅色"],
              ["dark", "深色"],
            ]}
            onChange={(theme) =>
              onSave({ ...settings, theme: theme as DesktopSettings["theme"] })
            }
          />
          <SelectRow
            label="会话密度"
            value={settings.session_display}
            options={[
              ["standard", "标准"],
              ["compact", "紧凑"],
            ]}
            onChange={(session_display) =>
              onSave({
                ...settings,
                session_display: session_display as DesktopSettings["session_display"],
              })
            }
          />
        </>
      )}
    </Section>
  );
}

function Models({
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
    if (!selectedId || !providers.some((provider) => provider.id === selectedId)) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(blankProviderConfig);
      setApiKey("");
      return;
    }
    const current = providers.find((provider) => provider.id === selectedId);
    if (!current) return;
    setDraft(current);
    setApiKey("");
  }, [providers, selectedId]);

  const selected = selectedId ? providers.find((provider) => provider.id === selectedId) ?? null : null;

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
    <Section title="模型与 API" subtitle="支持新增、编辑、测试、置顶和删除。API Key 仅保存在凭据管理器。">
      <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
          <div className="flex items-center justify-between px-1 pb-2">
            <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              供应商列表
            </div>
            <button className="small-btn" onClick={startNew}>
              <Plus size={13} />
              新增
            </button>
          </div>
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {providers.length === 0 ? (
              <div className="text-xs px-2 py-4 text-center" style={{ color: "var(--text-dim)" }}>
                还没有配置供应商
              </div>
            ) : (
              providers.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedId(provider.id)}
                  className="w-full text-left rounded-xl border px-3 py-2 transition-colors hover:bg-surface-2"
                  style={{
                    borderColor: selectedId === provider.id ? "var(--accent-blue)" : "var(--surface-3)",
                    background: selectedId === provider.id ? "var(--surface-2)" : "var(--surface-1)",
                  }}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{provider.name}</span>
                    {provider.is_default && <Star size={12} fill="currentColor" />}
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <div className="truncate">{provider.model}</div>
                    <div className="truncate">{provider.base_url}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-sm font-medium">{selected ? "编辑供应商" : "新增供应商"}</div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {selected ? selected.name : "填写后保存为新的模型提供商"}
              </div>
            </div>
            {selected && (
              <div className="flex items-center gap-2">
                <button
                  className="small-btn"
                  onClick={async () => {
                    try {
                      onNotice(await providerTest(selected.id));
                    } catch (e) {
                      onNotice(String(e));
                    }
                  }}
                >
                  测试
                </button>
                {!selected.is_default && (
                  <button
                    className="small-btn"
                    onClick={async () => {
                      await providerSetDefault(selected.id);
                      await onRefresh();
                    }}
                  >
                    设为默认
                  </button>
                )}
                <button
                  className="icon-btn"
                  title="删除"
                  onClick={async () => {
                    await providerDelete(selected.id);
                    setSelectedId(null);
                    await onRefresh();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              className="control"
              placeholder="显示名称"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              className="control"
              placeholder="模型名"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
            <input
              className="control"
              placeholder="提供商类型，例如 openai-compatible"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            />
            <label className="panel-row">
              <span className="text-sm flex-1">启用</span>
              <Toggle checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
            </label>
            <input
              className="control col-span-2"
              placeholder="https://api.example.com/v1"
              value={draft.base_url}
              onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
            />
            <input
              className="control col-span-2"
              type="password"
              placeholder="API Key（仅写入，不回显）"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              className="primary-btn col-span-2"
              disabled={!draft.name || !draft.model || !draft.base_url}
              onClick={save}
            >
              <Save size={14} />
              {selected ? "保存修改" : "添加提供商"}
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}

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
  const managerRef = useRef<HTMLDivElement | null>(null);

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

  const enabledCount = filtered.filter((item) => effectiveEnabled(settings, item)).length;

  const updateEnabled = async (item: CapabilityItem, nextEnabled: boolean) => {
    await onSave({
      ...settings,
      feature_toggles: {
        ...settings.feature_toggles,
        [item.toggle_key]: nextEnabled,
      },
    });
  };

  const openSource = async (source: CapabilitySource) => {
    if (!source.exists) {
      onNotice("对应目录还不存在");
      return;
    }
    try {
      await openPathInExplorer(source.path);
    } catch (error) {
      onNotice(String(error));
    }
  };

  return (
    <Section title={view?.title || "扩展能力"} subtitle={view?.subtitle || "浏览、启用和管理本地扩展内容。"}>
      <div className="rounded-2xl border p-5" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="p-3 rounded-xl" style={{ background: "var(--surface-2)" }}>
            {categoryIcon(category)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold">{view?.title || "本地管理器"}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {view?.subtitle || "浏览、启用和管理本地扩展内容。"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="small-btn" onClick={() => void load()}>
              <RefreshCw size={13} />
              刷新
            </button>
            <button
              className="primary-btn"
              onClick={() => managerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <Wrench size={14} />
              打开本地管理器
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <StatCard label="来源" value={`${view?.stats.sources ?? 0}`} hint="有效来源" />
          <StatCard label="条目" value={`${view?.stats.items ?? 0}`} hint="本地项目" />
          <StatCard label="启用" value={`${enabledCount}`} hint="当前启用" />
        </div>
      </div>

      <div ref={managerRef} className="mt-5 rounded-2xl border p-5" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[280px]">
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                className="flex-1 bg-transparent border-none outline-none text-[13px]"
                placeholder={view?.search_placeholder || "搜索…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="small-btn" onClick={() => void load()}>
              <RefreshCw size={13} />
              重新扫描
            </button>
            <button
              className="small-btn"
              onClick={async () => {
                const first = view?.sources.find((source) => source.exists);
                if (first) await openSource(first);
              }}
              disabled={!view?.sources.some((source) => source.exists)}
            >
              <FolderOpen size={13} />
              管理
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="py-10 text-sm" style={{ color: "var(--text-muted)" }}>
              正在扫描本地目录…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-sm" style={{ color: "var(--text-muted)" }}>
              没有找到匹配项。
            </div>
          ) : (
            filtered.map((item) => (
              <CapabilityRow
                key={item.id}
                item={item}
                enabled={effectiveEnabled(settings, item)}
                expanded={expandedId === item.id}
                onToggleExpanded={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                onToggleEnabled={(nextEnabled) => void updateEnabled(item, nextEnabled)}
                onOpenPath={async () => {
                  try {
                    await openPathInExplorer(item.path);
                  } catch (error) {
                    onNotice(String(error));
                  }
                }}
              />
            ))
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {view?.sources.map((source) => (
            <button
              key={source.path}
              onClick={() => void openSource(source)}
              className="text-left rounded-xl border p-3 transition-colors hover:bg-surface-2"
              style={{
                borderColor: source.exists ? "var(--surface-3)" : "var(--surface-4)",
                background: "var(--surface-0)",
                opacity: source.exists ? 1 : 0.72,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{source.label}</div>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {source.exists ? `${source.item_count} 项` : "未找到"}
                </span>
              </div>
              <div className="mt-1 text-[11px] truncate" style={{ color: "var(--text-dim)" }}>
                {source.path}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function CapabilityRow({
  item,
  enabled,
  expanded,
  onToggleExpanded,
  onToggleEnabled,
  onOpenPath,
}: {
  item: CapabilityItem;
  enabled: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: (nextEnabled: boolean) => void;
  onOpenPath: () => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)" }}>
          <SlashIcon kind={item.kind} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold truncate">{item.name}</div>
            <Pill>{item.scope}</Pill>
          </div>
          <div className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
            {item.description}
          </div>
          {expanded && (
            <div className="mt-3 space-y-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
              <div className="truncate">路径：{item.path}</div>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <Pill key={tag}>{tag}</Pill>
                ))}
              </div>
            </div>
          )}
          <button className="mt-2 text-[11px]" style={{ color: "var(--accent-blue)" }} onClick={onToggleExpanded}>
            {expanded ? "收起" : "展开"}
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="small-btn" onClick={() => void onOpenPath()}>
            <FolderOpen size={13} />
            打开
          </button>
          <Toggle checked={enabled} onChange={onToggleEnabled} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
        <span>{item.status}</span>
        <button className="text-[11px]" onClick={() => void onOpenPath()}>
          在资源管理器中打开
        </button>
      </div>
    </div>
  );
}

function Diagnostics({ onNotice }: { onNotice: (s: string) => void }) {
  const checks = useMemo(
    () => [
      ["WebView2", "正常"],
      ["Git", "待运行检查"],
      ["Shell", "自动检测"],
      ["Agent 核心", "已链接"],
      ["凭据存储", "Windows Credential Manager"],
    ],
    [],
  );

  return (
    <Section title="诊断" subtitle="检查桌面运行环境并导出脱敏信息。">
      <div className="space-y-2">
        {checks.map(([a, b]) => (
          <div className="panel-row" key={a}>
            <ShieldCheck size={16} />
            <span className="flex-1 text-sm">{a}</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {b}
            </span>
          </div>
        ))}
      </div>
      <button className="primary-btn mt-4" onClick={() => onNotice("诊断检查已刷新")}>
        运行诊断
      </button>
    </Section>
  );
}

function About() {
  return (
    <Section title="关于 WTH" subtitle="Wide Thought Host 桌面代理">
      <div className="rounded-2xl border p-6 space-y-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
        <div className="text-2xl font-bold">
          WTH <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>v0.1.0</span>
        </div>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          基于 Tauri 2、React 和 WTH Agent Core。
        </p>
        <div className="flex gap-2 flex-wrap">
          <a className="small-btn" href="https://github.com" target="_blank" rel="noreferrer">
            <Github size={13} />
            项目主页
          </a>
          <button className="small-btn">
            <Code2 size={13} />
            Apache-2.0
          </button>
          <button className="small-btn">
            <CircleHelp size={13} />
            隐私说明
          </button>
        </div>
      </div>
    </Section>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm mt-1 mb-6" style={{ color: "var(--text-muted)" }}>
        {subtitle}
      </p>
      {children}
    </>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="panel-row mb-2">
      <div className="flex-1">
        <div className="text-sm">{label}</div>
        {hint && (
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {hint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <FieldRow label={label}>
      <select className="control w-52" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return <FieldRow label={label}><Toggle checked={checked} onChange={onChange} /></FieldRow>;
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-10 h-5 rounded-full p-0.5"
      style={{ background: checked ? "var(--accent-blue)" : "var(--surface-4)" }}
    >
      <span
        className="block w-4 h-4 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(20px)" : "none" }}
      />
    </button>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-0)" }}>
      <div className="text-[11px]" style={{ color: "var(--text-dim)" }}>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {hint}
      </div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
      style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
    >
      {children}
    </span>
  );
}

function effectiveEnabled(settings: DesktopSettings, item: CapabilityItem) {
  return settings.feature_toggles[item.toggle_key] ?? item.enabled;
}

function categoryIcon(category: string) {
  switch (category) {
    case "mcp":
      return <Plug size={18} />;
    case "skills":
      return <Sparkles size={18} />;
    case "plugins":
      return <Puzzle size={18} />;
    case "memory":
      return <Brain size={18} />;
    case "hooks":
      return <Webhook size={18} />;
    default:
      return <Wrench size={18} />;
  }
}

function SlashIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "mcp":
      return <Plug size={14} />;
    case "skills":
      return <Sparkles size={14} />;
    case "plugins":
      return <Puzzle size={14} />;
    case "memory":
      return <Database size={14} />;
    case "hooks":
      return <Webhook size={14} />;
    default:
      return <Wrench size={14} />;
  }
}
