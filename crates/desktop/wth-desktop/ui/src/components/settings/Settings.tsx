// Settings — 参照 WorkBuddy 布局：左侧分类列表 + 右侧设置详情。
//
// 每个设置项为一行：标题 + 描述 + 右侧选项按钮组。
// 主题色跟随当前主题（深色蓝 / 浅色紫）。

import { useState, useCallback } from "react";
import {
  Globe, Palette, Bot, Wrench,
  Puzzle, Brain, HardDrive, Keyboard,
  Shield, Wifi, Sparkles,
} from "lucide-react";

// ─── 分类定义 ─────────────────────────────────────────────

interface Category {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const CATEGORIES: Category[] = [
  { id: "general", label: "通用", icon: <Globe size={15} /> },
  { id: "models", label: "模型", icon: <Brain size={15} /> },
  { id: "appearance", label: "外观", icon: <Palette size={15} /> },
  { id: "agent", label: "机器人", icon: <Bot size={15} /> },
  { id: "tools", label: "MCP 与工具", icon: <Wrench size={15} /> },
  { id: "skills", label: "技能", icon: <Sparkles size={15} /> },
  { id: "plugins", label: "插件", icon: <Puzzle size={15} /> },
  { id: "memory", label: "记忆", icon: <HardDrive size={15} /> },
  { id: "shortcuts", label: "快捷键", icon: <Keyboard size={15} /> },
  { id: "permissions", label: "权限", icon: <Shield size={15} /> },
  { id: "network", label: "网络", icon: <Wifi size={15} /> },
];

// ─── 设置项类型 ───────────────────────────────────────────

interface SettingRow {
  key: string;
  title: string;
  desc?: string;
  options: { value: string; label: string }[];
  storageKey: string;
}

// ─── 各分类设置项 ─────────────────────────────────────────

const SETTINGS: Record<string, SettingRow[]> = {
  general: [
    {
      key: "language", title: "语言", desc: "界面显示语言",
      options: [{ value: "auto", label: "自动(跟随系统)" }, { value: "zh", label: "中文" }, { value: "en", label: "English" }],
      storageKey: "wth-lang",
    },
    {
      key: "closeAction", title: "关闭窗口时", desc: "点击关闭按钮的行为",
      options: [{ value: "tray", label: "保持后台运行" }, { value: "quit", label: "退出应用" }],
      storageKey: "wth-close-action",
    },
    {
      key: "sound", title: "声音",
      options: [{ value: "off", label: "全部关闭" }, { value: "notification", label: "仅通知" }, { value: "on", label: "开启" }],
      storageKey: "wth-sound",
    },
  ],
  models: [
    {
      key: "defaultModel", title: "默认模型", desc: "新建会话时使用的 AI 模型",
      options: [
        { value: "gpt-4.1", label: "GPT-4.1" },
        { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
        { value: "deepseek-chat", label: "DeepSeek V3" },
      ],
      storageKey: "wth-default-model",
    },
  ],
  appearance: [
    {
      key: "theme", title: "主题", desc: "深色或浅色外观",
      options: [{ value: "dark", label: "深色" }, { value: "light", label: "浅色" }],
      storageKey: "wth-theme",
    },
    {
      key: "sessionDisplay", title: "会话展示模式",
      options: [{ value: "standard", label: "标准" }, { value: "compact", label: "紧凑" }],
      storageKey: "wth-session-display",
    },
    {
      key: "bottomBarStyle", title: "底部信息栏样式",
      options: [{ value: "icons", label: "图标版" }, { value: "text", label: "文字版" }],
      storageKey: "wth-bottombar-style",
    },
    {
      key: "bottomBarItems", title: "信息栏显示项", desc: "已显示 3/3 项",
      options: [],
      storageKey: "wth-bottombar-items",
    },
  ],
  agent: [
    {
      key: "autoApprove", title: "新会话默认审批", desc: "执行工具调用前是否询问",
      options: [{ value: "ask", label: "询问" }, { value: "auto", label: "自动" }, { value: "yolo", label: "Yolo" }],
      storageKey: "wth-auto-approve",
    },
    {
      key: "autoCollapse", title: "工作过程折叠",
      options: [{ value: "auto", label: "自动收起" }, { value: "expand", label: "保持展开" }],
      storageKey: "wth-auto-collapse",
    },
    {
      key: "autoCompact", title: "自动计划模式",
      options: [{ value: "off", label: "关闭" }, { value: "on", label: "开启" }],
      storageKey: "wth-auto-compact",
    },
  ],
  tools: [
    { key: "mcp", title: "MCP 接入", desc: "配置外部 MCP 服务器",
      options: [{ value: "config", label: "配置" }], storageKey: "" },
  ],
  skills: [
    { key: "skills", title: "技能管理", desc: "安装和管理技能包",
      options: [{ value: "manage", label: "管理" }], storageKey: "" },
  ],
  plugins: [
    { key: "plugins", title: "插件市场", desc: "浏览和安装插件",
      options: [{ value: "market", label: "浏览" }], storageKey: "" },
  ],
  memory: [
    { key: "memory", title: "记忆设置", desc: "AI 记忆和上下文管理",
      options: [{ value: "config", label: "配置" }], storageKey: "" },
  ],
  shortcuts: [
    { key: "shortcuts", title: "快捷键", desc: "查看和自定义快捷键",
      options: [{ value: "view", label: "查看" }], storageKey: "" },
  ],
  permissions: [
    { key: "permissions", title: "权限管理", desc: "文件和网络权限设置",
      options: [{ value: "config", label: "配置" }], storageKey: "" },
  ],
  network: [
    { key: "proxy", title: "代理设置", desc: "HTTP/HTTPS 代理配置",
      options: [{ value: "config", label: "配置" }], storageKey: "" },
  ],
};

// ─── 读/写设置 ────────────────────────────────────────────

function getSetting(key: string, fallback: string): string {
  return localStorage.getItem(key) || fallback;
}
function setSetting(key: string, value: string) {
  localStorage.setItem(key, value);
  // 特殊处理主题和模型切换的副作用
  if (key === "wth-theme") {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(value);
  }
}

// ─── 组件 ─────────────────────────────────────────────────

export function SettingsPanel() {
  const [activeCat, setActiveCat] = useState("general");
  const [refreshKey, setRefreshKey] = useState(0);

  const forceRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const rows = SETTINGS[activeCat] || [];

  return (
    <div
      className="h-full w-full flex min-h-0"
      style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}
    >
      {/* 左侧分类列表 */}
      <div
        className="w-44 flex-shrink-0 flex flex-col border-r min-h-0 overflow-y-auto"
        style={{ background: "var(--surface-1)", borderColor: "var(--surface-4)" }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--surface-4)" }}>
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
                  transition-all duration-150 ease-out
                  ${active ? "bg-accent-primary/10 text-accent-primary font-medium" : "hover:bg-surface-2"}
                `}
                style={!active ? { color: "var(--text-muted)" } : undefined}
              >
                {cat.icon}
                <span className="truncate">{cat.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 右侧设置详情 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" key={refreshKey}>
        <div
          className="px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--surface-4)" }}
        >
          <h3 className="text-base font-semibold leading-tight">
            {CATEGORIES.find((c) => c.id === activeCat)?.label || "设置"}
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
            共 {rows.length} 项设置
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows.map((row) => (
            <SettingRowItem key={row.key} row={row} onChange={forceRefresh} />
          ))}
          {rows.length === 0 && (
            <div className="p-8 text-center" style={{ color: "var(--text-muted)" }}>
              <p className="text-sm">此分类暂无设置项</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 单个设置行 ───────────────────────────────────────────

function SettingRowItem({ row, onChange }: { row: SettingRow; onChange: () => void }) {
  const current = row.storageKey ? getSetting(row.storageKey, row.options[0]?.value || "") : "";

  const handleSelect = (value: string) => {
    if (!row.storageKey) return;
    setSetting(row.storageKey, value);
    onChange();
  };

  return (
    <div
      className="flex items-center justify-between gap-4 px-6 py-4 border-b
        transition-colors duration-150 hover:bg-surface-1"
      style={{ borderColor: "var(--surface-4)" }}
    >
      {/* 标题和描述 */}
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

      {/* 选项按钮组 */}
      {row.options.length > 0 && (
        <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
          {row.options.map((opt) => {
            const selected = current === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap
                  transition-all duration-150 ease-out
                  ${selected ? "border" : "border"}
                `}
                style={
                  selected
                    ? {
                        background: "var(--accent-primary)",
                        borderColor: "var(--accent-primary)",
                        color: "#ffffff",
                      }
                    : {
                        background: "transparent",
                        borderColor: "var(--surface-4)",
                        color: "var(--text-muted)",
                      }
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 占位操作项 */}
      {row.options.length === 0 && (
        <button
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border
            transition-colors duration-150 hover:bg-surface-2 flex-shrink-0"
          style={{ borderColor: "var(--surface-4)", color: "var(--text-muted)" }}
        >
          管理
        </button>
      )}
    </div>
  );
}
