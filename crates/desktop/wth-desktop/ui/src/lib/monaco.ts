// Monaco Editor 本地化配置：使用随应用打包的 AMD 资源（/monaco/vs），无需 CDN。
// 资源由 scripts/copy-monaco.mjs 在 build/dev 前复制到 public/monaco/vs。
import { loader } from "@monaco-editor/react";

loader.config({ paths: { vs: "/monaco/vs" } });
