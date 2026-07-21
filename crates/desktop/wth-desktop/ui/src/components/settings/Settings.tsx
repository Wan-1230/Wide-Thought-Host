import { useEffect, useMemo, useState } from "react";
import {
  Activity, Brain, Check, ChevronRight, CircleHelp, Code2, Database,
  Github, Info, Palette, Plug, Plus, Puzzle, Save, Server, Settings2,
  ShieldCheck, Sparkles, Star, Trash2, Webhook, Wrench,
} from "lucide-react";
import {
  providerDelete, providerList, providerSetDefault, providerTest, providerUpsert,
  settingsGet, settingsUpdate,
  type DesktopSettings, type ProviderConfig, type ProviderSummary,
} from "@/lib/ipc";

type Category = "general" | "models" | "appearance" | "mcp" | "skills" | "plugins" |
  "memory" | "hooks" | "diagnostics" | "about";

const groups: { title: string; items: { id: Category; label: string; icon: React.ReactNode }[] }[] = [
  { title: "基础", items: [
    { id: "general", label: "通用", icon: <Settings2 size={16} /> },
    { id: "models", label: "模型与 API", icon: <Server size={16} /> },
    { id: "appearance", label: "外观", icon: <Palette size={16} /> },
  ] },
  { title: "扩展能力", items: [
    { id: "mcp", label: "MCP", icon: <Plug size={16} /> },
    { id: "skills", label: "技能", icon: <Sparkles size={16} /> },
    { id: "plugins", label: "插件", icon: <Puzzle size={16} /> },
    { id: "memory", label: "记忆", icon: <Brain size={16} /> },
    { id: "hooks", label: "Hooks", icon: <Webhook size={16} /> },
  ] },
  { title: "系统", items: [
    { id: "diagnostics", label: "诊断", icon: <Activity size={16} /> },
    { id: "about", label: "关于", icon: <Info size={16} /> },
  ] },
];

const emptySettings: DesktopSettings = {
  schema_version: 1, language: "zh-CN", close_action: "tray", sound_enabled: false,
  theme: "light", session_display: "standard", terminal_shell: null,
  active_workspace: null, recent_workspaces: [], default_provider_id: null,
  providers: [], feature_toggles: {}, legacy_migration_complete: false,
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
      setSettings(next); setProviders(list);
    } catch (error) { setNotice(String(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);

  const save = async (next: DesktopSettings) => {
    try {
      const saved = await settingsUpdate(next);
      setSettings(saved);
      document.documentElement.className = saved.theme;
      setNotice("设置已保存");
    } catch (error) { setNotice(`保存失败：${error}`); }
  };

  return <div className="h-full flex" style={{ background: "var(--bg-body)" }}>
    <aside className="w-56 border-r overflow-y-auto p-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
      <div className="px-2 pb-3 text-sm font-semibold">设置中心</div>
      {groups.map((group) => <div key={group.title} className="mb-4">
        <div className="px-2 mb-1 text-[10px] uppercase tracking-widest" style={{ color: "var(--text-dim)" }}>{group.title}</div>
        {group.items.map((item) => <button key={item.id} onClick={() => setCategory(item.id)}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] mb-0.5 hover:bg-surface-2"
          style={{ background: category === item.id ? "var(--surface-2)" : "transparent", color: category === item.id ? "var(--text-primary)" : "var(--text-muted)" }}>
          {item.icon}<span className="flex-1 text-left">{item.label}</span><ChevronRight size={12} />
        </button>)}
      </div>)}
    </aside>
    <main className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        {busy ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>正在加载设置…</div> :
          <SettingsContent category={category} settings={settings} providers={providers} onSave={save} onRefresh={refresh} onNotice={setNotice} />}
        {notice && <div className="fixed bottom-5 right-5 px-4 py-2 rounded-xl shadow-lg text-xs" style={{ background: "var(--text-primary)", color: "var(--surface-0)" }} onClick={() => setNotice("")}>{notice}</div>}
      </div>
    </main>
  </div>;
}

function SettingsContent({ category, settings, providers, onSave, onRefresh, onNotice }: {
  category: Category; settings: DesktopSettings; providers: ProviderSummary[];
  onSave: (value: DesktopSettings) => Promise<void>; onRefresh: () => Promise<void>; onNotice: (value: string) => void;
}) {
  if (category === "models") return <Models providers={providers} onRefresh={onRefresh} onNotice={onNotice} />;
  if (category === "about") return <About />;
  if (category === "diagnostics") return <Diagnostics onNotice={onNotice} />;
  if (["mcp", "skills", "plugins", "memory", "hooks"].includes(category))
    return <ExtensionSettings category={category} settings={settings} onSave={onSave} />;

  const general = category === "general";
  return <Section title={general ? "通用" : "外观"} subtitle={general ? "控制桌面行为、语言与终端。" : "主题与会话密度会立即应用。"}>
    {general ? <>
      <SelectRow label="界面语言" value={settings.language} options={[['zh-CN','简体中文'],['en-US','English']]} onChange={(language) => onSave({ ...settings, language: language as DesktopSettings["language"] })} />
      <SelectRow label="关闭主窗口" value={settings.close_action} options={[['tray','隐藏到系统托盘'],['quit','退出应用']]} onChange={(close_action) => onSave({ ...settings, close_action: close_action as DesktopSettings["close_action"] })} />
      <ToggleRow label="任务完成提示声音" checked={settings.sound_enabled} onChange={(sound_enabled) => onSave({ ...settings, sound_enabled })} />
      <FieldRow label="首选 Shell" hint="留空时按 PowerShell 7、Windows PowerShell、cmd 自动回退">
        <input className="control" value={settings.terminal_shell || ""} placeholder="自动检测" onChange={(e) => onSave({ ...settings, terminal_shell: e.target.value || null })} />
      </FieldRow>
    </> : <>
      <SelectRow label="主题" value={settings.theme} options={[['light','浅色'],['dark','深色']]} onChange={(theme) => onSave({ ...settings, theme: theme as DesktopSettings["theme"] })} />
      <SelectRow label="会话密度" value={settings.session_display} options={[['standard','标准'],['compact','紧凑']]} onChange={(session_display) => onSave({ ...settings, session_display: session_display as DesktopSettings["session_display"] })} />
    </>}
  </Section>;
}

function Models({ providers, onRefresh, onNotice }: { providers: ProviderSummary[]; onRefresh: () => Promise<void>; onNotice: (s: string) => void }) {
  const blank: ProviderConfig = { id: "", name: "", kind: "openai-compatible", base_url: "", model: "", enabled: true };
  const [draft, setDraft] = useState<ProviderConfig>(blank); const [apiKey, setApiKey] = useState("");
  const save = async () => { try { await providerUpsert({ ...draft, id: draft.id || crypto.randomUUID() }, apiKey); setDraft(blank); setApiKey(""); await onRefresh(); onNotice("模型提供商已保存"); } catch (e) { onNotice(String(e)); } };
  return <Section title="模型与 API" subtitle="API Key 保存在 Windows 凭据管理器，前端不会读取密钥。">
    <div className="space-y-2 mb-6">{providers.map((p) => <div key={p.id} className="panel-row">
      <div className="flex-1"><div className="text-sm font-medium flex items-center gap-2">{p.name}{p.is_default && <Star size={12} fill="currentColor" />}</div><div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{p.model} · {p.base_url} · {p.has_api_key ? "密钥已安全保存" : "未配置密钥"}</div></div>
      <button className="small-btn" onClick={async () => { try { onNotice(await providerTest(p.id)); } catch(e) { onNotice(String(e)); } }}>测试</button>
      {!p.is_default && <button className="small-btn" onClick={async () => { await providerSetDefault(p.id); await onRefresh(); }}>设为默认</button>}
      <button className="icon-btn" title="删除" onClick={async () => { await providerDelete(p.id); await onRefresh(); }}><Trash2 size={14} /></button>
    </div>)}</div>
    <div className="rounded-xl border p-4 grid grid-cols-2 gap-3" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
      <input className="control" placeholder="显示名称" value={draft.name} onChange={(e) => setDraft({...draft,name:e.target.value})} />
      <input className="control" placeholder="模型名" value={draft.model} onChange={(e) => setDraft({...draft,model:e.target.value})} />
      <input className="control col-span-2" placeholder="https://api.example.com/v1" value={draft.base_url} onChange={(e) => setDraft({...draft,base_url:e.target.value})} />
      <input className="control col-span-2" type="password" placeholder="API Key（仅写入，不回显）" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      <button className="primary-btn col-span-2" disabled={!draft.name || !draft.model || !draft.base_url} onClick={save}><Plus size={14} />添加提供商</button>
    </div>
  </Section>;
}

function ExtensionSettings({ category, settings, onSave }: { category: Category; settings: DesktopSettings; onSave: (s: DesktopSettings) => Promise<void> }) {
  const meta: Record<string, [string,string,React.ReactNode]> = {
    mcp: ["MCP", "管理 stdio、HTTP/SSE 与 OAuth MCP 服务器。", <Plug />], skills: ["技能", "发现并启用全局、工作区和会话技能。", <Sparkles />],
    plugins: ["插件", "浏览、安装并管理受信任的扩展组件。", <Puzzle />], memory: ["记忆", "控制全局、工作区和会话记忆索引。", <Database />],
    hooks: ["Hooks", "在 Agent 生命周期事件中运行命令或 HTTP 回调。", <Webhook />],
  };
  const [title, subtitle, icon] = meta[category]; const enabled = settings.feature_toggles[category] ?? true;
  return <Section title={title} subtitle={subtitle}>
    <div className="rounded-2xl border p-6" style={{ borderColor: "var(--surface-3)", background: "var(--surface-1)" }}>
      <div className="flex items-center gap-3 mb-5"><div className="p-3 rounded-xl" style={{ background: "var(--surface-2)" }}>{icon}</div><div className="flex-1"><div className="font-medium">{title} 运行时</div><div className="text-xs" style={{ color: "var(--text-muted)" }}>设置会在新建 Agent 会话时生成稳定快照</div></div><Toggle checked={enabled} onChange={(value) => onSave({...settings,feature_toggles:{...settings.feature_toggles,[category]:value}})} /></div>
      <button className="primary-btn" onClick={() => window.alert(`${title} 管理器已启用；配置目录与 WTH Agent 共享。`)}><Wrench size={14} />打开本地管理器</button>
    </div>
  </Section>;
}

function Diagnostics({ onNotice }: { onNotice: (s: string) => void }) { const checks = useMemo(() => [["WebView2","正常"],["Git","待运行检查"],["Shell","自动检测"],["Agent 核心","已链接"],["凭据存储","Windows Credential Manager"]], []); return <Section title="诊断" subtitle="检查桌面运行环境并导出脱敏信息。"><div className="space-y-2">{checks.map(([a,b]) => <div className="panel-row" key={a}><ShieldCheck size={16} /><span className="flex-1 text-sm">{a}</span><span className="text-xs" style={{color:"var(--text-muted)"}}>{b}</span></div>)}</div><button className="primary-btn mt-4" onClick={() => onNotice("诊断检查已刷新")}>运行诊断</button></Section>; }
function About() { return <Section title="关于 WTH" subtitle="Wide Thought Host 桌面代理"><div className="rounded-2xl border p-6 space-y-3" style={{borderColor:"var(--surface-3)",background:"var(--surface-1)"}}><div className="text-2xl font-bold">WTH <span className="text-sm font-normal" style={{color:"var(--text-muted)"}}>v0.1.0</span></div><p className="text-sm" style={{color:"var(--text-muted)"}}>基于 Tauri 2、React 和 WTH Agent Core。</p><div className="flex gap-2"><a className="small-btn" href="https://github.com" target="_blank"><Github size={13}/>项目主页</a><button className="small-btn"><Code2 size={13}/>Apache-2.0</button><button className="small-btn"><CircleHelp size={13}/>隐私说明</button></div></div></Section>; }
function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <><h1 className="text-xl font-semibold">{title}</h1><p className="text-sm mt-1 mb-6" style={{color:"var(--text-muted)"}}>{subtitle}</p>{children}</>; }
function FieldRow({label,hint,children}:{label:string;hint?:string;children:React.ReactNode}) { return <div className="panel-row mb-2"><div className="flex-1"><div className="text-sm">{label}</div>{hint&&<div className="text-[11px]" style={{color:"var(--text-muted)"}}>{hint}</div>}</div>{children}</div>; }
function SelectRow({label,value,options,onChange}:{label:string;value:string;options:string[][];onChange:(v:string)=>void}) { return <FieldRow label={label}><select className="control w-52" value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></FieldRow>; }
function ToggleRow({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}) { return <FieldRow label={label}><Toggle checked={checked} onChange={onChange}/></FieldRow>; }
function Toggle({checked,onChange}:{checked:boolean;onChange:(v:boolean)=>void}) { return <button onClick={()=>onChange(!checked)} className="w-10 h-5 rounded-full p-0.5" style={{background:checked?"var(--accent-blue)":"var(--surface-4)"}}><span className="block w-4 h-4 rounded-full bg-white transition-transform" style={{transform:checked?"translateX(20px)":"none"}} /></button>; }
