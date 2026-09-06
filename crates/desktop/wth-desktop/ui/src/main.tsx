import React, { useState } from "react";
import ReactDOM from "react-dom/client";
// 必须最先导入：在非 Tauri 环境安装浏览器预览垫片
import "./lib/tauri-mock";
import App from "./App";
import { SplashScreen } from "./components/common/SplashScreen";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import "./index.css";

function Root() {
  const [loading, setLoading] = useState(true);

  if (loading) {
    return <SplashScreen onDone={() => setLoading(false)} />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
