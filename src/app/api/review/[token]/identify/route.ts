import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { guestCookieName, guestCookieOptions, resolveShareLinkAccess, signGuestCookie } from "@/lib/share-link";

const identifySchema = z.object({
  name: z.string().trim().min(1, "Name required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});

/**
 * The single "who are you" step a guest completes once per share link,
 * before they can comment or decide — no password, no account. Finds or
 * creates the AssetReviewer row for this email (scoped to the ONE asset the
 * token points at) and stamps the guest cookie with it so every later action
 * is attributed without asking again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveShareLinkAccess(token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error === "expired" ? "This review link has expired." : "This review link is no longer valid." },
      { status: resolved.error === "expired" ? 410 : 404 }
    );
  }
  if (!resolved.access.passwordOk) {
    return NextResponse.json({ error: "This link is password protected." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = identifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { assetId, id: shareLinkId } = resolved.access.link;
  let reviewer = await prisma.assetReviewer.findFirst({ where: { assetId, guestEmail: parsed.data.email } });
  if (!reviewer) {
    reviewer = await prisma.assetReviewer.create({
      data: { assetId, guestEmail: parsed.data.email, guestName: parsed.data.name },
    });
  }

  const res = NextResponse.json({ ok: true, name: reviewer.guestName });
  res.cookies.set(
    guestCookieName(token),
    signGuestCookie({ shareLinkId, passwordVerified: true, guestReviewerId: reviewer.id, iat: Date.now() }),
    guestCookieOptions()
  );
  return res;
}
