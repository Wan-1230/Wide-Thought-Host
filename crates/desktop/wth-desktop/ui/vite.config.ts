import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

/// <reference types="vitest" />
export default defineConfig({
  test: {
    // Default stays "node": store / IPC-contract tests never touch the DOM, and
    // booting jsdom is by far the most expensive part of a test file's startup.
    // Component tests opt in individually with the `// @vitest-environment jsdom`
    // docblock — unlike `environmentMatchGlobs` (removed in v4) or `projects`
    // (added in v4) that annotation has been stable across every vitest major.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome105", "safari15"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        // Split the heavy third-party trees so a chat-text edit no longer
        // invalidates the terminal/editor/markdown chunks in the WebView cache,
        // and the reported budget per area stays readable.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-syntax-highlighter") || id.includes("prismjs")) return "syntax";
          if (
            id.includes("react-markdown") ||
            id.includes("micromark") ||
            id.includes("mdast") ||
            id.includes("hast") ||
            id.includes("remark") ||
            id.includes("unified")
          ) {
            return "markdown";
          }
          if (id.includes("xterm") || id.includes("@xterm")) return "terminal";
          if (id.includes("monaco")) return "monaco";
          if (id.includes("lucide-react")) return "icons";
          if (
            id.includes("zustand") ||
            id.includes("react/") ||
            id.includes("react-dom/") ||
            id.includes("scheduler")
          ) {
            return "react-vendor";
          }
          if (id.includes("@tauri-apps")) return "tauri";
          return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
