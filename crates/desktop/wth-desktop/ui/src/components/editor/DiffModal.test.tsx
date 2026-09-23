// @vitest-environment jsdom
// DiffModal 冒烟测试 —— 逐块审查的两个出口：「接受」保留已写入的修改，
// 「撤销更改」必须把修改前的全文写回磁盘。
//
// @monaco-editor/react 被替身替换：真实 DiffEditor 会去加载 /monaco/vs 的 AMD 资源
// （浏览器里没有 <script> 可加载），且其内部 DOM 不是本组件的行为。替身把入参回写
// 到 data-* 上，因此「差异内容确实传进了编辑器」仍然是被断言的。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffModal } from "@/components/editor/DiffModal";
import { useWorkbenchStore } from "@/stores/workbench";
import { installStorageShim, setWideViewport } from "@/test/jsdom-shims";
import { tauri } from "@/test/tauri-stub";

vi.mock("@monaco-editor/react", async () => {
  const { createElement } = await import("react");
  const passthrough =
    (testId: string, keys: Record<string, string>) => (props: Record<string, unknown>) =>
      createElement(
        "div",
        Object.assign(
          { "data-testid": testId },
          ...Object.entries(keys).map(([attr, prop]) => ({
            [attr]: String(props[prop] ?? ""),
          })),
        ),
      );
  return {
    loader: { config: vi.fn() },
    Editor: passthrough("editor", { "data-value": "value", "data-language": "language" }),
    DiffEditor: passthrough("diff-editor", {
      "data-original": "original",
      "data-modified": "modified",
      "data-language": "language",
    }),
  };
});

const DIFF = {
  path: "src/a.ts",
  before: "export const a = 1;\n",
  after: "export const a = 2;\n",
};

function openDiff(data: { path: string; before: string; after: string } | null = DIFF) {
  useWorkbenchStore.setState({ diffModal: data });
}

beforeEach(() => {
  installStorageShim();
  setWideViewport();
  tauri.reset();
  tauri.on("file_write", () => null);
  openDiff(null);
});

afterEach(cleanup);

describe("渲染", () => {
  it("没有待审查差异时不渲染任何遮罩", () => {
    const { container } = render(<DiffModal theme="dark" />);
    expect(container.firstChild).toBeNull();
  });

  it("展示文件名、完整路径，并把前后全文交给 DiffEditor", () => {
    openDiff();
    render(<DiffModal theme="dark" />);
    expect(screen.getByText("Diff 审查：a.ts")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    const editor = screen.getByTestId("diff-editor");
    expect(editor.getAttribute("data-original")).toBe(DIFF.before);
    expect(editor.getAttribute("data-modified")).toBe(DIFF.after);
    expect(editor.getAttribute("data-language")).toBe("typescript");
  });

  it("三个动作按钮全部可见（接受 / 撤销更改 / 打开文件）", () => {
    openDiff();
    render(<DiffModal theme="dark" />);
    expect(screen.getByRole("button", { name: "接受" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "撤销更改" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开文件" })).toBeTruthy();
  });
});

describe("接受 / 撤销", () => {
  it("接受只关闭弹窗，不再写文件（修改已经落盘）", () => {
    openDiff();
    render(<DiffModal theme="dark" />);
    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    expect(useWorkbenchStore.getState().diffModal).toBeNull();
    expect(tauri.count("file_write")).toBe(0);
  });

  it("撤销更改 → file_write 写回修改前内容，然后关闭", async () => {
    openDiff();
    render(<DiffModal theme="dark" />);
    fireEvent.click(screen.getByRole("button", { name: "撤销更改" }));
    await waitFor(() => expect(tauri.count("file_write")).toBe(1));
    expect(tauri.last("file_write")?.args).toEqual({
      args: { path: DIFF.path, content: DIFF.before },
    });
    await waitFor(() => expect(useWorkbenchStore.getState().diffModal).toBeNull());
  });

  it("撤销在途时重复点击不会写两次（防止把文件打回再打回）", async () => {
    let release: () => void = () => {};
    tauri.on(
      "file_write",
      () =>
        new Promise(resolve => {
          release = () => resolve(null);
        }),
    );
    openDiff();
    render(<DiffModal theme="dark" />);
    const revert = screen.getByRole("button", { name: "撤销更改" });
    fireEvent.click(revert);
    fireEvent.click(revert);
    expect(tauri.count("file_write")).toBe(1);
    release();
    await waitFor(() => expect(useWorkbenchStore.getState().diffModal).toBeNull());
  });

  it("撤销失败时保持弹窗打开，让用户可以重试", async () => {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    tauri.on("file_write", () => Promise.reject(new Error("权限不足")));
    try {
      openDiff();
      render(<DiffModal theme="dark" />);
      fireEvent.click(screen.getByRole("button", { name: "撤销更改" }));
      await waitFor(() => expect(tauri.count("file_write")).toBe(1));
      await new Promise(r => setTimeout(r, 0));
      expect(useWorkbenchStore.getState().diffModal).toEqual(DIFF);
    } finally {
      console.error = original;
    }
  });
});

describe("打开文件 / 关闭", () => {
  it("打开文件把修改后内容送进编辑器并关闭弹窗", () => {
    openDiff();
    render(<DiffModal theme="dark" />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    const state = useWorkbenchStore.getState();
    expect(state.diffModal).toBeNull();
    expect(state.editorVisible).toBe(true);
    expect(state.openFiles[0]).toMatchObject({ path: DIFF.path, content: DIFF.after });
  });

  it("点右上角关闭等价于接受（不写盘）", () => {
    openDiff();
    render(<DiffModal theme="dark" />);
    fireEvent.click(screen.getByTitle("关闭"));
    expect(useWorkbenchStore.getState().diffModal).toBeNull();
    expect(tauri.count("file_write")).toBe(0);
  });

  it("路径里没有扩展名时语言退化为 plaintext 而不是报错", () => {
    openDiff({ path: "Makefile", before: "a", after: "b" });
    render(<DiffModal theme="dark" />);
    expect(screen.getByText("Diff 审查：Makefile")).toBeTruthy();
    expect(screen.getByTestId("diff-editor").getAttribute("data-language")).toBe("plaintext");
  });
});
