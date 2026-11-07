import { CredentialsSignin } from "next-auth";

import { prisma } from "@/lib/prisma";

// Login brute-force lockout, enforced inside the Credentials provider's
// authorize() (src/lib/auth.ts) so it also covers a POST straight to
// /api/auth/callback/credentials, not just the login form.
//
// Two LoginAttempt rows are kept per email:
//   - (email, caller's IP): the original per-IP count.
//   - (email, ANY_IP): every IP together, so spreading guesses over many
//     IPs doesn't dodge the limit. The cost is that anyone can lock a known
//     email out for LOGIN_LOCKOUT_MS by failing on purpose.
// Either row reaching MAX_LOGIN_ATTEMPTS failures locks that email (or
// email + IP) for LOGIN_LOCKOUT_MS. A successful login clears both rows.

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/** The LoginAttempt `ip` value for the row that counts every IP together. */
export const ANY_IP = "*";

/**
 * Thrown from authorize() while an email (or email + IP) is locked out.
 * Auth.js puts `code` in the redirect URL of a direct POST, so it says only
 * "locked". The login form reads `lockedUntil` to say how long to wait.
 */
export class LoginLockedError extends CredentialsSignin {
  code = "locked";
  lockedUntil: Date;

  constructor(lockedUntil: Date) {
    super();
    this.lockedUntil = lockedUntil;
  }
}

/** The key attempts are counted under: case and surrounding spaces don't matter. */
export function lockoutEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Best-effort caller IP from the request headers Vercel/most proxies set.
 * "unknown" is an acceptable fallback here: it just means every unattributed
 * request shares one per-IP bucket per email, and the ANY_IP row still
 * counts them all.
 */
export function requestIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

function buckets(ip: string) {
  return [ip, ANY_IP];
}

function activeLock(rows: { lockedUntil: Date | null }[], now: number): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (row.lockedUntil && row.lockedUntil.getTime() > now && (!latest || row.lockedUntil > latest)) {
      latest = row.lockedUntil;
    }
  }
  return latest;
}

/** Locks every bucket for this email + IP that has used up its tries. */
async function lockSpentBuckets(email: string, ip: string): Promise<Date> {
  const lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MS);
  await prisma.loginAttempt.updateMany({
    where: { email, ip: { in: buckets(ip) }, attempts: { gte: MAX_LOGIN_ATTEMPTS } },
    data: { attempts: 0, lockedUntil },
  });
  return lockedUntil;
}

/**
 * Call before checking the password. Returns when the lock ends if this try
 * must be refused, or null if it may go ahead.
 *
 * The try is counted up front (an atomic increment), not after the password
 * check: otherwise a burst of simultaneous guesses would all pass the check
 * before any of them was counted. So at most MAX_LOGIN_ATTEMPTS tries per
 * bucket ever reach bcrypt between locks.
 */
export async function claimLoginAttempt(email: string, ip: string): Promise<Date | null> {
  const now = Date.now();

  // Tries made while locked are refused without being counted, so a lock
  // always ends after LOGIN_LOCKOUT_MS, as before.
  const existing = await prisma.loginAttempt.findMany({ where: { email, ip: { in: buckets(ip) } } });
  const lockedUntil = activeLock(existing, now);
  if (lockedUntil) return lockedUntil;

  const counted = [];
  for (const bucket of buckets(ip)) {
    counted.push(
      await prisma.loginAttempt.upsert({
        where: { email_ip: { email, ip: bucket } },
        create: { email, ip: bucket, attempts: 1 },
        update: { attempts: { increment: 1 } },
      }),
    );
  }

  // A simultaneous try may have set a lock since the read above.
  const raced = activeLock(counted, now);
  if (raced) return raced;

  // Over the limit without a lock means earlier simultaneous tries already
  // used up this window (or one of them never finished): lock now.
  if (counted.some((row) => row.attempts > MAX_LOGIN_ATTEMPTS)) {
    return lockSpentBuckets(email, ip);
  }
  return null;
}

/** Call after a wrong password: locks any bucket that has now used its tries. */
export async function recordFailedLogin(email: string, ip: string): Promise<void> {
  await lockSpentBuckets(email, ip);
}

/** Call after a correct password: starts both counts afresh, as before. */
export async function clearFailedLogins(email: string, ip: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email, ip: { in: buckets(ip) } } });
}

/** The login form's message while locked out. */
export function lockedOutMessage(lockedUntil: Date): string {
  const minutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
