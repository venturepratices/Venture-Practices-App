"use client";

import { useLayoutEffect, useRef, useState } from "react";

// True while the ref'd element's own text is visually clipped by a
// `truncate`-style ellipsis — re-checked via ResizeObserver, so dragging a
// column narrower (or a window resize) turns the tooltip on/off live rather
// than freezing whatever was true on first render.
export function useIsTruncated<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // A ResizeObserver callback can land mid-transition (e.g. a Fast
      // Refresh remount or a viewport resize) with the element briefly
      // unlaid-out at 0 width — that's not "not truncated", it's "don't
      // know yet", so skip it rather than let it clobber a correct reading.
      if (el.clientWidth === 0) return;
      setTruncated(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, truncated };
}
