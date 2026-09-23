// @vitest-environment jsdom
// Settings 冒烟测试 —— 锁住 13 个设置页的渲染/切换，以及两个高危项：
// 内核 Agent(ACP) 开关的「默认关闭」语义、四档审批模式的渲染与持久化。

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModal } from "@/components/settings/Settings";
import type { DesktopSettings } from "@/lib/ipc";
import { makeSettings } from "@/test/fixtures";
import { installStorageShim, setWideViewport } from "@/test/jsdom-shims";
import { tauri } from "@/test/tauri-stub";

const PAGES: { label: string; desc: string }[] = [
  { label: "通用", desc: "控制桌面行为、语言与终端。" },
  { label: "模型与 API", desc: "管理模型与 API 密钥。" },
  { label: "外观", desc: "主题、字体与显示密度。" },
  { label: "MCP 与工具", desc: "管理 MCP 服务器与外部工具。" },
  { label: "技能", desc: "浏览和启用本地技能。" },
  { label: "插件", desc: "管理插件生态。" },
  { label: "记忆", desc: "查看和管理 Agent 记忆。" },
  { label: "Hooks", desc: "配置生命周期钩子。" },
  { label: "子智能体", desc: "管理子智能体配置与委派。" },
  { label: "快捷键", desc: "查看和自定义快捷键。" },
  { label: "用量", desc: "Token 消耗与用量统计。" },
  { label: "诊断", desc: "检查运行环境并导出信息。" },
  { label: "关于", desc: "版本与许可信息。" },
];

let current: DesktopSettings = makeSettings();

const MODES = ["plan", "review", "auto", "yolo"] as const;
const MODE_LABEL: Record<(typeof MODES)[number], string> = {
  plan: "Plan",
  review: "Review",
  auto: "Auto",
  yolo: "YOLO",
};

/** 后端默认替身：列表类返回空数组，其余返回结构完整的对象，避免组件解引用 null。 */
function stubBackend() {
  tauri.on("settings_get", () => current);
  tauri.on("settings_update", a => (a as { settings: DesktopSettings }).settings);
  tauri.on("provider_list", () => []);
  tauri.on("mcp_list_servers", () => []);
  tauri.on("hook_list", () => []);
  tauri.on("subagent_list", () => []);
  tauri.on("memory_list", () => []);
  tauri.on("diagnostics_get", () => []);
  tauri.on("log_list", () => []);
  tauri.on("tasks_list_recent", () => []);
  tauri.on("local_providers_detect", () => []);
  tauri.on("workflow_list", () => []);
  tauri.on("capability_view", a => ({
    kind: String((a as { kind?: string }).kind ?? ""),
    title: "能力",
    subtitle: "",
    search_placeholder: "搜索",
    sources: [],
    items: [],
    stats: { sources: 0, items: 0, enabled: 0 },
  }));
  tauri.on("plugin_market_list", () => ({ source: "local", entries: [], error: null }));
  tauri.on("workspace_index_status", () => ({
    workspace: "D:/p",
    file_count: 10,
    cache_path: "D:/p/.wth/index",
    semantic_engine: "none",
    semantic_model: null,
  }));
  tauri.on("headroom_status", () => ({
    enabled: false,
    running: false,
    port: 8787,
    installed: false,
    proxy_url: null,
    error: null,
  }));
  tauri.on("app_info", () => ({ version: "2.1.0", build_time: "2026-09-01", signed: true }));
  tauri.on("update_check", () => ({
    current_version: "2.1.0",
    latest_version: "2.1.0",
    has_update: false,
    release_url: "",
    notes: "",
  }));
  tauri.on("metrics_summary", () => ({
    total_tokens: 0,
    total_cost_usd: 0,
    today_tokens: 0,
    today_cost_usd: 0,
    week_tokens: 0,
    week_cost_usd: 0,
    tool_calls_ok: 0,
    tool_calls_fail: 0,
    tool_success_rate: 0,
    compaction_count: 0,
    compaction_failures: 0,
    by_model: [],
    recent_sessions: [],
    permission: {
      edit_mode: "review",
      allow_auto_file_edit: false,
      require_confirm_bash: true,
      require_confirm_dangerous_in_yolo: true,
      require_confirm_sensitive_path: true,
      shell_timeout_secs: 60,
      memory_limit_mb: null,
      description: "d",
    },
  }));
}

function openSettings(ui?: ReactElement) {
  return render(ui ?? <SettingsModal open onClose={() => {}} />);
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByText("正在加载设置…")).toBeNull());
}

function navRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".settings-side .row"));
}

function clickNav(label: string) {
  const row = navRows().find(r => r.textContent?.trim() === label);
  if (!row) throw new Error(`左侧导航中找不到「${label}」`);
  fireEvent.click(row);
}

/** 通过行标签定位控件：SettingRow 的 label 是唯一的非样式锚点。 */
function rowByText(text: string): HTMLElement {
  const el = screen.getByText(text).closest(".setting-row");
  if (!el) throw new Error(`找不到标签为「${text}」的设置行`);
  return el as HTMLElement;
}

function savedSettings(): DesktopSettings {
  const call = tauri.last("settings_update");
  if (!call) throw new Error("没有发出 settings_update");
  return (call.args as { settings: DesktopSettings }).settings;
}

afterEach(cleanup);

beforeEach(() => {
  installStorageShim();
  setWideViewport();
  tauri.reset();
  current = makeSettings();
  stubBackend();
});

describe("模态框开关", () => {
  it("open=false 时完全不渲染，避免残留遮罩吞掉点击", () => {
    const { container } = render(<SettingsModal open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("加载完成前显示占位，完成后显示 13 个设置页导航", async () => {
    openSettings();
    expect(screen.getByText("正在加载设置…")).toBeTruthy();
    await waitForLoaded();
    expect(navRows().map(r => r.textContent?.trim())).toEqual(PAGES.map(p => p.label));
  });

  it("settings_get 失败时不会永远卡在加载态，并把错误显示成提示", async () => {
    tauri.on("settings_get", () => Promise.reject(new Error("后端未就绪")));
    openSettings();
    await waitForLoaded();
    expect(screen.getByText("Error: 后端未就绪")).toBeTruthy();
  });

  it("Escape 关闭模态框", async () => {
    const onClose = vi.fn();
    render(<SettingsModal open onClose={onClose} />);
    await waitForLoaded();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭，点击弹窗内部不关闭", async () => {
    const onClose = vi.fn();
    render(<SettingsModal open onClose={onClose} />);
    await waitForLoaded();
    fireEvent.click(document.querySelector(".settings-modal") as Element);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".settings-mask") as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("13 个设置页切换", () => {
  it("每一页都能打开，标题与说明随之切换", async () => {
    openSettings();
    await waitForLoaded();

    for (const p of PAGES) {
      clickNav(p.label);
      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(p.label),
      );
      expect(screen.getByText(p.desc)).toBeTruthy();
      expect(document.querySelector('[data-active="true"]')?.textContent).toContain(p.label);
    }
  });

  it("initialPage 直接落到指定页", async () => {
    openSettings(<SettingsModal open onClose={() => {}} initialPage="about" />);
    await waitForLoaded();
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("关于"));
    expect(screen.getByText("版本与许可信息。")).toBeTruthy();
  });
});

describe("内核 Agent(ACP) 开关", () => {
  it("后端未返回 kernel_agent 字段时按「关闭」处理，首次拨动提交 true", async () => {
    // 关键语义：字段缺省 ≠ 开启。走自研循环是默认路径，ACP 内核必须显式打开。
    expect("kernel_agent" in current).toBe(false);
    openSettings();
    await waitForLoaded();

    fireEvent.click(rowByText("内核 Agent (ACP)").querySelector("button") as Element);
    await waitFor(() => expect(tauri.count("settings_update")).toBe(1));
    expect(savedSettings().kernel_agent).toBe(true);
  });

  it("已开启时再拨动提交 false，其余设置原样保留", async () => {
    current = makeSettings({ kernel_agent: true });
    openSettings();
    await waitForLoaded();

    fireEvent.click(rowByText("内核 Agent (ACP)").querySelector("button") as Element);
    await waitFor(() => expect(tauri.count("settings_update")).toBe(1));
    const sent = savedSettings();
    expect(sent.kernel_agent).toBe(false);
    expect(sent.edit_mode).toBe("review");
    expect(sent.language).toBe("zh-CN");
    expect(sent.context_window_tokens).toBe(128000);
  });

  it("界面上写明「默认关闭」，避免文案与实现漂移", async () => {
    openSettings();
    await waitForLoaded();
    expect(rowByText("内核 Agent (ACP)").textContent).toContain("默认关闭");
  });
});

describe("四档审批模式（Plan/Review/Auto/YOLO）", () => {
  it("四档全部可见，且选中态由后端设置决定", async () => {
    openSettings();
    await waitForLoaded();
    const radios = within(rowByText("编辑模式")).getAllByRole("radio");
    expect(radios.map(r => r.textContent)).toEqual(Object.values(MODE_LABEL));
    expect(
      radios.filter(r => r.getAttribute("aria-checked") === "true").map(r => r.textContent),
    ).toEqual(["Review"]);
  });

  for (const mode of MODES) {
    it(`切到 ${MODE_LABEL[mode]} 会发出携带该 edit_mode 的 settings_update`, async () => {
      openSettings();
      await waitForLoaded();
      fireEvent.click(within(rowByText("编辑模式")).getByRole("radio", { name: MODE_LABEL[mode] }));
      await waitFor(() => expect(tauri.count("settings_update")).toBe(1));
      expect(savedSettings().edit_mode).toBe(mode);
    });
  }

  it("保存成功后当前档位回显为后端返回的值", async () => {
    openSettings();
    await waitForLoaded();
    fireEvent.click(within(rowByText("编辑模式")).getByRole("radio", { name: "YOLO" }));
    await waitFor(() =>
      expect(
        within(rowByText("编辑模式"))
          .getByRole("radio", { name: "YOLO" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("持久化失败时给出可见反馈而不是静默丢失", async () => {
    tauri.on("settings_update", () => Promise.reject(new Error("磁盘只读")));
    openSettings();
    await waitForLoaded();
    fireEvent.click(within(rowByText("编辑模式")).getByRole("radio", { name: "YOLO" }));
    await waitFor(() => expect(screen.getByText("保存失败：Error: 磁盘只读")).toBeTruthy());
  });
});
