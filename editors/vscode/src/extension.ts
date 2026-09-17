/**
 * WTH Agent — VS Code 扩展（M4：ACP 对话 + 审批）。
 *
 * - Webview 聊天面板：发送 prompt、展示流式文本与工具审批
 * - 子进程：`wth agent stdio`（JSON-RPC 换行协议）
 * - 审批：session/request_permission → 面板 Allow / Deny
 */
import * as vscode from "vscode";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";

type JsonRpc = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: any; result?: any; error?: any };

let child: ChildProcessWithoutNullStreams | null = null;
let output: vscode.OutputChannel;
let panel: vscode.WebviewPanel | null = null;
let buffer = "";
let nextId = 1;
let sessionId: string | null = null;
const pending = new Map<number | string, (v: any) => void>();
const pendingApprovals = new Map<string, { resolve: (ok: boolean) => void }>();

function cfg() {
  const c = vscode.workspace.getConfiguration("wth");
  return {
    cliPath: c.get<string>("cliPath", "wth"),
    extraArgs: c.get<string[]>("extraArgs", []),
  };
}

function append(line: string) {
  output.appendLine(line);
}

function postToPanel(msg: any) {
  panel?.webview.postMessage(msg);
}

function sendRpc(obj: JsonRpc) {
  if (!child?.stdin.writable) {
    vscode.window.showWarningMessage("WTH: session not running");
    return;
  }
  const line = JSON.stringify(obj);
  append(`→ ${line}`);
  child.stdin.write(line + "\n");
}

function request(method: string, params: any): Promise<any> {
  const id = nextId++;
  const p = new Promise((resolve) => pending.set(id, resolve));
  sendRpc({ jsonrpc: "2.0", id, method, params });
  return p;
}

function notify(method: string, params: any) {
  sendRpc({ jsonrpc: "2.0", method, params });
}

function handleServerLine(line: string) {
  let msg: JsonRpc;
  try {
    msg = JSON.parse(line);
  } catch {
    append(`! non-json: ${line.slice(0, 200)}`);
    return;
  }
  append(`← ${line}`);

  // 响应
  if (msg.id !== undefined && !msg.method) {
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg.error ?? msg.result);
    }
    return;
  }

  // 通知 / 请求
  switch (msg.method) {
    case "session/update": {
      const p = msg.params || {};
      const upd = p.update;
      if (upd?.sessionUpdate === "agent_message_chunk" || upd?.sessionUpdate === "agent_thought_chunk") {
        const text = upd.content?.text ?? upd.content ?? "";
        if (text) {
          postToPanel({
            type: "chunk",
            kind: upd.sessionUpdate === "agent_thought_chunk" ? "thought" : "text",
            text,
          });
        }
      } else if (upd?.sessionUpdate === "tool_call") {
        postToPanel({
          type: "tool",
          toolCallId: upd.toolCallId,
          title: upd.title || upd.toolCallId,
          status: upd.status || "pending",
        });
      } else if (upd?.sessionUpdate === "plan") {
        postToPanel({ type: "plan", entries: upd.entries || [] });
      }
      break;
    }
    case "session/request_permission": {
      const reqId = msg.id;
      const options: any[] = msg.params?.options || [];
      const kind = msg.params?.toolCall?.title || "permission";
      postToPanel({
        type: "approval",
        id: reqId,
        title: kind,
        options,
      });
      // 默认等面板选择；若无面板则拒绝
      if (!panel) {
        sendRpc({
          jsonrpc: "2.0",
          id: reqId,
          result: { outcome: { outcome: "cancelled" } },
        });
      } else {
        pendingApprovals.set(String(reqId), {
          resolve: (ok) => {
            const optionId = options.find((o) => o.kind === "allow_once")?.optionId
              || options[0]?.optionId
              || "allow";
            sendRpc({
              jsonrpc: "2.0",
              id: reqId,
              result: {
                outcome: ok
                  ? { outcome: "selected", optionId }
                  : { outcome: "cancelled" },
              },
            });
          },
        });
      }
      break;
    }
    case "fs/read_text_file":
    case "fs/write_text_file": {
      // 最小实现：只读本地文件；写拒绝
      if (msg.method === "fs/read_text_file") {
        try {
          const fs = require("fs") as typeof import("fs");
          const text = fs.readFileSync(msg.params.path, "utf8");
          sendRpc({ jsonrpc: "2.0", id: msg.id, result: { content: text } });
        } catch (e: any) {
          sendRpc({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32000, message: String(e) },
          });
        }
      } else {
        sendRpc({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "write not allowed in vscode bridge yet" },
        });
      }
      break;
    }
    default:
      if (msg.id !== undefined) {
        sendRpc({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: `method not handled: ${msg.method}` },
        });
      }
  }
}

function ensurePanel(ctx: vscode.ExtensionContext) {
  if (panel) {
    panel.reveal();
    return panel;
  }
  panel = vscode.window.createWebviewPanel(
    "wthAgent",
    "WTH Agent",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = getHtml();
  panel.webview.onDidReceiveMessage(async (m) => {
    if (m?.type === "prompt") {
      await sendPrompt(String(m.text || ""));
    } else if (m?.type === "approval") {
      const p = pendingApprovals.get(String(m.id));
      if (p) {
        pendingApprovals.delete(String(m.id));
        p.resolve(!!m.ok);
      }
    } else if (m?.type === "stop") {
      stopSession();
    } else if (m?.type === "start") {
      await startSession(ctx);
    }
  });
  panel.onDidDispose(() => {
    panel = null;
  });
  return panel;
}

async function startSession(_ctx: vscode.ExtensionContext) {
  if (child) {
    postToPanel({ type: "status", text: "already running" });
    return;
  }
  const { cliPath, extraArgs } = cfg();
  const args = ["agent", "stdio", ...extraArgs];
  append(`[wth] spawn: ${cliPath} ${args.join(" ")}`);
  try {
    child = spawn(cliPath, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  } catch (e) {
    append(`[wth] spawn failed: ${e}`);
    vscode.window.showErrorMessage(`WTH: 无法启动 ${cliPath}，请检查 wth.cliPath`);
    postToPanel({ type: "status", text: `spawn failed: ${e}` });
    child = null;
    return;
  }
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) handleServerLine(line);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c: string) => {
    for (const line of c.split(/\r?\n/)) if (line.trim()) append(`! ${line}`);
  });
  child.on("exit", (code) => {
    append(`[wth] exit ${code}`);
    child = null;
    postToPanel({ type: "status", text: `exited (${code})` });
  });

  postToPanel({ type: "status", text: "initializing…" });
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: false },
    },
    clientInfo: { name: "vscode-wth", version: "0.1.0" },
  });
  if (init?.error) {
    postToPanel({ type: "status", text: `initialize error: ${init.error.message}` });
    return;
  }
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const sess = await request("session/new", { cwd, mcpServers: [] });
  sessionId = sess?.sessionId || sess?.result?.sessionId || "default";
  postToPanel({ type: "status", text: `ready (session ${sessionId})` });
}

async function sendPrompt(text: string) {
  if (!child) {
    postToPanel({ type: "status", text: "not running — click Start first" });
    return;
  }
  postToPanel({ type: "user", text });
  postToPanel({ type: "status", text: "working…" });
  const res = await request("session/prompt", {
    sessionId: sessionId || "default",
    prompt: [{ type: "text", text }],
  });
  if (res?.error) {
    postToPanel({ type: "status", text: `error: ${res.error.message || res.error}` });
  } else {
    postToPanel({ type: "status", text: "done" });
  }
}

function stopSession() {
  if (!child) return;
  append("[wth] stop");
  child.kill();
  child = null;
  postToPanel({ type: "status", text: "stopped" });
}

function getHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; display:flex; flex-direction:column; height:100vh; margin:0; box-sizing:border-box; }
  #log { flex:1; overflow:auto; white-space:pre-wrap; word-break:break-word; font-size:12px; line-height:1.5; }
  .user { color: var(--vscode-textLink-foreground); margin: 8px 0 4px; font-weight:600; }
  .thought { opacity:.65; font-style:italic; }
  .tool { border-left:3px solid var(--vscode-charts-blue); padding:4px 8px; margin:4px 0; background: var(--vscode-editor-background); }
  .status { opacity:.7; font-size:11px; margin:6px 0; }
  .approval { border:1px solid var(--vscode-charts-yellow); padding:8px; margin:8px 0; border-radius:6px; }
  .approval button { margin-right:8px; }
  #row { display:flex; gap:8px; margin-top:8px; }
  textarea { flex:1; min-height:60px; resize:vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border:1px solid var(--vscode-input-border, #555); border-radius:4px; padding:6px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border:none; border-radius:4px; padding:6px 12px; cursor:pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <div style="display:flex; gap:8px; margin-bottom:8px;">
    <button id="start">Start</button>
    <button id="stop">Stop</button>
  </div>
  <div id="log"></div>
  <div id="row">
    <textarea id="input" placeholder="描述要完成的任务…"></textarea>
    <button id="send">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('input');
    function el(cls, text) {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      return d;
    }
    document.getElementById('start').onclick = () => vscode.postMessage({ type: 'start' });
    document.getElementById('stop').onclick = () => vscode.postMessage({ type: 'stop' });
    document.getElementById('send').onclick = () => {
      const t = input.value.trim();
      if (!t) return;
      vscode.postMessage({ type: 'prompt', text: t });
      input.value = '';
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        document.getElementById('send').click();
      }
    });
    window.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m.type === 'user') el('user', 'You: ' + m.text);
      else if (m.type === 'chunk') {
        let last = log.lastElementChild;
        if (!last || !last.classList.contains(m.kind)) {
          last = el(m.kind, '');
        }
        last.textContent += m.text;
        log.scrollTop = log.scrollHeight;
      }
      else if (m.type === 'tool') el('tool', '⚙ ' + m.title + ' [' + m.status + ']');
      else if (m.type === 'plan') el('status', 'Plan: ' + (m.entries||[]).map(e => e.description || e).join(' → '));
      else if (m.type === 'status') el('status', m.text);
      else if (m.type === 'approval') {
        const d = document.createElement('div');
        d.className = 'approval';
        d.textContent = 'Permission: ' + m.title;
        const allow = document.createElement('button');
        allow.textContent = 'Allow';
        allow.onclick = () => { vscode.postMessage({ type: 'approval', id: m.id, ok: true }); d.remove(); };
        const deny = document.createElement('button');
        deny.textContent = 'Deny';
        deny.onclick = () => { vscode.postMessage({ type: 'approval', id: m.id, ok: false }); d.remove(); };
        d.appendChild(document.createElement('br'));
        d.appendChild(allow);
        d.appendChild(deny);
        log.appendChild(d);
        log.scrollTop = log.scrollHeight;
      }
    });
  </script>
</body>
</html>`;
}

export function activate(ctx: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("WTH Agent");
  ctx.subscriptions.push(output);
  ctx.subscriptions.push(
    vscode.commands.registerCommand("wth.openPanel", () => ensurePanel(ctx)),
    vscode.commands.registerCommand("wth.startSession", () => {
      ensurePanel(ctx);
      startSession(ctx);
    }),
    vscode.commands.registerCommand("wth.sendPrompt", async () => {
      ensurePanel(ctx);
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.document.getText(editor.selection);
      const prompt = await vscode.window.showInputBox({
        prompt: "WTH Agent prompt",
        value: selection || "",
      });
      if (prompt) await sendPrompt(prompt);
    }),
    vscode.commands.registerCommand("wth.stopSession", stopSession)
  );
  append("[wth] extension activated (webview ACP)");
}

export function deactivate() {
  stopSession();
}
