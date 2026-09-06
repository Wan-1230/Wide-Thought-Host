import { useEffect, useState } from "react";
import { Brain, Check, ChevronRight, FolderOpen, Rocket, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { providerList, workspaceSelect, type ProviderSummary } from "@/lib/ipc";

interface Props {
  onClose: () => void;
  onDone: () => void;
  onOpenSettings: () => void;
  onExampleQuestion: (question: string) => void;
}

/** G5: 首次启动引导 — 三步：工作区 → 模型 → 首次提问。 */
export function OnboardingModal({ onClose, onDone, onOpenSettings, onExampleQuestion }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    providerList().then(setProviders).catch(() => {});
  }, []);

  const defaultProvider = providers.find((p) => p.is_default) ?? providers[0];

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

  const examples = [
    "分析当前工作区的项目结构与技术栈",
    "审查最近一次代码变更并给出改进建议",
    "帮我为关键模块编写单元测试",
  ];

  return (
    <div
      className="modal-mask z-[150] p-6"
    >
      <div
        className="modal-card w-full max-w-lg rounded-2xl p-6"
      >
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
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2" style={{ color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className="flex items-center gap-2 mt-5">
          {[1, 2, 3].map((s) => (
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
                <div className="flex-1 h-px" style={{ background: step > s ? "var(--text-primary)" : "var(--surface-3)" }} />
              )}
            </div>
          ))}
        </div>

        {/* 步骤内容 */}
        <div className="mt-6 min-h-[180px]">
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
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors hover:bg-surface-2"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}
                  disabled={picking}
                  onClick={pickWorkspace}
                >
                  <FolderOpen size={16} style={{ color: "var(--accent-blue)" }} />
                  <span className="flex-1 text-[13px]" style={{ color: "var(--text-primary)" }}>
                    {picking ? "正在选择…" : workspaceName ? `已选择：${workspaceName}` : "选择工作区文件夹"}
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--text-dim)" }} />
                </button>
                {!workspaceName && (
                  <button
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
                第 2 步：确认模型
              </h3>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                已内置默认模型，开箱即用。你也可以在设置中切换或添加自己的模型与 API。
              </p>
              <div
                className="mt-4 px-4 py-3 rounded-xl flex items-center gap-3"
                style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)" }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
                  <Rocket size={15} style={{ color: "var(--accent-green)" }} />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                    {defaultProvider?.name || "默认模型"}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {defaultProvider?.has_api_key ? "凭据已就绪，可直接对话" : "内置凭据，可直接对话"}
                  </div>
                </div>
                <button
                  className="text-[11px] hover:underline"
                  style={{ color: "var(--accent-blue)" }}
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  前往设置
                </button>
              </div>
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
                {examples.map((q) => (
                  <button
                    key={q}
                    className="w-full text-left px-4 py-2.5 rounded-xl text-[13px] transition-colors hover:bg-surface-2"
                    style={{ background: "var(--surface-1)", border: "1px solid var(--surface-3)", color: "var(--text-primary)" }}
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
        <div className="flex items-center justify-between mt-6">
          <button
            className="text-[11px] hover:underline"
            style={{ color: "var(--text-muted)" }}
            onClick={onClose}
          >
            跳过引导
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                className="px-4 py-2 rounded-lg text-xs transition-colors hover:bg-surface-2"
                style={{ color: "var(--text-muted)" }}
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
              >
                上一步
              </button>
            )}
            <button
              className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
              onClick={() => {
                if (step === 3) {
                  onDone();
                  onExampleQuestion("");
                } else {
                  setStep((s) => (s + 1) as 1 | 2 | 3);
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