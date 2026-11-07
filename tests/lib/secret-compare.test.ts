import { describe, expect, it } from "vitest";

import { checkBearer, safeEqualSecret } from "@/lib/secret-compare";

// Audit row 41 (old #15): the cron, agent API and MCP doors compared their
// secret with ===. One shared helper now compares in constant time (both
// sides hashed, then crypto.timingSafeEqual) and refuses everything when the
// configured secret is missing or blank, so an unset env var can never be
// matched by a caller sending "Bearer undefined" or an empty value.

const SECRET = "s3cr3t-value-that-is-long-enough-1234567890";

function requestWith(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://app.example.com/api/cron/backup", { headers });
}

describe("safeEqualSecret", () => {
  it("accepts the exact configured secret", () => {
    expect(safeEqualSecret(SECRET, SECRET)).toBe(true);
  });

  it("refuses a different value of the same length", () => {
    const sameLength = `${SECRET.slice(0, -1)}X`;
    expect(sameLength).toHaveLength(SECRET.length);
    expect(safeEqualSecret(sameLength, SECRET)).toBe(false);
  });

  it("refuses shorter and longer values without throwing", () => {
    expect(safeEqualSecret(SECRET.slice(0, 5), SECRET)).toBe(false);
    expect(safeEqualSecret(`${SECRET}extra`, SECRET)).toBe(false);
    expect(safeEqualSecret("", SECRET)).toBe(false);
  });

  it("refuses a missing presented value", () => {
    expect(safeEqualSecret(null, SECRET)).toBe(false);
    expect(safeEqualSecret(undefined, SECRET)).toBe(false);
  });

  it("fails closed when the configured secret is missing, even if the caller sends the same nothing", () => {
    expect(safeEqualSecret(undefined, undefined)).toBe(false);
    expect(safeEqualSecret(null, null)).toBe(false);
    expect(safeEqualSecret("undefined", undefined)).toBe(false);
    expect(safeEqualSecret("null", null)).toBe(false);
  });

  it("fails closed when the configured secret is empty or only spaces", () => {
    expect(safeEqualSecret("", "")).toBe(false);
    expect(safeEqualSecret("   ", "   ")).toBe(false);
    expect(safeEqualSecret("\n", "\n")).toBe(false);
  });

  it("compares non-ASCII secrets exactly", () => {
    expect(safeEqualSecret("pässwörd-ключ", "pässwörd-ключ")).toBe(true);
    expect(safeEqualSecret("passwörd-ключ", "pässwörd-ключ")).toBe(false);
  });

  it("does not refuse a configured secret just because it is short", () => {
    // Production values cannot be seen from here; refusing short ones could
    // silently stop every scheduled job. Length is a settings task instead.
    expect(safeEqualSecret("abc", "abc")).toBe(true);
  });
});

describe("checkBearer", () => {
  it("accepts `Bearer <secret>` exactly as the routes always have", () => {
    expect(checkBearer(requestWith(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });

  it("refuses a request with no authorization header", () => {
    expect(checkBearer(requestWith(), SECRET)).toBe(false);
  });

  it("refuses a wrong secret", () => {
    expect(checkBearer(requestWith("Bearer not-the-secret"), SECRET)).toBe(false);
    expect(checkBearer(requestWith(`Bearer ${SECRET}x`), SECRET)).toBe(false);
  });

  it("keeps the header format strict: scheme, case and spacing must match", () => {
    expect(checkBearer(requestWith(SECRET), SECRET)).toBe(false);
    expect(checkBearer(requestWith(`bearer ${SECRET}`), SECRET)).toBe(false);
    expect(checkBearer(requestWith(`Basic ${SECRET}`), SECRET)).toBe(false);
    expect(checkBearer(requestWith(`Bearer  ${SECRET}`), SECRET)).toBe(false);
  });

  it("fails closed when the configured secret is not set", () => {
    expect(checkBearer(requestWith("Bearer undefined"), undefined)).toBe(false);
    expect(checkBearer(requestWith("Bearer null"), null)).toBe(false);
    expect(checkBearer(requestWith("Bearer "), undefined)).toBe(false);
    expect(checkBearer(requestWith("Bearer"), undefined)).toBe(false);
    expect(checkBearer(requestWith(), undefined)).toBe(false);
  });

  it("fails closed when the configured secret is empty or only spaces", () => {
    expect(checkBearer(requestWith("Bearer "), "")).toBe(false);
    expect(checkBearer(requestWith("Bearer"), "")).toBe(false);
    expect(checkBearer(requestWith("Bearer"), "   ")).toBe(false);
    expect(checkBearer(requestWith(), "")).toBe(false);
  });
});
