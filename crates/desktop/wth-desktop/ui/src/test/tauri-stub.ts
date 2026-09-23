// 测试用的最小 Tauri 后端替身：实现 @tauri-apps/api 依赖的 __TAURI_INTERNALS__ 协议
// （invoke / transformCallback / event listen+unlisten），使组件测试能挂载真实的
// lib/ipc.ts，而不是 mock 掉整个封装层。命令默认返回 null，用 on() 按需注入返回值。

export interface InvokeCall {
  cmd: string;
  args: Record<string, unknown>;
}

type Handler = (args: Record<string, unknown>) => unknown;
type EventCallback = (event: { event: string; id: number; payload: unknown }) => void;

const handlers = new Map<string, Handler>();
const calls: InvokeCall[] = [];
const callbacks = new Map<number, EventCallback>();
const listeners = new Map<string, Set<number>>();
const eventIds = new Map<number, { event: string; cbId: number }>();
let nextCallbackId = 1;
let nextEventId = 1;
let nativeSeq = 1;

export const tauri = {
  /** 为某条后端命令注册返回值（同步值或 Promise）；重复注册以最后一次为准。 */
  on(cmd: string, handler: Handler) {
    handlers.set(cmd, handler);
  },
  /** 向渲染层投递一条 Rust 侧事件，触发对应 listen() 回调。 */
  emit(event: string, payload: unknown) {
    for (const cbId of listeners.get(event) ?? []) {
      callbacks.get(cbId)?.({ event, id: nativeSeq++, payload });
    }
  },
  listening(event: string): number {
    return listeners.get(event)?.size ?? 0;
  },
  /** 按发生顺序记录的全部 invoke；配合 last()/find() 断言 IPC 契约。 */
  all(): InvokeCall[] {
    return calls;
  },
  find(cmd: string): InvokeCall | undefined {
    return calls.filter(c => c.cmd === cmd).pop();
  },
  last(cmd: string): InvokeCall | undefined {
    return calls.filter(c => c.cmd === cmd).pop();
  },
  count(cmd: string): number {
    return calls.filter(c => c.cmd === cmd).length;
  },
  reset() {
    handlers.clear();
    calls.length = 0;
    callbacks.clear();
    listeners.clear();
    eventIds.clear();
  },
};

export function resetTauri() {
  tauri.reset();
}

installTauriStub();

function installTauriStub() {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
      currentMonitor: null,
    },
    transformCallback(cb: unknown) {
      const id = nextCallbackId++;
      if (typeof cb === "function") callbacks.set(id, cb as EventCallback);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    invoke(cmd: string, args: Record<string, unknown> = {}) {
      calls.push({ cmd, args });
      if (cmd === "plugin:event|listen") {
        const event = String(args.event ?? "");
        const cbId = Number(args.handler ?? 0);
        const eventId = nextEventId++;
        const set = listeners.get(event) ?? new Set<number>();
        set.add(cbId);
        listeners.set(event, set);
        eventIds.set(eventId, { event, cbId });
        return Promise.resolve(eventId);
      }
      if (cmd === "plugin:event|unlisten") {
        const rec = eventIds.get(Number(args.eventId));
        if (rec) {
          listeners.get(rec.event)?.delete(rec.cbId);
          eventIds.delete(Number(args.eventId));
        }
        return Promise.resolve(null);
      }
      if (cmd === "plugin:event|emit" || cmd === "plugin:event|emit_to") {
        return Promise.resolve(null);
      }
      const handler = handlers.get(cmd);
      if (!handler) return Promise.resolve(null);
      try {
        return Promise.resolve(handler(args));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    postMessage() {},
    convertFileSrc: (path: string) => `http://asset.localhost/${path}`,
  };
  // @tauri-apps/api 的 _unlisten 无条件解引用该对象，缺失时每次卸载监听都会抛错。
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    registerListener() {},
    unregisterListener() {},
  };
}
