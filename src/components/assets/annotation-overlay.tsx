"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { PATH_TYPES, TWO_POINT_TYPES, type Annotation, type AnnotationPoint, type AnnotationType } from "@/lib/asset-annotation";
import { cn } from "@/lib/utils";

export type OverlayAnnotation = {
  id: string;
  annotation: Annotation;
  marker: number | null;
  active: boolean;
  /** Drawn but not yet posted as a comment — rendered dashed, no marker number. */
  pending?: boolean;
};

/**
 * Measures an element's rendered pixel size so the SVG overlay's viewBox can
 * exactly match it — 1 SVG unit = 1 real pixel, so rect/ellipse/pencil
 * geometry never distorts regardless of the media's aspect ratio. Seeds the
 * size synchronously via getBoundingClientRect() in a layout effect (runs
 * before paint, and — unlike a ResizeObserver's first callback — isn't
 * subject to any observer-delivery scheduling), then keeps it current via
 * ResizeObserver for actual resizes afterward.
 */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function toPct(points: { x: number; y: number }[], width: number, height: number): AnnotationPoint[] {
  if (width === 0 || height === 0) return points.map(() => ({ x: 0, y: 0 }));
  return points.map((p) => ({ x: (p.x / width) * 100, y: (p.y / height) * 100 }));
}

/**
 * Renders finalized annotations for the current version as an SVG overlay on
 * top of `children` (an image, an iframe wrapper, or a paused video frame),
 * and — when `activeTool` is set — captures pointer events to draw a new one.
 * Calling `onFinishDrawing` hands the finished shape (percentage coordinates)
 * back to the parent, which renders it back into `annotations` as `pending`
 * (dashed, no marker) so it stays visible on the media until posted — the
 * shape is never lost when the mouse is released. `onStartDrawing` fires the
 * instant a NEW mark begins, so the parent can drop the previous pending one
 * immediately (matches "start marking something else → old one disappears").
 *
 * `popup`, if given, renders arbitrary content (the comment composer)
 * anchored at a percentage position within this same coordinate space — used
 * to show a mini "type your comment here" box right next to the mark.
 *
 * When no tool is active, the overlay has `pointer-events: none` so clicks
 * pass through to whatever's underneath (a live iframe, video controls).
 */
export function AnnotationOverlay({
  annotations,
  activeTool,
  color,
  onFinishDrawing,
  onStartDrawing,
  popup,
  children,
  className,
}: {
  annotations: OverlayAnnotation[];
  activeTool: AnnotationType | null;
  color: string;
  onFinishDrawing: (annotation: Annotation) => void;
  onStartDrawing?: () => void;
  popup?: { x: number; y: number; content: React.ReactNode } | null;
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [draft, setDraft] = useState<{ x: number; y: number }[] | null>(null);
  const drawingRef = useRef(false);

  function pointerToLocal(e: React.PointerEvent): { x: number; y: number } {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!activeTool) return;
    e.preventDefault();
    onStartDrawing?.();
    const p = pointerToLocal(e);
    if (activeTool === "pin") {
      onFinishDrawing({ type: "pin", color, points: toPct([p], size.width, size.height) });
      return;
    }
    drawingRef.current = true;
    setDraft([p]);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drawingRef.current || !activeTool) return;
    const p = pointerToLocal(e);
    if (TWO_POINT_TYPES.includes(activeTool)) {
      setDraft((prev) => (prev ? [prev[0], p] : [p]));
    } else if (PATH_TYPES.includes(activeTool)) {
      setDraft((prev) => {
        if (!prev) return [p];
        const last = prev[prev.length - 1];
        // Skip near-duplicate points so long strokes don't balloon in size.
        if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return prev;
        return [...prev, p];
      });
    }
  }

  function handlePointerUp() {
    if (!drawingRef.current || !activeTool || !draft) {
      drawingRef.current = false;
      setDraft(null);
      return;
    }
    drawingRef.current = false;
    const points = draft.length >= 2 ? draft : [draft[0], draft[0]];
    setDraft(null);
    onFinishDrawing({ type: activeTool, color, points: toPct(points, size.width, size.height) });
  }

  const draftPct = draft ? toPct(draft, size.width, size.height) : null;

  return (
    <div ref={ref} className={cn("relative", className)}>
      {children}
      <svg
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
        preserveAspectRatio="none"
        className={cn("absolute inset-0 size-full touch-none", activeTool ? "cursor-crosshair" : "pointer-events-none")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {annotations.map((a) => (
          <AnnotationShape
            key={a.id}
            shape={a.annotation}
            marker={a.marker}
            active={a.active}
            pending={a.pending}
            width={size.width}
            height={size.height}
          />
        ))}
        {draftPct ? (
          <AnnotationShape
            shape={{ type: activeTool!, color, points: draftPct.length >= 2 ? draftPct : [draftPct[0], draftPct[0]] }}
            marker={null}
            active={false}
            width={size.width}
            height={size.height}
            preview
          />
        ) : null}
      </svg>
      {popup ? (
        <div
          className="absolute z-30"
          style={{
            left: `${popup.x}%`,
            top: `${popup.y}%`,
            transform: `translate(${popup.x > 60 ? "-100%" : "12px"}, ${popup.y > 65 ? "-100%" : "12px"})`,
          }}
        >
          {popup.content}
        </div>
      ) : null}
    </div>
  );
}

function px(pctVal: number, dimension: number): number {
  return (pctVal / 100) * dimension;
}

function AnnotationShape({
  shape,
  marker,
  active,
  pending,
  width,
  height,
  preview,
}: {
  shape: Annotation;
  marker: number | null;
  active: boolean;
  pending?: boolean;
  width: number;
  height: number;
  preview?: boolean;
}) {
  const pts = shape.points.map((p) => ({ x: px(p.x, width), y: px(p.y, height) }));
  const strokeWidth = active ? 4 : 2.5;
  const opacity = preview ? 0.6 : shape.type === "highlighter" ? 0.35 : 1;
  const glow = active ? { filter: "drop-shadow(0 0 4px rgba(0,0,0,0.5))" } : undefined;
  // Pending (drawn, not yet posted) shapes are dashed with no marker number —
  // visually "draft" until the comment is actually saved.
  const dash = pending ? 6 : undefined;

  const markerBadge = !pending && marker != null && pts[0] ? (
    <g transform={`translate(${pts[0].x}, ${pts[0].y})`}>
      <circle r={11} fill={shape.color} stroke="white" strokeWidth={2} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="white">
        {marker}
      </text>
    </g>
  ) : null;

  if (shape.type === "pin") {
    return (
      <g style={glow}>
        <circle
          cx={pts[0].x}
          cy={pts[0].y}
          r={active ? 13 : 11}
          fill={pending ? "none" : shape.color}
          stroke={pending ? shape.color : "white"}
          strokeWidth={pending ? 3 : 2}
          strokeDasharray={dash}
          opacity={opacity}
        />
        {!pending && marker != null ? (
          <text x={pts[0].x} y={pts[0].y} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="white">
            {marker}
          </text>
        ) : null}
      </g>
    );
  }

  if (shape.type === "rectangle") {
    const x = Math.min(pts[0].x, pts[1].x);
    const y = Math.min(pts[0].y, pts[1].y);
    const w = Math.abs(pts[1].x - pts[0].x);
    const h = Math.abs(pts[1].y - pts[0].y);
    return (
      <g style={glow}>
        <rect x={x} y={y} width={w} height={h} fill="none" stroke={shape.color} strokeWidth={strokeWidth} strokeDasharray={dash} opacity={opacity} rx={2} />
        {markerBadge}
      </g>
    );
  }

  if (shape.type === "ellipse") {
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;
    const rx = Math.abs(pts[1].x - pts[0].x) / 2;
    const ry = Math.abs(pts[1].y - pts[0].y) / 2;
    return (
      <g style={glow}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={shape.color} strokeWidth={strokeWidth} strokeDasharray={dash} opacity={opacity} />
        {markerBadge}
      </g>
    );
  }

  if (shape.type === "arrow") {
    const markerId = `arrowhead-${shape.color.replace("#", "")}-${active ? "active" : preview ? "preview" : pending ? "pending" : "n"}`;
    return (
      <g style={glow}>
        <defs>
          <marker id={markerId} markerWidth={10} markerHeight={10} refX={8} refY={5} orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L10,5 L0,10 Z" fill={shape.color} />
          </marker>
        </defs>
        <line
          x1={pts[0].x}
          y1={pts[0].y}
          x2={pts[1].x}
          y2={pts[1].y}
          stroke={shape.color}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          opacity={opacity}
          markerEnd={`url(#${markerId})`}
        />
        {markerBadge}
      </g>
    );
  }

  // pencil / highlighter — freehand traced polyline.
  const pointsAttr = pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <g style={glow}>
      <polyline
        points={pointsAttr}
        fill="none"
        stroke={shape.color}
        strokeWidth={shape.type === "highlighter" ? 14 : 3}
        strokeDasharray={dash}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        style={shape.type === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
      />
      {markerBadge}
    </g>
  );
}
