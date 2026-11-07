import { CredentialsSignin } from "next-auth";

import { prisma } from "@/lib/prisma";

// Login brute-force lockout, enforced inside the Credentials provider's
// authorize() (src/lib/auth.ts) so it also covers a POST straight to
// /api/auth/callback/credentials, not just the login form.
//
// LoginAttempt rows kept per email:
//   - (email, caller's IP): the original per-IP count.
//   - (email, ANY_IP): every IP together, so spreading guesses over many
//     IPs doesn't dodge the limit.
//   - (email, trustedIpKey(IP)): when that IP last signed in to the account.
// Either count reaching MAX_LOGIN_ATTEMPTS failures locks that email (or
// email + IP) for LOGIN_LOCKOUT_MS. A successful login clears both counts.
//
// The email-wide count has a cost: anyone who knows an email can keep it
// locked indefinitely, not just for 15 minutes, by failing 5 times again
// every 15 minutes (about 20 requests an hour, no login needed). So an IP
// that signed in to the account in
// the last TRUSTED_IP_MS is held to its own per-IP count only, and the owner
// can still get in from a device or network they used before. A new device
// or network is still refused while the email-wide lock lasts. Vercel
// overwrites x-forwarded-for, so a caller can't claim the owner's IP.

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
export const TRUSTED_IP_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, longer than the 30-day "remember me"

/** The LoginAttempt `ip` value for the row that counts every IP together. */
export const ANY_IP = "*";

/** requestIp() when the request names no IP. Never trusted: all such requests share it. */
const UNKNOWN_IP = "unknown";

/** The LoginAttempt `ip` value whose updatedAt is the last successful sign-in from `ip`. */
function trustedIpKey(ip: string): string {
  return `ok:${ip}`;
}

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
  return headers.get("x-real-ip") ?? UNKNOWN_IP;
}

function buckets(ip: string) {
  return [ip, ANY_IP];
}

function isTrustedIp(rows: { ip: string; updatedAt: Date }[], ip: string, now: number): boolean {
  if (ip === UNKNOWN_IP) return false;
  const lastSignIn = rows.find((row) => row.ip === trustedIpKey(ip));
  return !!lastSignIn && lastSignIn.updatedAt.getTime() > now - TRUSTED_IP_MS;
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

  const existing = await prisma.loginAttempt.findMany({
    where: { email, ip: { in: [...buckets(ip), trustedIpKey(ip)] } },
  });
  // An IP that signed in to this account recently neither checks nor feeds
  // the email-wide count (see the top of this file).
  const applies = isTrustedIp(existing, ip, now) ? [ip] : buckets(ip);

  // Tries made while locked are refused without being counted, so a lock
  // always ends after LOGIN_LOCKOUT_MS, as before.
  const lockedUntil = activeLock(existing.filter((row) => applies.includes(row.ip)), now);
  if (lockedUntil) return lockedUntil;

  const counted = [];
  for (const bucket of applies) {
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

/**
 * Call after a correct password: starts both counts afresh, as before, and
 * notes that this IP signed in now, so it gets past an email-wide lock for
 * the next TRUSTED_IP_MS.
 */
export async function recordSuccessfulLogin(email: string, ip: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email, ip: { in: buckets(ip) } } });
  if (ip === UNKNOWN_IP) return;
  await prisma.loginAttempt.upsert({
    where: { email_ip: { email, ip: trustedIpKey(ip) } },
    create: { email, ip: trustedIpKey(ip) },
    update: { updatedAt: new Date() },
  });
}

/** The login form's message while locked out. */
export function lockedOutMessage(lockedUntil: Date): string {
  const minutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
