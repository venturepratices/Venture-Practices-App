// Cheap checks that run before a bot key touches the database: the pause
// switch for every key, and a slow-down for an address that keeps sending bad
// keys. The slow-down lives in this server's memory only, so each server copy
// counts on its own; it is a first line, with the hosting firewall as the next.

/** Bot keys work only while SALES_BOTS_ENABLED is exactly "true". Anything else pauses every key. */
export function botsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SALES_BOTS_ENABLED === "true";
}

/** Bad keys one address may send in one window before it must wait. */
export const BAD_KEY_LIMIT = 20;
const WINDOW_MS = 10 * 60_000;
const MAX_TRACKED = 5000;

type Strike = { count: number; windowStart: number };
const strikes = new Map<string, Strike>();

const keyFor = (ip: string | null | undefined) => ip?.trim() || "unknown";

/** True while this address has sent too many bad keys in the current window. */
export function isAddressSlowed(ip: string | null | undefined, now: Date): boolean {
  const strike = strikes.get(keyFor(ip));
  if (!strike) return false;
  if (now.getTime() - strike.windowStart >= WINDOW_MS) {
    strikes.delete(keyFor(ip));
    return false;
  }
  return strike.count >= BAD_KEY_LIMIT;
}

/** Counts one bad key from this address. */
export function recordBadKey(ip: string | null | undefined, now: Date): void {
  const key = keyFor(ip);
  const strike = strikes.get(key);
  if (!strike || now.getTime() - strike.windowStart >= WINDOW_MS) {
    // Keep memory bounded: forget the oldest address when the list is full.
    if (!strike && strikes.size >= MAX_TRACKED) strikes.delete(strikes.keys().next().value as string);
    strikes.set(key, { count: 1, windowStart: now.getTime() });
    return;
  }
  strike.count += 1;
}

/** Tests only: forget every address. */
export function resetBadKeyThrottle(): void {
  strikes.clear();
}
