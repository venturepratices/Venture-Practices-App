// The only links a contact's website, email and phone may become (spec 18.4,
// Decision 18): an http or https web address, a plain `mailto:` and a `tel:`
// of the digits. Anything else gives null, and the screen shows plain text.
// Pure and client-safe: no prisma, no server-only imports.

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
/** No space, `@`, `?` or `#` in either part, so a stored value can never add mail headers. */
const PLAIN_EMAIL = /^[^\s@?#]+@[^\s@?#]+\.[^\s@?#]+$/;
const NOT_DIGIT = /[^0-9]/g;
/** Fewer digits than this is not a phone number. */
const PHONE_MIN_DIGITS = 7;

/**
 * The address as a link when it is a real web address: http or https, a host
 * with a dot in it, and no user name or password before the host (which can
 * make "https://bank.example@evil.example" look like the bank). Null otherwise.
 */
function webHref(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(url.protocol) || !url.hostname.includes(".")) return null;
  if (url.username || url.password) return null;
  return url.href;
}

/**
 * A typed website as it is stored: trimmed, `https://` added when no scheme was
 * typed ("oakcreekdental.com"), and only when it then reads as a real web
 * address. Null means the input is not one.
 */
export function normalizeWebsite(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return webHref(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
}

/** A stored website as a link, checked again on the way out; never prefixed. */
export function safeWebHref(stored: string | null): string | null {
  return stored ? webHref(stored) : null;
}

/** A `mailto:` link for a plain email address, else null. */
export function mailtoHref(email: string | null): string | null {
  return email && PLAIN_EMAIL.test(email) ? `mailto:${email}` : null;
}

/** A `tel:` link of the phone's digits (a leading `+` kept); fewer than 7 digits is null. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(NOT_DIGIT, "");
  if (digits.length < PHONE_MIN_DIGITS) return null;
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
}
