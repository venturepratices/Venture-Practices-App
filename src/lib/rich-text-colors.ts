/**
 * Preset palettes for the rich-text editor's text-color and highlight-color
 * pickers (src/components/ui/rich-text-editor.tsx). Kept separate from
 * ANNOTATION_COLORS (src/lib/asset-annotation.ts) — that palette is tuned for
 * high-contrast markup on media, not for text/background use in a document.
 */

export const TEXT_COLOR_PRESETS = [
  { name: "Black", value: "#0f172a" },
  { name: "Gray", value: "#64748b" },
  { name: "Red", value: "#dc2626" },
  { name: "Orange", value: "#ea580c" },
  { name: "Amber", value: "#d97706" },
  { name: "Green", value: "#16a34a" },
  { name: "Teal", value: "#0d9488" },
  { name: "Blue", value: "#2563eb" },
  { name: "Purple", value: "#9333ea" },
  { name: "Pink", value: "#db2777" },
] as const;

/** Soft background tints — legible with dark text on top, unlike a saturated block color. */
export const HIGHLIGHT_COLOR_PRESETS = [
  { name: "Yellow", value: "#fef08a" },
  { name: "Orange", value: "#fed7aa" },
  { name: "Red", value: "#fecaca" },
  { name: "Pink", value: "#fbcfe8" },
  { name: "Purple", value: "#e9d5ff" },
  { name: "Blue", value: "#bfdbfe" },
  { name: "Teal", value: "#99f6e4" },
  { name: "Green", value: "#bbf7d0" },
] as const;

export function isValidHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}
