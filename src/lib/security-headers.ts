// Security headers for every page and route (set in next.config.ts). Only rules
// that cannot break the app's own scripts, styles, sign-in or uploads. A full
// Content-Security-Policy for scripts needs per-request nonces and is a later step.

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // Other sites may not show the app inside a frame (stops click-jacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Browsers must trust the declared file type, never guess one.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites see only the app's address, never the full page path.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app never needs these device features.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];
