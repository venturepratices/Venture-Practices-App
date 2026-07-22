import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  MAX_FAILED_PASSWORD_ATTEMPTS,
  PASSWORD_LOCKOUT_MS,
  guestCookieName,
  guestCookieOptions,
  signGuestCookie,
  verifyGuestCookie,
  verifySharePassword,
} from "@/lib/share-link";

const unlockSchema = z.object({ password: z.string().max(200).optional() });

/**
 * Clears the password gate for a share link. Every failure is recorded on
 * the AssetShareLink row itself (not in-memory — this runs on serverless, so
 * an in-memory counter would reset per invocation and be useless) and the
 * link locks for PASSWORD_LOCKOUT_MS after MAX_FAILED_PASSWORD_ATTEMPTS wrong
 * guesses, closing off brute-forcing a human-chosen password. The token
 * itself is never guessable (256-bit) — this guard is specifically for the
 * much smaller password keyspace layered on top.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const link = await prisma.assetShareLink.findUnique({ where: { token } });
  if (!link) {
    return NextResponse.json({ error: "This review link is no longer valid." }, { status: 404 });
  }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This review link has expired." }, { status: 410 });
  }

  const cookieStore = await cookies();
  const existingCookie = verifyGuestCookie(cookieStore.get(guestCookieName(token))?.value);
  const existingGuestReviewerId =
    existingCookie && existingCookie.shareLinkId === link.id ? existingCookie.guestReviewerId : null;

  if (!link.passwordHash) {
    // Nothing to unlock — just establish the session cookie.
    const res = NextResponse.json({ ok: true });
    res.cookies.set(
      guestCookieName(token),
      signGuestCookie({ shareLinkId: link.id, passwordVerified: true, guestReviewerId: existingGuestReviewerId, iat: Date.now() }),
      guestCookieOptions()
    );
    return res;
  }

  if (link.lockedUntil && link.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((link.lockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = unlockSchema.safeParse(body);
  const candidate = parsed.success ? parsed.data.password : undefined;
  const passwordMatches = candidate ? await verifySharePassword(candidate, link.passwordHash) : false;

  if (!passwordMatches) {
    const attempts = link.failedPasswordAttempts + 1;
    const lockingNow = attempts >= MAX_FAILED_PASSWORD_ATTEMPTS;
    await prisma.assetShareLink.update({
      where: { id: link.id },
      data: lockingNow
        ? { failedPasswordAttempts: 0, lockedUntil: new Date(Date.now() + PASSWORD_LOCKOUT_MS) }
        : { failedPasswordAttempts: attempts },
    });
    return NextResponse.json(
      { error: lockingNow ? "Too many attempts. This link is temporarily locked." : "Incorrect password." },
      { status: lockingNow ? 429 : 401 }
    );
  }

  await prisma.assetShareLink.update({ where: { id: link.id }, data: { failedPasswordAttempts: 0, lockedUntil: null } });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    guestCookieName(token),
    signGuestCookie({ shareLinkId: link.id, passwordVerified: true, guestReviewerId: existingGuestReviewerId, iat: Date.now() }),
    guestCookieOptions()
  );
  return res;
}
