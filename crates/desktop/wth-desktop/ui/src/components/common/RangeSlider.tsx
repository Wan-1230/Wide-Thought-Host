import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface RangeSliderOption<T extends string = string> {
  value: T;
  label: string;
}

interface RangeSliderProps<T extends string = string> {
  options: RangeSliderOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
}

/**
 * 可视化滑块选择器 — 水平轨道 + 渐变填充 + 刻度标记 + 拖拽 + 键盘。
 * 适用于推理力度 (low→max) / 编辑模式 (plan→yolo) 等 4 档枚举。
 */
export function RangeSlider<T extends string = string>({
  options,
  value,
  onChange,
  size = "md",
  disabled = false,
}: RangeSliderProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const currentIndex = options.findIndex((opt) => opt.value === value);
  const activeIdx = currentIndex >= 0 ? currentIndex : 0;
  const total = options.length;
  // Progress 0..1 — thumb sits at the center of the step
  const progress = total > 1 ? activeIdx / (total - 1) : 0;
  const percent = Math.round(progress * 100);

  // Wrap onChange for stable reference
  const commit = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(total - 1, idx));
      if (options[clamped] && options[clamped].value !== value) {
        onChange(options[clamped].value);
      }
    },
    [onChange, options, total, value],
  );

  // Keyboard
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        commit(activeIdx - 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        commit(activeIdx + 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        commit(0);
      } else if (e.key === "End") {
        e.preventDefault();
        commit(total - 1);
      }
    },
    [activeIdx, commit, disabled, total],
  );

  // Mouse / touch drag
  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const idx = Math.round(ratio * (total - 1));
      commit(idx);
    },
    [commit, total],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updateFromClientX(e.clientX);
    },
    [disabled, updateFromClientX],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const h = size === "sm" ? 32 : 40;
  const thumbR = size === "sm" ? 7 : 8;

  return (
    <div
      className="relative select-none touch-none"
      style={{ height: h, width: "100%", maxWidth: 280 }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={0}
      aria-valuemax={total - 1}
      aria-valuenow={activeIdx}
      aria-label={options[activeIdx]?.label ?? ""}
      onKeyDown={onKeyDown}
    >
      {/* Track */}
      <div
        ref={trackRef}
        className="absolute left-0 right-0 rounded-full cursor-pointer"
        style={{
          top: "50%",
          transform: "translateY(-50%)",
          height: size === "sm" ? 4 : 5,
          background: "var(--surface-3)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Filled portion */}
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-[width] duration-150"
          style={{
            width: `${percent}%`,
            background: disabled
              ? "var(--surface-4)"
              : "linear-gradient(90deg, var(--accent-blue), var(--accent-purple))",
          }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 rounded-full shadow-md transition-[left] duration-150"
          style={{
            width: thumbR * 2,
            height: thumbR * 2,
            marginLeft: -thumbR,
            marginTop: -thumbR,
            left: `${percent}%`,
            background: disabled ? "var(--surface-4)" : "var(--text-primary)",
            boxShadow: disabled
              ? "none"
              : "0 1px 4px rgba(0,0,0,0.25), 0 0 0 2px var(--surface-0)",
          }}
        />
      </div>

      {/* Tick labels */}
      <div
        className="absolute left-0 right-0 flex justify-between"
        style={{
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }}
      >
        {options.map((opt, i) => {
          const active = i === activeIdx;
          return (
            <button
              key={opt.value}
              type="button"
              tabIndex={-1}
              className="absolute text-center transition-colors duration-150"
              style={{
                left: total > 1 ? `${(i / (total - 1)) * 100}%` : "50%",
                transform: "translate(-50%, -50%)",
                fontSize: size === "sm" ? 10 : 11,
                fontWeight: active ? 600 : 400,
                color: active
                  ? disabled
                    ? "var(--text-dim)"
                    : "var(--text-primary)"
                  : "var(--text-dim)",
                background: active
                  ? disabled
                    ? "var(--surface-2)"
                    : "var(--surface-2)"
                  : "transparent",
                borderRadius: 6,
                padding: "2px 8px",
                whiteSpace: "nowrap",
                cursor: disabled ? "default" : "pointer",
                pointerEvents: disabled ? "none" : "auto",
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) commit(i);
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
