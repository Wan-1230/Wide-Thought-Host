import { ChevronRight } from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
      children?: ContextMenuItem[];
    }
  | {
      type: "separator";
      key: string;
    };

const EDGE_GAP = 8;
const SUBMENU_OPEN_DELAY = 300;

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
    left: Math.min(
      Math.max(EDGE_GAP, left),
      Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP),
    ),
    top: Math.min(
      Math.max(EDGE_GAP, top),
      Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP),
    ),
  };
}

/**
 * 增强版上下文菜单：键盘导航、子菜单 hover 展开、入场动效、统一 icon 槽位。
 */
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
  const [focusedIdx, setFocusedIdx] = useState(-1);
  // Sub-menu state: key of parent item whose sub-menu is open, or null
  const [submenuParent, setSubmenuParent] = useState<string | null>(null);
  const submenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flatten items (excluding children) for keyboard navigation
  const flatItems = items.filter(item => item.type !== "separator" || items.indexOf(item) !== 0);

  // Position clamping
  useLayoutEffect(() => {
    if (!open || !point) return;
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) {
      setPosition(point);
      return;
    }
    setPosition(clampPoint(point.left, point.top, rect.width, rect.height));
  }, [open, point, items]);

  // Outside click / Escape
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

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const itemCount = items.length;
      if (itemCount === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx(prev => {
          let next = prev + 1;
          while (next < itemCount && items[next]?.type === "separator") next++;
          if (next >= itemCount) next = 0;
          while (next < itemCount && items[next]?.type === "separator") next++;
          return next < itemCount ? next : prev;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx(prev => {
          let next = prev - 1;
          while (next >= 0 && items[next]?.type === "separator") next--;
          if (next < 0) next = itemCount - 1;
          while (next >= 0 && items[next]?.type === "separator") next--;
          return next >= 0 ? next : prev;
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const item = items[focusedIdx];
        if (item && item.type !== "separator" && item.children && item.children.length > 0) {
          setSubmenuParent(item.key);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (submenuParent) {
          setSubmenuParent(null);
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = items[focusedIdx];
        if (item && item.type !== "separator" && !item.disabled) {
          item.onSelect();
          onClose();
        }
      }
    },
    [focusedIdx, items, onClose, submenuParent],
  );

  // Reset focus on open
  useEffect(() => {
    if (open) {
      setFocusedIdx(-1);
      setSubmenuParent(null);
    }
  }, [open]);

  // Sub-menu hover timer
  const onItemMouseEnter = useCallback((key: string, hasChildren: boolean) => {
    if (submenuTimer.current) {
      clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
    if (hasChildren) {
      submenuTimer.current = setTimeout(() => {
        setSubmenuParent(key);
      }, SUBMENU_OPEN_DELAY);
    } else {
      setSubmenuParent(null);
    }
  }, []);

  const onItemMouseLeave = useCallback(() => {
    if (submenuTimer.current) {
      clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
  }, []);

  // Close submenu when mouse leaves menu entirely
  const onMenuMouseLeave = useCallback(() => {
    if (submenuTimer.current) {
      clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
    setSubmenuParent(null);
  }, []);

  if (!open || !point || !position) return null;

  // Find the submenu child items
  const subItems = submenuParent
    ? ((
        items.find(i => i.type !== "separator" && i.key === submenuParent) as
          | { children?: ContextMenuItem[] }
          | undefined
      )?.children ?? [])
    : [];

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="fixed z-50 min-w-48 overflow-hidden rounded-lg border shadow-md animate-fade-in"
      style={{
        left: position.left,
        top: position.top,
        background: "var(--surface-1)",
        borderColor: "var(--surface-3)",
        animation: "contextMenuIn 0.15s var(--ease-out)",
      }}
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseLeave={onMenuMouseLeave}
    >
      {items.map((item, idx) => {
        if (item.type === "separator") {
          return (
            <div
              key={item.key}
              className="h-px mx-2 my-1"
              style={{ background: "var(--surface-3)" }}
              role="separator"
            />
          );
        }

        const hasChildren = Boolean(item.children && item.children.length > 0);
        const isFocused = idx === focusedIdx;

        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            aria-haspopup={hasChildren ? "menu" : undefined}
            aria-expanded={hasChildren ? submenuParent === item.key : undefined}
            disabled={item.disabled}
            onClick={e => {
              e.stopPropagation();
              if (!item.disabled && !hasChildren) {
                item.onSelect();
                onClose();
              }
            }}
            onMouseEnter={() => onItemMouseEnter(item.key, hasChildren)}
            onMouseLeave={onItemMouseLeave}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors duration-100 disabled:opacity-40"
            style={{
              background: isFocused ? "var(--surface-2)" : "transparent",
              color: item.danger ? "var(--accent-red)" : "var(--text-primary)",
            }}
          >
            {/* Icon slot: fixed width for alignment */}
            <span className="flex-shrink-0 w-5 flex items-center justify-center">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {hasChildren && <ChevronRight size={12} style={{ color: "var(--text-dim)" }} />}
            {!hasChildren && item.shortcut && (
              <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}

      {/* Sub-menu (rendered as sibling portal for simplicity — inline) */}
      {submenuParent && subItems.length > 0 && (
        <ContextSubMenu
          parentKey={submenuParent}
          items={subItems}
          parentRect={menuRef.current?.getBoundingClientRect() ?? null}
          onClose={() => setSubmenuParent(null)}
          onCloseAll={onClose}
        />
      )}

      {/* Inject keyframe if not already present */}
      <style>{`
        @keyframes contextMenuIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>,
    document.body,
  );
}

/**
 * Inline sub-menu rendered next to the parent.
 */
function ContextSubMenu({
  parentKey,
  items,
  parentRect,
  onClose,
  onCloseAll,
}: {
  parentKey: string;
  items: ContextMenuItem[];
  parentRect: DOMRect | null;
  onClose: () => void;
  onCloseAll: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!parentRect || !ref.current) return;
    const subRect = ref.current.getBoundingClientRect();
    // Position to the right of parent, with edge clamping
    let left = parentRect.right + 4;
    let top = parentRect.top;
    if (left + subRect.width > window.innerWidth - EDGE_GAP) {
      left = parentRect.left - subRect.width - 4;
    }
    if (top + subRect.height > window.innerHeight - EDGE_GAP) {
      top = window.innerHeight - subRect.height - EDGE_GAP;
    }
    setPos({ left, top });
  }, [parentRect]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[51] min-w-40 rounded-lg border shadow-md overflow-hidden"
      style={{
        left: pos.left,
        top: pos.top,
        background: "var(--surface-1)",
        borderColor: "var(--surface-3)",
        animation: "contextMenuIn 0.12s var(--ease-out)",
      }}
      onMouseLeave={() => onClose()}
    >
      {items.map(item => {
        if (item.type === "separator") {
          return (
            <div
              key={item.key}
              className="h-px mx-2 my-1"
              style={{ background: "var(--surface-3)" }}
              role="separator"
            />
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={e => {
              e.stopPropagation();
              if (!item.disabled) {
                item.onSelect();
                onCloseAll();
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors duration-100 hover:bg-[color:var(--surface-2)] disabled:opacity-40"
            style={{
              color: item.danger ? "var(--accent-red)" : "var(--text-primary)",
            }}
          >
            <span className="flex-shrink-0 w-5 flex items-center justify-center">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
