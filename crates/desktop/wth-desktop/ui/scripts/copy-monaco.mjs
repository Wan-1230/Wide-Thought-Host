// 构建前复制 monaco-editor AMD 资源到 public/monaco/vs。
// 这样 Vite（dev/build）都能以 /monaco/vs 本地路径提供编辑器资源，无需 CDN。
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/monaco-editor/min/vs");
const dest = resolve(root, "public/monaco/vs");

if (!existsSync(src)) {
  console.error("[copy-monaco] 未找到 monaco-editor/min/vs，请先 npm install");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-monaco] 已复制 ${src} -> ${dest}`);