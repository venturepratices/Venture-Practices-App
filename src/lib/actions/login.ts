"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type LoginState = { error: string | null };

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Best-effort caller IP from the request headers Vercel/most proxies set.
 * "unknown" is an acceptable fallback here — it just means every unattributed
 * request shares one lockout bucket per email, which is still strictly
 * better than no rate limiting at all.
 */
async function getRequestIp(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const ip = await getRequestIp();

  if (email) {
    const attempt = await prisma.loginAttempt.findUnique({ where: { email_ip: { email, ip } } });
    if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((attempt.lockedUntil.getTime() - Date.now()) / 60000);
      return { error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
    }
  }

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      remember: formData.get("remember") === "on" ? "true" : "false",
      redirectTo: "/dashboard",
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        if (email) await recordFailedLogin(email, ip);
        return { error: "That email or password isn't right. Try again." };
      }
      return { error: "Something went wrong signing you in. Please try again." };
    }
    // NextAuth signals a successful sign-in redirect by throwing — clear any
    // lockout tracking for this email+ip before letting it propagate.
    if (email) await prisma.loginAttempt.deleteMany({ where: { email, ip } }).catch(() => {});
    throw error;
  }
}

async function recordFailedLogin(email: string, ip: string) {
  const existing = await prisma.loginAttempt.findUnique({ where: { email_ip: { email, ip } } });
  const attempts = (existing?.attempts ?? 0) + 1;
  const lockingNow = attempts >= MAX_LOGIN_ATTEMPTS;

  await prisma.loginAttempt.upsert({
    where: { email_ip: { email, ip } },
    create: {
      email,
      ip,
      attempts: lockingNow ? 0 : attempts,
      lockedUntil: lockingNow ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : null,
    },
    update: {
      attempts: lockingNow ? 0 : attempts,
      lockedUntil: lockingNow ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : null,
    },
  });
}
