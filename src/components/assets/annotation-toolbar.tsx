"use client";

import { ArrowUpRight, Circle, MapPin, Pencil, Square, Highlighter as HighlighterIcon } from "lucide-react";

import { ANNOTATION_COLORS, type AnnotationType } from "@/lib/asset-annotation";
import { cn } from "@/lib/utils";

const TOOLS: { type: AnnotationType; label: string; icon: typeof MapPin }[] = [
  { type: "pin", label: "Pin", icon: MapPin },
  { type: "pencil", label: "Pencil", icon: Pencil },
  { type: "rectangle", label: "Rectangle", icon: Square },
  { type: "ellipse", label: "Circle", icon: Circle },
  { type: "arrow", label: "Arrow", icon: ArrowUpRight },
  { type: "highlighter", label: "Highlighter", icon: HighlighterIcon },
];

/**
 * Markup toolbar shown above a drawable media area (image / website / a
 * paused video frame). Selecting a tool arms the overlay for that shape;
 * selecting a color changes what new shapes are drawn in. Purely
 * presentational — all drawing state lives in the parent (asset-viewer.tsx).
 */
export function AnnotationToolbar({
  activeTool,
  onSelectTool,
  color,
  onSelectColor,
}: {
  activeTool: AnnotationType | null;
  onSelectTool: (tool: AnnotationType | null) => void;
  color: string;
  onSelectColor: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-1.5 shadow-sm">
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            type="button"
            title={label}
            aria-pressed={activeTool === type}
            onClick={() => onSelectTool(activeTool === type ? null : type)}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md transition-colors",
              activeTool === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
      <div className="h-5 w-px bg-border" />
      <div className="flex items-center gap-1 px-0.5">
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.name}
            aria-pressed={color === c.value}
            onClick={() => onSelectColor(c.value)}
            style={{ backgroundColor: c.value }}
            className={cn(
              "size-5 rounded-full ring-offset-2 transition-shadow",
              color === c.value ? "ring-2 ring-foreground" : "hover:scale-110"
            )}
          />
        ))}
      </div>
      {activeTool ? (
        <>
          <div className="h-5 w-px bg-border" />
          <button
            type="button"
            onClick={() => onSelectTool(null)}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Done drawing
          </button>
        </>
      ) : null}
    </div>
  );
}
