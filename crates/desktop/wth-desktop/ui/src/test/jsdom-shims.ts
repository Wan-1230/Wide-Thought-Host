// jsdom 环境缺失的少量浏览器 API。只补「真实 WebView 一定有、缺了会让无关路径
// 静默降级」的那几个，避免测试断言的是替身而不是被测代码。

type ShimStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
};

let shimStore: Map<string, string> | null = null;

function realStorageWorks(): boolean {
  try {
    const probe = "__wth_storage_probe__";
    window.localStorage.setItem(probe, "1");
    const ok = window.localStorage.getItem(probe) === "1";
    window.localStorage.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Give `stores/ui`'s preference persistence somewhere to live.
 *
 * Probing by read/write rather than by property presence matters: jsdom defines
 * `window.localStorage` as an accessor that can yield `undefined` (opaque origin),
 * so an existence check "succeeds" and the shim never installs.
 *
 * Installs a getter, not a value, so `window.localStorage` is never undefined for
 * code that reads it lazily; and clears on every call so the per-test
 * `beforeEach(installStorageShim)` gets a fresh store instead of leaking state.
 */
export function installStorageShim() {
  if (realStorageWorks()) return;

  if (!shimStore) {
    shimStore = new Map();
    const store = shimStore;
    const storage: ShimStorage = {
      getItem: k => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k, v) => {
        store.set(k, String(v));
      },
      removeItem: k => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: i => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => storage,
    });
  }
  shimStore.clear();
}

/** 宽窗口：避免 useResponsiveLayout 把侧边栏/右面板自动折叠干扰无关断言。 */
export function setWideViewport(width = 1600) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  window.dispatchEvent(new Event("resize"));
}
