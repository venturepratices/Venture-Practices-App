import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The guest review password gate (POST /api/review/[token]/unlock). Audit M1:
// every guest route now finds its share link through the one shared lookup,
// resolveShareLinkAccess, so these tests pin down what guests see and what
// is saved, before and after that change. The database and the request
// cookies are stubs; the cookie signing and password check are the real ones.

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  jar: new Map<string, string>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { assetShareLink: { findUnique: h.findUnique, update: h.update } },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name) } : undefined),
  }),
}));

import { POST } from "@/app/api/review/[token]/unlock/route";
import { guestCookieName, signGuestCookie, verifyGuestCookie } from "@/lib/share-link";

const TOKEN = "share-token-for-tests";
const PASSWORD = "open sesame";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

type Link = {
  id: string;
  token: string;
  assetId: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  failedPasswordAttempts: number;
  lockedUntil: Date | null;
};

function link(overrides: Partial<Link> = {}): Link {
  return {
    id: "link-1",
    token: TOKEN,
    assetId: "asset-1",
    passwordHash: PASSWORD_HASH,
    expiresAt: null,
    failedPasswordAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

async function unlock(body?: unknown) {
  const request = new Request(`https://app.example.com/api/review/${TOKEN}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ token: TOKEN }) });
  const json = await response.clone().json();
  const cookie = response.cookies.get(guestCookieName(TOKEN))?.value;
  return { status: response.status, json, cookie: cookie ? verifyGuestCookie(cookie) : null, rawCookie: cookie };
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "auth-secret-for-tests-0123456789abcdef");
  h.findUnique.mockReset();
  h.update.mockReset().mockResolvedValue({});
  h.jar.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/review/[token]/unlock", () => {
  it("looks the link up by the token in the address only", async () => {
    h.findUnique.mockResolvedValue(link());
    await unlock({ password: PASSWORD });
    expect(h.findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
  });

  it("answers 404 for an unknown token and saves nothing", async () => {
    h.findUnique.mockResolvedValue(null);
    const result = await unlock({ password: PASSWORD });
    expect(result).toMatchObject({ status: 404, json: { error: "This review link is no longer valid." }, rawCookie: undefined });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("answers 410 for an expired link, even with the right password, and saves nothing", async () => {
    h.findUnique.mockResolvedValue(link({ expiresAt: new Date(Date.now() - 1000) }));
    const result = await unlock({ password: PASSWORD });
    expect(result).toMatchObject({ status: 410, json: { error: "This review link has expired." }, rawCookie: undefined });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("lets a link with no password through and sets the guest cookie", async () => {
    h.findUnique.mockResolvedValue(link({ passwordHash: null }));
    const result = await unlock();
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ ok: true });
    expect(result.cookie).toMatchObject({ shareLinkId: "link-1", passwordVerified: true, guestReviewerId: null });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("keeps who the guest already said they are when their cookie is for this link", async () => {
    h.findUnique.mockResolvedValue(link());
    h.jar.set(
      guestCookieName(TOKEN),
      signGuestCookie({ shareLinkId: "link-1", passwordVerified: false, guestReviewerId: "reviewer-7", iat: Date.now() })
    );
    const result = await unlock({ password: PASSWORD });
    expect(result.cookie).toMatchObject({ shareLinkId: "link-1", passwordVerified: true, guestReviewerId: "reviewer-7" });
  });

  it("ignores a cookie made for a different link", async () => {
    h.findUnique.mockResolvedValue(link({ passwordHash: null }));
    h.jar.set(
      guestCookieName(TOKEN),
      signGuestCookie({ shareLinkId: "other-link", passwordVerified: true, guestReviewerId: "reviewer-9", iat: Date.now() })
    );
    const result = await unlock();
    expect(result.cookie).toMatchObject({ shareLinkId: "link-1", guestReviewerId: null });
  });

  it("ignores a cookie with a forged signature", async () => {
    h.findUnique.mockResolvedValue(link({ passwordHash: null }));
    const forged = signGuestCookie({ shareLinkId: "link-1", passwordVerified: true, guestReviewerId: "reviewer-9", iat: Date.now() });
    h.jar.set(guestCookieName(TOKEN), `${forged.split(".")[0]}.not-the-signature`);
    const result = await unlock();
    expect(result.cookie).toMatchObject({ shareLinkId: "link-1", guestReviewerId: null });
  });

  it("refuses with 429 while the link is locked, without checking or counting the password", async () => {
    h.findUnique.mockResolvedValue(link({ lockedUntil: new Date(Date.now() + 5 * 60 * 1000 - 1000) }));
    const result = await unlock({ password: PASSWORD });
    expect(result).toMatchObject({ status: 429, json: { error: "Too many attempts. Try again in 5 minutes." }, rawCookie: undefined });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("answers 401 to a wrong password and counts it", async () => {
    h.findUnique.mockResolvedValue(link({ failedPasswordAttempts: 3 }));
    const result = await unlock({ password: "wrong" });
    expect(result).toMatchObject({ status: 401, json: { error: "Incorrect password." }, rawCookie: undefined });
    expect(h.update).toHaveBeenCalledWith({ where: { id: "link-1" }, data: { failedPasswordAttempts: 4 } });
  });

  it("counts a missing password as a wrong one", async () => {
    h.findUnique.mockResolvedValue(link());
    const result = await unlock({});
    expect(result).toMatchObject({ status: 401, json: { error: "Incorrect password." } });
    expect(h.update).toHaveBeenCalledWith({ where: { id: "link-1" }, data: { failedPasswordAttempts: 1 } });
  });

  it("locks the link on the tenth wrong password", async () => {
    h.findUnique.mockResolvedValue(link({ failedPasswordAttempts: 9 }));
    const result = await unlock({ password: "wrong" });
    expect(result).toMatchObject({ status: 429, json: { error: "Too many attempts. This link is temporarily locked." } });
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { failedPasswordAttempts: 0, lockedUntil: expect.any(Date) },
    });
  });

  it("lets the right password through, clears the count and sets the guest cookie", async () => {
    h.findUnique.mockResolvedValue(link({ failedPasswordAttempts: 4 }));
    const result = await unlock({ password: PASSWORD });
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ ok: true });
    expect(result.cookie).toMatchObject({ shareLinkId: "link-1", passwordVerified: true, guestReviewerId: null });
    expect(h.update).toHaveBeenCalledWith({ where: { id: "link-1" }, data: { failedPasswordAttempts: 0, lockedUntil: null } });
  });
});
