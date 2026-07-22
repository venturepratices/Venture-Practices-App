/**
 * Shared markup-annotation types for the Asset viewer. An annotation is the
 * drawn shape attached to a comment — a point pin, a rectangle/ellipse/arrow
 * (two corner/end points), or a freehand pencil/highlighter stroke (a traced
 * path of many points). All point coordinates are PERCENTAGES (0–100) of the
 * media's rendered size, not pixels — so a shape drawn on a 2000px-wide image
 * stays in the same relative spot when viewed at 500px. Zero server imports —
 * safe to import from both the server (page.tsx) and client components.
 */

export type AnnotationType = "pin" | "rectangle" | "ellipse" | "arrow" | "pencil" | "highlighter";

export type AnnotationPoint = { x: number; y: number };

export type Annotation = {
  type: AnnotationType;
  color: string;
  points: AnnotationPoint[];
};

/** Preset color palette offered in the toolbar — distinct, high-contrast on light or dark media. */
export const ANNOTATION_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Blue", value: "#3b82f6" },
] as const;

export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0].value;

/** Tools that draw a two-point bounding shape via click-drag-release. */
export const TWO_POINT_TYPES: AnnotationType[] = ["rectangle", "ellipse", "arrow"];

/** Tools that trace a continuous freehand path while the mouse is held down. */
export const PATH_TYPES: AnnotationType[] = ["pencil", "highlighter"];

export function isAnchored(a: Pick<Annotation, "points">): boolean {
  return a.points.length > 0;
}

/** Where to anchor a popup/marker for an annotation — the point closest to
 * where the user finished drawing (feels natural: where their cursor ended up). */
export function annotationAnchor(a: Pick<Annotation, "points">): AnnotationPoint {
  return a.points[a.points.length - 1] ?? { x: 50, y: 50 };
}
