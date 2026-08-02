import { useCallback, useRef, useState } from "react";

interface UseResizableOptions {
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  initialHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  direction?: "left" | "right" | "up" | "down";
}

interface UseResizableReturn {
  width: number;
  height: number;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

export function useResizable({
  initialWidth,
  minWidth = 280,
  maxWidth = 900,
  initialHeight,
  minHeight = 160,
  maxHeight = 700,
  direction = "left",
}: UseResizableOptions): UseResizableReturn {
  const isVertical = direction === "up" || direction === "down";
  const [width, setWidth] = useState(initialWidth ?? 0);
  const [height, setHeight] = useState(initialHeight ?? 0);
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isVertical) {
        const delta =
          direction === "up" ? startPosRef.current - e.clientY : e.clientY - startPosRef.current;
        const nextHeight = Math.min(maxHeight, Math.max(minHeight, startSizeRef.current + delta));
        setHeight(nextHeight);
      } else {
        const delta =
          direction === "left" ? startPosRef.current - e.clientX : e.clientX - startPosRef.current;
        const nextWidth = Math.min(maxWidth, Math.max(minWidth, startSizeRef.current + delta));
        setWidth(nextWidth);
      }
    },
    [direction, isVertical, minHeight, maxHeight, minWidth, maxWidth],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startPosRef.current = isVertical ? e.clientY : e.clientX;
      startSizeRef.current = isVertical ? height : width;
      setIsDragging(true);
      document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [isVertical, height, width, handleMouseMove, handleMouseUp],
  );

  return { width, height, isDragging, handleMouseDown };
}