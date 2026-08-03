import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/// <reference types="vitest" />
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
  },
});
