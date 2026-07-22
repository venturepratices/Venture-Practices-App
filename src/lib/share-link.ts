import crypto from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

/**
 * Security primitives for tokenized asset share links (Slice 4a). Two
 * distinct secrets are in play, deliberately kept apart:
 *  - the TOKEN itself (256-bit random, unique per link) — the bearer
 *    credential that grants access to exactly one asset. Its keyspace is far
 *    too large to brute-force, so guessing it is not a realistic threat.
 *  - an optional, agency-chosen PASSWORD on top of the token, for links the
 *    agency wants to gate further (e.g. before sharing outside a client's own
 *    inbox). Passwords are human-chosen and much easier to guess than the
 *    token, so those get bcrypt hashing (never stored/logged in plaintext)
 *    plus a DB-backed lockout after repeated failures — see
 *    MAX_FAILED_PASSWORD_ATTEMPTS below.
 *
 * A signed, tamper-evident cookie carries the guest's session state (password
 * verified? identified as which reviewer?) across requests, scoped to one
 * specific share link — see signGuestCookie/verifyGuestCookie.
 */

const COOKIE_DOMAIN_TAG = "asset-review-guest-cookie-v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const GUEST_COOKIE_MAX_AGE_SECONDS = MAX_AGE_MS / 1000;

export const MAX_FAILED_PASSWORD_ATTEMPTS = 10;
export const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export type GuestCookiePayload = {
  /** Which AssetShareLink this session belongs to — never trusted across a different token. */
  shareLinkId: string;
  passwordVerified: boolean;
  guestReviewerId: string | null;
  iat: number;
};

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set — required to sign guest review sessions.");
  return s;
}

/** 256 bits of randomness, URL-safe. This is the bearer credential — treat it like a password. */
export function generateShareToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Deterministic per-token cookie name (derived, not stored) — so a request
 * for /review/[token] knows exactly which cookie to read without a lookup
 * table, and a cookie minted for one token can never be mistaken for another.
 */
export function guestCookieName(token: string): string {
  const hash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
  return `rv_${hash}`;
}

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", secret()).update(`${COOKIE_DOMAIN_TAG}:${payloadB64}`).digest("base64url");
}

export function signGuestCookie(payload: GuestCookiePayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verifies signature + freshness. Returns null on any tamper, malformed, or stale cookie — never throws. */
export function verifyGuestCookie(raw: string | undefined | null): GuestCookiePayload | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  let expectedSig: string;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as GuestCookiePayload;
    if (typeof payload.shareLinkId !== "string" || typeof payload.iat !== "number") return null;
    if (Date.now() - payload.iat > MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashSharePassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifySharePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Cookie attributes shared by every route that sets the guest session
 * cookie. `path: "/"` is required, not just permissive — the page lives at
 * `/review/[token]` but the routes that need to read this cookie live at
 * `/api/review/[token]/...`, a sibling path, not a subpath. A cookie scoped
 * to `/review` would never be sent to `/api/review/*` per the browser's
 * normal path-matching rules. Root scope is safe here regardless: the cookie
 * name itself is a per-token hash (see guestCookieName) and its payload is
 * HMAC-signed, so nothing is gained by narrowing the path.
 */
export function guestCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
  };
}

export type ShareLinkAccess = {
  link: {
    id: string;
    assetId: string;
    passwordHash: string | null;
    expiresAt: Date | null;
    failedPasswordAttempts: number;
    lockedUntil: Date | null;
  };
  cookiePayload: GuestCookiePayload | null;
  /** True once the visitor has cleared the password gate (or there is none). */
  passwordOk: boolean;
};

export type ShareLinkAccessError = "not_found" | "expired";

/**
 * The single choke point every guest route goes through. Derives the asset
 * PURELY from the token — nothing here or in any caller ever accepts an
 * assetId/clientId from the request itself, so there is no parameter a guest
 * could tamper with to reach a different asset. Also re-validates the guest
 * cookie's embedded shareLinkId against the token's own row on every call
 * (defense in depth on top of the per-token cookie name).
 */
export async function resolveShareLinkAccess(
  token: string
): Promise<{ ok: true; access: ShareLinkAccess } | { ok: false; error: ShareLinkAccessError }> {
  const link = await prisma.assetShareLink.findUnique({ where: { token } });
  if (!link) return { ok: false, error: "not_found" };
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return { ok: false, error: "expired" };

  const cookieStore = await cookies();
  const raw = cookieStore.get(guestCookieName(token))?.value;
  let cookiePayload = verifyGuestCookie(raw);
  if (cookiePayload && cookiePayload.shareLinkId !== link.id) cookiePayload = null;

  const passwordOk = !link.passwordHash || cookiePayload?.passwordVerified === true;

  return {
    ok: true,
    access: {
      link: {
        id: link.id,
        assetId: link.assetId,
        passwordHash: link.passwordHash,
        expiresAt: link.expiresAt,
        failedPasswordAttempts: link.failedPasswordAttempts,
        lockedUntil: link.lockedUntil,
      },
      cookiePayload,
      passwordOk,
    },
  };
}
