import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className="h-full w-full flex flex-col items-center justify-center gap-4 p-8"
          style={{ background: "var(--bg-body)", color: "var(--text-primary)" }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--surface-2)" }}
          >
            <AlertTriangle size={28} style={{ color: "var(--accent-orange)" }} />
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold">出现了一些问题</h2>
            <p className="mt-1 text-xs max-w-sm" style={{ color: "var(--text-muted)" }}>
              {this.state.error?.message || "未知错误"}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors"
            style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
          >
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
