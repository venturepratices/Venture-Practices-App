"use client";

import { useEffect, useState } from "react";

/**
 * Personal, per-browser column-visibility preference for a list view.
 * Persisted to localStorage (not the URL/DB) since it's display-only and
 * shouldn't affect what gets shared via a link. Falls back to "everything
 * visible" until localStorage is read on mount, so SSR/CSR markup matches.
 */
export function useColumnVisibility(storageKey: string, allKeys: string[]) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(allKeys));

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (Array.isArray(saved)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage (an external system) on mount, not a prop-sync
          setVisible(new Set(saved.filter((key): key is string => typeof key === "string" && allKeys.includes(key))));
        }
      }
    } catch {
      // Malformed/unavailable storage — keep the "everything visible" default.
    }
    // `allKeys` deliberately excluded: callers typically pass a fresh array
    // literal each render, and this hydration should only run once per
    // storageKey (mount), not re-run and clobber an in-progress toggle every
    // time the caller re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function toggle(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Storage unavailable/full — preference just won't persist this time.
      }
      return next;
    });
  }

  return { visible, toggle };
}
