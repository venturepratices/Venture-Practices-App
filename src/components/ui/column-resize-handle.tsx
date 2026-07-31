"use client";

import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

const MIN_WIDTH = 60;
const MAX_WIDTH = 420;

/**
 * A thin drag handle pinned to the right edge of a resizable header cell
 * (the cell needs `relative` for this `absolute` positioning to anchor
 * correctly). Reports live width during the drag (for immediate visual
 * feedback) and a final commit on release (the only time it's persisted).
 */
export function ColumnResizeHandle({
  width,
  onResize,
  className,
}: {
  width: number;
  onResize: (width: number, commit: boolean) => void;
  className?: string;
}) {
  function handlePointerDown(event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;

    function clamp(next: number) {
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    }

    function onMove(moveEvent: PointerEvent) {
      onResize(clamp(startWidth + (moveEvent.clientX - startX)), false);
    }
    function onUp(upEvent: PointerEvent) {
      onResize(clamp(startWidth + (upEvent.clientX - startX)), true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <span
      onPointerDown={handlePointerDown}
      onClick={(e) => e.stopPropagation()}
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize column"
      title="Drag to resize column"
      className={cn(
        "group absolute inset-y-0 right-[-8px] z-10 flex w-4 cursor-col-resize touch-none select-none items-center justify-center rounded-sm hover:bg-primary/10",
        "after:absolute after:inset-y-1 after:left-1/2 after:w-[3px] after:-translate-x-1/2 after:rounded-full after:bg-border after:transition-colors group-hover:after:bg-primary",
        className
      )}
    >
      <GripVertical className="relative size-3 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" />
    </span>
  );
}
