import React, { useState } from "react";
import ReactDOM from "react-dom/client";
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
