// Settings — 统一的 API 和模型配置。
//
// 设计：
// - 通用：语言、关闭行为、声音
// - API：自定义 LLM 提供商列表（名称、URL、API Key、模型名）+ 默认模型
// - 外观：主题、会话展示、底部栏
//
// 数据存储：localStorage
//   - wth-llm-providers: JSON 数组，每个元素是 { id, name, baseUrl, apiKey, model }
//   - wth-default-model: 默认模型 id（提供商 id 或内置 id）

import { useState, useEffect, useCallback } from "react";
import {
  Globe, Palette, Server, Plus, Trash2, Star, Check, Wifi,
} from "lucide-react";

// ─── 分类定义 ─────────────────────────────────────────────

const CATEGORIES = [
  { id: "general", label: "通用", icon: <Globe size={15} /> },
  { id: "api", label: "API 与模型", icon: <Server size={15} /> },
  { id: "appearance", label: "外观", icon: <Palette size={15} /> },
];

// ─── LLM 提供商数据 ───────────────────────────────────────

interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULT_PROVIDERS: LlmProvider[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash（推荐）",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-V4-flash",
  },
  {
    id: "openai-gpt-4.1",
    name: "OpenAI GPT-4.1",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4.1",
  },
  {
    id: "anthropic-claude",
    name: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    model: "claude-sonnet-4-20250514",
  },
];

function loadProviders(): LlmProvider[] {
  try {
    const raw = localStorage.getItem("wth-llm-providers");
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_PROVIDERS;
}

function saveProviders(providers: LlmProvider[]) {
  localStorage.setItem("wth-llm-providers", JSON.stringify(providers));
}

function loadDefaultProviderId(): string {
  return localStorage.getItem("wth-default-provider") || "deepseek-v4-flash";
}

function saveDefaultProviderId(id: string) {
  localStorage.setItem("wth-default-provider", id);
}

// ─── 通用设置项类型 ──────────────────────────────────────

interface SettingRow {
  key: string;
  title: string;
  desc?: string;
  options: { value: string; label: string }[];
  storageKey: string;
  defaultValue: string;
}

const GENERAL_SETTINGS: SettingRow[] = [
  {
    key: "language", title: "语言", desc: "界面显示语言",
    options: [{ value: "zh", label: "中文" }, { value: "en", label: "English" }],
    storageKey: "wth-lang",
    defaultValue: "zh",
  },
  {
    key: "closeAction", title: "关闭窗口时", desc: "点击关闭按钮的行为",
    options: [{ value: "tray", label: "保持后台运行" }, { value: "quit", label: "退出应用" }],
    storageKey: "wth-close-action",
    defaultValue: "tray",
  },
  {
    key: "sound", title: "声音",
    options: [{ value: "off", label: "全部关闭" }, { value: "on", label: "开启" }],
    storageKey: "wth-sound",
    defaultValue: "off",
  },
];

const APPEARANCE_SETTINGS: SettingRow[] = [
  {
    key: "theme", title: "主题", desc: "深色或浅色外观",
    options: [{ value: "dark", label: "深色" }, { value: "light", label: "浅色" }],
    storageKey: "wth-theme",
    defaultValue: "light",
  },
  {
    key: "sessionDisplay", title: "会话展示模式",
    options: [{ value: "standard", label: "标准" }, { value: "compact", label: "紧凑" }],
    storageKey: "wth-session-display",
    defaultValue: "standard",
  },
];

// ─── 工具函数 ────────────────────────────────────────────

function getSetting(storageKey: string, defaultValue: string): string {
  return localStorage.getItem(storageKey) || defaultValue;
}
function setSetting(storageKey: string, value: string) {
  localStorage.setItem(storageKey, value);
  if (storageKey === "wth-theme") {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(value);
  }
}

// ─── 主组件 ──────────────────────────────────────────────

export function SettingsPanel() {
  const [activeCat, setActiveCat] = useState("api");
  const [refreshKey, setRefreshKey] = useState(0);
  const forceRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div
      className="h-full w-full flex min-h-0"
      style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}
      key={refreshKey}
    >
      {/* 左侧分类列表 */}
      <div
        className="w-44 flex-shrink-0 flex flex-col border-r min-h-0"
        style={{ background: "var(--surface-1)", borderColor: "var(--surface-3)" }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--surface-3)" }}>
          <h3 className="text-sm font-semibold">设置</h3>
        </div>
        <nav className="flex-1 p-1.5 space-y-0.5">
          {CATEGORIES.map((cat) => {
            const active = activeCat === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCat(cat.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px]
                  transition-colors duration-150
                  ${active ? "bg-accent-primary/10" : "hover:bg-surface-2"}
                `}
                style={{
                  background: active ? "var(--surface-2)" : "transparent",
                  color: "var(--text-primary)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {cat.icon}
                <span className="truncate">{cat.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div
          className="px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--surface-3)" }}
        >
          <h3 className="text-base font-semibold leading-tight">
            {CATEGORIES.find((c) => c.id === activeCat)?.label || "设置"}
          </h3>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {activeCat === "general" && <GeneralSettings />}
          {activeCat === "api" && <ApiSettings onChange={forceRefresh} />}
          {activeCat === "appearance" && <AppearanceSettings onChange={forceRefresh} />}
        </div>
      </div>
    </div>
  );
}

// ─── 通用设置 ────────────────────────────────────────────

function GeneralSettings() {
  return (
    <div>
      {GENERAL_SETTINGS.map((row) => (
        <SimpleSettingRow key={row.key} row={row} />
      ))}
    </div>
  );
}

// ─── 外观设置 ────────────────────────────────────────────

function AppearanceSettings({ onChange }: { onChange: () => void }) {
  return (
    <div>
      {APPEARANCE_SETTINGS.map((row) => (
        <SimpleSettingRow key={row.key} row={row} onChange={onChange} />
      ))}
    </div>
  );
}

// ─── 简单设置行（按钮组） ────────────────────────────────

function SimpleSettingRow({ row, onChange }: { row: SettingRow; onChange?: () => void }) {
  const current = getSetting(row.storageKey, row.defaultValue);

  const handleSelect = (value: string) => {
    setSetting(row.storageKey, value);
    onChange?.();
  };

  return (
    <div
      className="flex items-center justify-between gap-4 px-6 py-4 border-b
        transition-colors duration-150 hover:bg-surface-1"
      style={{ borderColor: "var(--surface-3)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
          {row.title}
        </div>
        {row.desc && (
          <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--text-dim)" }}>
            {row.desc}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
        {row.options.map((opt) => {
          const selected = current === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap
                transition-all duration-150 ease-out border"
              style={
                selected
                  ? { background: "var(--accent-primary)", borderColor: "var(--accent-primary)", color: "var(--surface-0)" }
                  : { background: "transparent", borderColor: "var(--surface-4)", color: "var(--text-muted)" }
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── API 设置（提供商管理） ───────────────────────────────

function ApiSettings({ onChange }: { onChange: () => void }) {
  const [providers, setProviders] = useState<LlmProvider[]>(loadProviders);
  const [defaultId, setDefaultId] = useState(loadDefaultProviderId);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // 持久化
  useEffect(() => {
    saveProviders(providers);
    onChange();
  }, [providers, onChange]);

  useEffect(() => {
    saveDefaultProviderId(defaultId);
  }, [defaultId]);

  const handleSetDefault = (id: string) => {
    setDefaultId(id);
  };

  const handleDelete = (id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id));
    if (defaultId === id && providers.length > 1) {
      setDefaultId(providers.filter((p) => p.id !== id)[0].id);
    }
  };

  const handleAdd = () => {
    setAdding(true);
    setEditing(null);
  };

  const handleEdit = (id: string) => {
    setEditing(id);
    setAdding(false);
  };

  const handleSave = (provider: LlmProvider) => {
    if (adding) {
      setProviders((prev) => [...prev, provider]);
      setAdding(false);
    } else {
      setProviders((prev) => prev.map((p) => (p.id === provider.id ? provider : p)));
      setEditing(null);
    }
  };

  const handleCancel = () => {
    setAdding(false);
    setEditing(null);
  };

  return (
    <div>
      {/* 默认模型提示 */}
      <div
        className="mx-6 mt-4 mb-3 px-4 py-3 rounded-lg flex items-start gap-3"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}
      >
        <Star size={14} className="mt-0.5 flex-shrink-0" style={{ color: "var(--accent-primary)" }} />
        <div className="flex-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
          点击提供商右侧的 <strong style={{ color: "var(--text-primary)" }}>设为默认</strong> 即可在所有新会话中使用。系统会优先使用该提供商的 API Key 和模型。
        </div>
      </div>

      {/* 提供商列表 */}
      {providers.map((p) => {
        if (editing === p.id) {
          return <ProviderEditForm key={p.id} initial={p} onSave={handleSave} onCancel={handleCancel} />;
        }
        const isDefault = p.id === defaultId;
        return (
          <ProviderCard
            key={p.id}
            provider={p}
            isDefault={isDefault}
            onSetDefault={() => handleSetDefault(p.id)}
            onEdit={() => handleEdit(p.id)}
            onDelete={() => handleDelete(p.id)}
          />
        );
      })}

      {/* 新增表单 */}
      {adding && (
        <ProviderEditForm
          initial={{
            id: `custom-${Date.now()}`,
            name: "",
            baseUrl: "",
            apiKey: "",
            model: "",
          }}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}

      {/* 添加按钮 */}
      {!adding && !editing && (
        <div className="px-6 py-4">
          <button
            onClick={handleAdd}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg
              text-[13px] font-medium transition-all duration-150
              hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: "var(--surface-1)",
              border: "1px dashed var(--surface-4)",
              color: "var(--accent-primary)",
            }}
          >
            <Plus size={14} />
            添加自定义模型
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 单个提供商卡片 ──────────────────────────────────────

function ProviderCard({
  provider,
  isDefault,
  onSetDefault,
  onEdit,
  onDelete,
}: {
  provider: LlmProvider;
  isDefault: boolean;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="mx-6 mb-3 rounded-xl p-4 transition-colors duration-150"
      style={{
        background: "var(--surface-1)",
        border: isDefault ? "1px solid var(--accent-primary)" : "1px solid var(--surface-3)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {provider.name}
            </span>
            {isDefault && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-1"
                style={{ background: "var(--accent-primary)", color: "var(--surface-0)" }}
              >
                <Check size={9} /> 默认
              </span>
            )}
          </div>
          <div className="text-[11px] mt-1.5 space-y-0.5" style={{ color: "var(--text-dim)" }}>
            <div className="flex items-center gap-1.5">
              <Wifi size={10} className="flex-shrink-0" />
              <span className="truncate">{provider.baseUrl || "(未配置)"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono">模型：</span>
              <span className="truncate font-mono">{provider.model || "(未设置)"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono">Key：</span>
              <span className="font-mono">
                {provider.apiKey ? "•".repeat(Math.min(provider.apiKey.length, 12)) + provider.apiKey.slice(-4) : "(未设置)"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          {!isDefault && (
            <button
              onClick={onSetDefault}
              className="px-2.5 py-1 rounded text-[11px] font-medium border
                transition-colors duration-150 hover:bg-surface-2"
              style={{ borderColor: "var(--surface-4)", color: "var(--accent-primary)" }}
            >
              设为默认
            </button>
          )}
          <button
            onClick={onEdit}
            className="px-2.5 py-1 rounded text-[11px] font-medium border
              transition-colors duration-150 hover:bg-surface-2"
            style={{ borderColor: "var(--surface-4)", color: "var(--text-muted)" }}
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className="px-2.5 py-1 rounded text-[11px] font-medium border
              transition-colors duration-150 hover:bg-accent-red/10"
            style={{ borderColor: "var(--surface-4)", color: "var(--text-muted)" }}
            title="删除"
          >
            <Trash2 size={11} className="inline mr-1" />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 编辑/新增表单 ───────────────────────────────────────

function ProviderEditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: LlmProvider;
  onSave: (p: LlmProvider) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<LlmProvider>(initial);

  const isNew = !initial.name && !initial.baseUrl;
  const canSave = form.name.trim() && form.baseUrl.trim() && form.model.trim();

  return (
    <div
      className="mx-6 mb-3 rounded-xl p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--accent-primary)" }}
    >
      <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
        {isNew ? "添加自定义模型" : "编辑模型"}
      </div>
      <div className="space-y-2.5">
        <Field
          label="名称"
          placeholder="例如：我的 GPT-4"
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
        />
        <Field
          label="API 地址"
          placeholder="https://api.openai.com/v1"
          value={form.baseUrl}
          onChange={(v) => setForm({ ...form, baseUrl: v })}
        />
        <Field
          label="API Key"
          placeholder="sk-..."
          type="password"
          value={form.apiKey}
          onChange={(v) => setForm({ ...form, apiKey: v })}
        />
        <Field
          label="模型名"
          placeholder="例如：gpt-4.1, deepseek-V4-flash"
          value={form.model}
          onChange={(v) => setForm({ ...form, model: v })}
          mono
        />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border
            transition-colors duration-150 hover:bg-surface-2"
          style={{ borderColor: "var(--surface-4)", color: "var(--text-muted)" }}
        >
          取消
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!canSave}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium
            transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--accent-primary)", color: "var(--surface-0)" }}
        >
          {isNew ? "添加" : "保存"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  mono = false,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label
        className="block text-[11px] font-medium mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-1.5 text-[13px] rounded-lg border outline-none
          transition-colors duration-150 ${mono ? "font-mono" : ""}`}
        style={{
          background: "var(--surface-0)",
          borderColor: "var(--surface-4)",
          color: "var(--text-primary)",
        }}
      />
    </div>
  );
}
