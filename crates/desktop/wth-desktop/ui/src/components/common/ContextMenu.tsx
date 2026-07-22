import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

export type ContextMenuPoint = { left: number; top: number };

export type ContextMenuItem =
  | {
      type?: "item";
      key: string;
      icon?: ReactNode;
      label: ReactNode;
      disabled?: boolean;
      danger?: boolean;
      shortcut?: string;
      onSelect: () => void;
    }
  | {
      type: "separator";
      key: string;
    };

const EDGE_GAP = 8;

export function contextMenuPointFromEvent(
  event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
): ContextMenuPoint {
  if ("clientX" in event && event.clientX > 0 && event.clientY > 0) {
    return { left: event.clientX, top: event.clientY };
  }
  const rect = event.currentTarget.getBoundingClientRect();
  return { left: rect.left + 12, top: rect.bottom + 6 };
}

function clampPoint(left: number, top: number, width: number, height: number): ContextMenuPoint {
  if (typeof window === "undefined") return { left, top };
  return {
    left: Math.min(Math.max(EDGE_GAP, left), Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP)),
    top: Math.min(Math.max(EDGE_GAP, top), Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP)),
  };
}

export function ContextMenu({
  open,
  point,
  items,
  onClose,
  ariaLabel = "上下文菜单",
}: {
  open: boolean;
  point: ContextMenuPoint | null;
  items: ContextMenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ContextMenuPoint | null>(point);

  useLayoutEffect(() => {
    if (!open || !point) return;
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) {
      setPosition(point);
      return;
    }
    setPosition(clampPoint(point.left, point.top, rect.width, rect.height));
  }, [open, point, items]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose]);

  if (!open || !point || !position) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-50 min-w-48 overflow-hidden rounded-xl border shadow-2xl"
      style={{
        left: position.left,
        top: position.top,
        background: "var(--surface-1)",
        borderColor: "var(--surface-3)",
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item) => {
        if (item.type === "separator") {
          return <div key={item.key} className="h-px bg-[color:var(--surface-3)]" role="separator" />;
        }
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (!item.disabled) item.onSelect();
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[color:var(--surface-2)] disabled:opacity-40 ${
              item.danger ? "text-[color:var(--accent-red)]" : "text-[color:var(--text-primary)]"
            }`}
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>{item.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
