import type { ReactNode } from "react";

export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}

export function SegmentedControl({ options, value, onChange, size = "md" }: SegmentedControlProps) {
  const padClass = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs";

  return (
    <div
      className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
      style={{ background: "var(--surface-2)" }}
      role="radiogroup"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-md font-medium transition-all duration-150 ${padClass}`}
            style={{
              background: active ? "var(--surface-0)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,.12)" : "none",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
