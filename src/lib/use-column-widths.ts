"use client";

import { useEffect, useState } from "react";

/**
 * Personal, per-browser column-width preference for a list view (drag-to-
 * resize, spreadsheet-style). Persisted to localStorage for the same reason
 * as useColumnVisibility — it's display-only and shouldn't ride along in a
 * shared link. Starts from `defaults` until localStorage is read on mount.
 */
export function useColumnWidths(storageKey: string, defaults: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(defaults);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          setWidths((prev) => ({ ...prev, ...(saved as Record<string, number>) }));
        }
      }
    } catch {
      // Malformed/unavailable storage — keep defaults.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // `commit` is false during a live drag (updates the visual immediately,
  // every pointermove) and true once on pointerup (the only time it's
  // worth paying for a localStorage write).
  function setWidth(key: string, width: number, commit: boolean) {
    setWidths((prev) => {
      const next = { ...prev, [key]: width };
      if (commit) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage unavailable/full — width just won't persist this time.
        }
      }
      return next;
    });
  }

  function resetWidths() {
    setWidths(defaults);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  return { widths, setWidth, resetWidths };
}
