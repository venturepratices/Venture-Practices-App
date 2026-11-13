import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { SECURITY_HEADERS } from "@/lib/security-headers";

// Safe security headers on every page and route (key safety (f), audit row 11).
// Only rules that cannot break the app's own scripts, styles, sign-in or uploads:
// no framing by other sites, no MIME sniffing, no full URLs sent to other sites,
// no plugins, no <base> tricks. A full script policy needs nonces and is a later step.

const byName = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));

describe("security headers", () => {
  it("has the safe set", () => {
    expect(byName).toEqual({
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    });
  });

  it("is sent on every path", async () => {
    const rules = await (nextConfig as { headers?: () => Promise<{ source: string; headers: unknown }[]> }).headers?.();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });
});
