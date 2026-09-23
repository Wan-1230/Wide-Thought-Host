// 架构护栏：只有 src/lib/ 允许直接 import @tauri-apps/api/*。
// 这条约束一旦破口，组件就会重新长出只有真实 WebView 才能挂载的依赖，
// 组件测试也就退化成「必须先 mock 三四个地方」。红了 = 有人绕过了 lib/ipc。
import { describe, expect, it } from "vitest";

const raw = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** glob 的 key 相对本文件所在目录，统一成 src/ 前缀方便断言与报错。 */
const sources = Object.entries(raw).map(([key, code]) => ({
  path: key.startsWith("./") ? `src/lib/${key.slice(2)}` : `src/${key.slice(3)}`,
  code,
}));

const TAURI_API_IMPORT = /from\s+["']@tauri-apps\/api\//;

describe("Tauri API 访问边界", () => {
  it("确实扫描到了 src 下的源文件", () => {
    expect(sources.length).toBeGreaterThan(25);
    expect(sources.some(s => s.path === "src/lib/ipc.ts")).toBe(true);
  });

  it("src/lib 之外没有任何文件直接 import @tauri-apps/api", () => {
    const offenders = sources
      .filter(s => !s.path.startsWith("src/lib/") && TAURI_API_IMPORT.test(s.code))
      .map(s => s.path);
    expect(offenders).toEqual([]);
  });

  it("历史上三处绕过封装的调用点仍然走 lib/ipc", () => {
    const wired: { file: string; symbol: string }[] = [
      { file: "src/App.tsx", symbol: "onMenuNewSession" },
      { file: "src/App.tsx", symbol: "onMenuQuickAsk" },
      { file: "src/App.tsx", symbol: "onMenuOpenSession" },
      { file: "src/components/settings/Settings.tsx", symbol: "onUpdateProgress" },
      { file: "src/components/titlebar/TitleBar.tsx", symbol: "onWindowResized" },
      { file: "src/components/titlebar/TitleBar.tsx", symbol: "windowToggleMaximize" },
    ];
    for (const w of wired) {
      const file = sources.find(s => s.path === w.file);
      expect(file, `找不到 ${w.file}`).toBeTruthy();
      expect(file?.code, `${w.file} 应通过 ${w.symbol} 使用 Tauri 能力`).toContain(w.symbol);
    }
  });
});
