import { useEffect, useState } from "react";
import wthIcon from "@/assets/wth-icon.png";

interface SplashScreenProps {
  onDone: () => void;
}

export function SplashScreen({ onDone }: SplashScreenProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          window.clearInterval(timer);
          setTimeout(onDone, 200);
          return 100;
        }
        return p + Math.random() * 18 + 5;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [onDone]);

  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-6"
      style={{ background: "var(--bg-body)" }}
    >
      <img
        src={wthIcon}
        alt="WTH"
        className="w-16 h-16 rounded-2xl object-cover animate-pulse"
      />
      <div className="text-center">
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Wide Thought Host
        </div>
        <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          正在初始化…
        </div>
      </div>
      <div className="w-48 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
        <div
          className="h-full rounded-full transition-all duration-150"
          style={{
            width: `${Math.min(progress, 100)}%`,
            background: "var(--accent-blue)",
          }}
        />
      </div>
    </div>
  );
}
