import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Brain,
  Check,
  ChevronRight,
  FolderOpen,
  Loader2,
  Plus,
  Rocket,
  Server,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  localProvidersDetect,
  type ProviderSummary,
  providerList,
  providerSetDefault,
  providerTest,
  providerUpsert,
  workspaceSelect,
} from "@/lib/ipc";

interface Props {
  onClose: () => void;
  onDone: () => void;
  onOpenSettings: () => void;
  onExampleQuestion: (question: string) => void;
}

type Step = 1 | 2 | 3;

interface LocalEndpointView {
  kind: string;
  base_url: string;
  models: string[];
}

/** G5: 首次启动引导 — 工作区 → Provider 向导 → 首次提问。 */
export function OnboardingModal({ onClose, onDone, onOpenSettings, onExampleQuestion }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Provider 向导状态
  const [showAdd, setShowAdd] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [localEndpoints, setLocalEndpoints] = useState<LocalEndpointView[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    model: "",
    apiKey: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const refreshProviders = async () => {
    try {
      const list = await providerList();
      setProviders(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshProviders();
  }, []);

  const defaultProvider = providers.find(p => p.is_default) ?? providers[0];

  const pickWorkspace = async () => {
    setPicking(true);
    try {
      const dir = await openDialog({
        title: "选择工作区文件夹",
        directory: true,
        multiple: false,
      });
      if (dir) {
        const info = await workspaceSelect(String(dir));
        setWorkspaceName(info.name);
      }
    } catch {
      // 忽略选择失败
    } finally {
      setPicking(false);
    }
  };

  const detectLocal = async () => {
    setDetecting(true);
    try {
      const endpoints = (await localProvidersDetect()) as LocalEndpointView[];
      setLocalEndpoints(endpoints ?? []);
      await refreshProviders();
    } catch {
      setLocalEndpoints([]);
    } finally {
      setDetecting(false);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await providerSetDefault(id);
      await refreshProviders();
      setTestResult(null);
    } catch (e) {
      setTestResult({ id, ok: false, msg: String(e) });
    }
  };

  const testProvider = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const msg = await providerTest(id);
      setTestResult({ id, ok: true, msg: msg || "连接成功" });
    } catch (e) {
      setTestResult({ id, ok: false, msg: String(e) });
    } finally {
      setTestingId(null);
    }
  };

  const slugify = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || `custom-${Date.now().toString(36)}`;

  const saveCustomProvider = async () => {
    setFormError(null);
    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim().replace(/\/+$/, "");
    const model = form.model.trim();
    if (!name || !baseUrl || !model) {
      setFormError("请填写名称、API 地址与模型 ID");
      return;
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      setFormError("API 地址需以 http:// 或 https:// 开头");
      return;
    }
    setSaving(true);
    try {
      const id = slugify(name);
      await providerUpsert(
        {
          id,
          name,
          kind: "openai-compatible",
          base_url: baseUrl,
          model,
          enabled: true,
          builtin: false,
          local: false,
        },
        form.apiKey.trim() || undefined,
      );
      await providerSetDefault(id);
      await refreshProviders();
      setShowAdd(false);
      setForm({ name: "", baseUrl: "", model: "", apiKey: "" });
      setTestResult({ id, ok: true, msg: "已保存并设为默认" });
    } catch (e) {
      setFormError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const examples = [
    "分析当前工作区的项目结构与技术栈",
    "审查最近一次代码变更并给出改进建议",
    "帮我为关键模块编写单元测试",
  ];

  const usable = providers.some(p => p.is_default && (p.local || p.has_api_key || p.builtin));

  return (
    <div className="modal-mask z-[150] p-6">
      <div className="modal-card w-full max-w-xl rounded-2xl p-6">
        {/* 头部 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
            >
              <Brain size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                欢迎使用 Wide Thought Host
              </h2>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                三步完成首次配置，马上开始
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className="flex items-center gap-2 mt-5">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex-1 flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium"
                style={{
                  background: step >= s ? "var(--text-primary)" : "var(--surface-2)",
                  color: step >= s ? "var(--surface-0)" : "var(--text-dim)",
                }}
              >
                {step > s ? <Check size={11} /> : s}
              </div>
              {s < 3 && (
                <div
                  className="flex-1 h-px"
                  style={{ background: step > s ? "var(--text-primary)" : "var(--surface-3)" }}
                />
              )}
            </div>
          ))}
        </div>

        {/* 步骤内容 */}
        <div className="mt-6 min-h-[220px]">
          {step === 1 && (
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                第 1 步：选择工作区
              </h3>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Agent 会在工作区内读取与修改代码。可以选择任意文件夹，也可以稍后在顶部切换。
              </p>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors hover:bg-surface-2"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}
                  disabled={picking}
                  onClick={pickWorkspace}
                >
                  <FolderOpen size={16} style={{ color: "var(--text-muted)" }} />
                  <span className="flex-1 text-[13px]" style={{ color: "var(--text-primary)" }}>
                    {picking
                      ? "正在选择…"
                      : workspaceName
                        ? `已选择：${workspaceName}`
                        : "选择工作区文件夹"}
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--text-dim)" }} />
                </button>
                {!workspaceName && (
                  <button
                    type="button"
                    className="text-[11px] hover:underline"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => setStep(2)}
                  >
                    暂不选择，直接使用
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                第 2 步：配置模型
              </h3>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                选择内置免费模型，或检测本机 Ollama / vLLM，也可以添加任意 OpenAI 兼容端点。
              </p>

              {/* 当前默认 */}
              {defaultProvider && (
                <div
                  className="mt-3 px-3 py-2.5 rounded-xl flex items-center gap-3"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <Rocket size={15} style={{ color: "var(--text-muted)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[13px] font-medium truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {defaultProvider.name}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                      {defaultProvider.model}
                      {defaultProvider.local
                        ? " · 本地，无需 Key"
                        : defaultProvider.has_api_key || defaultProvider.builtin
                          ? " · 凭据就绪"
                          : " · 需要 API Key"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] hover:underline whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => testProvider(defaultProvider.id)}
                    disabled={testingId === defaultProvider.id}
                  >
                    {testingId === defaultProvider.id ? "测试中…" : "测试连接"}
                  </button>
                </div>
              )}

              {testResult && (
                <div
                  className="mt-2 text-[11px] px-3 py-2 rounded-lg"
                  style={{
                    color: testResult.ok ? "var(--text-primary)" : "#f87171",
                    background: testResult.ok ? "var(--surface-2)" : "rgba(248,113,113,0.12)",
                    border: `1px solid ${testResult.ok ? "var(--surface-3)" : "rgba(248,113,113,0.35)"}`,
                  }}
                >
                  {testResult.msg}
                </div>
              )}

              {/* 其它 Provider 列表 */}
              {providers.filter(p => !p.is_default).length > 0 && (
                <div className="mt-3 space-y-1.5 max-h-36 overflow-y-auto">
                  {providers
                    .filter(p => !p.is_default)
                    .map(p => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]"
                        style={{
                          background: "var(--surface-1)",
                          border: "1px solid var(--surface-3)",
                        }}
                      >
                        <Server size={13} style={{ color: "var(--text-dim)" }} />
                        <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                          {p.name}
                        </span>
                        <button
                          type="button"
                          className="text-[11px] hover:underline"
                          style={{ color: "var(--text-muted)" }}
                          onClick={() => setDefault(p.id)}
                        >
                          设为默认
                        </button>
                      </div>
                    ))}
                </div>
              )}

              {/* 操作区 */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] transition-colors hover:bg-surface-2"
                  style={{ border: "1px solid var(--surface-3)", color: "var(--text-primary)" }}
                  onClick={detectLocal}
                  disabled={detecting}
                >
                  {detecting ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                  检测本地模型
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] transition-colors hover:bg-surface-2"
                  style={{ border: "1px solid var(--surface-3)", color: "var(--text-primary)" }}
                  onClick={() => {
                    setShowAdd(v => !v);
                    setFormError(null);
                  }}
                >
                  <Plus size={13} />
                  添加自定义端点
                </button>
                <button
                  type="button"
                  className="text-[11px] hover:underline ml-auto"
                  style={{ color: "var(--text-muted)" }}
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  前往完整设置
                </button>
              </div>

              {localEndpoints.length > 0 && (
                <div className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  已发现本地端点：
                  {localEndpoints.map(e => `${e.kind}（${e.models.length} 个模型）`).join("、")}
                </div>
              )}

              {/* 添加表单 */}
              {showAdd && (
                <div
                  className="mt-3 p-3 rounded-xl space-y-2"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}
                >
                  <input
                    className="control w-full"
                    placeholder="名称，例如 DeepSeek"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                  <input
                    className="control w-full"
                    placeholder="API 地址，例如 https://api.deepseek.com/v1"
                    value={form.baseUrl}
                    onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                  />
                  <input
                    className="control w-full"
                    placeholder="模型 ID，例如 deepseek-chat"
                    value={form.model}
                    onChange={e => setForm({ ...form, model: e.target.value })}
                  />
                  <input
                    className="control w-full"
                    type="password"
                    placeholder="API Key（本地模型可留空）"
                    value={form.apiKey}
                    onChange={e => setForm({ ...form, apiKey: e.target.value })}
                  />
                  {formError && (
                    <div className="text-[11px]" style={{ color: "#f87171" }}>
                      {formError}
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => setShowAdd(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium"
                      style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
                      disabled={saving}
                      onClick={saveCustomProvider}
                    >
                      {saving ? "保存中…" : "保存并设为默认"}
                    </button>
                  </div>
                </div>
              )}

              {!usable && !showAdd && (
                <div className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  当前默认模型可能缺少凭据；可先测试连接，或添加自定义端点。
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                第 3 步：开始使用
              </h3>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                从示例问题开始，或直接输入你的需求。
              </p>
              <div className="mt-4 space-y-2">
                {examples.map(q => (
                  <button
                    type="button"
                    key={q}
                    className="w-full text-left px-4 py-2.5 rounded-xl text-[13px] transition-colors hover:bg-surface-2"
                    style={{
                      background: "var(--surface-1)",
                      border: "1px solid var(--surface-3)",
                      color: "var(--text-primary)",
                    }}
                    onClick={() => {
                      onDone();
                      onExampleQuestion(q);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between gap-3 mt-6">
          <button
            type="button"
            className="text-[11px] hover:underline whitespace-nowrap flex-shrink-0"
            style={{ color: "var(--text-muted)" }}
            onClick={onClose}
          >
            跳过引导
          </button>
          <div className="flex items-center gap-2 flex-shrink-0">
            {step > 1 && (
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-xs transition-colors hover:bg-surface-2 whitespace-nowrap"
                style={{ color: "var(--text-muted)" }}
                onClick={() => setStep(s => (s - 1) as Step)}
              >
                上一步
              </button>
            )}
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
              onClick={() => {
                if (step === 3) {
                  onDone();
                  onExampleQuestion("");
                } else {
                  setStep(s => (s + 1) as Step);
                }
              }}
            >
              {step === 3 ? "开始使用" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
