"use client";

import { useEffect } from "react";

// Registers the offline-fallback service worker. Guarded to production only
// so local `next dev` behaves exactly as it always has — zero risk of a
// service worker interfering with hot reload or normal development.
// Wrapped defensively: a failure here must never break the app itself.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  }, []);

  return null;
}
