// Stored keys for spotting the same person or practice typed two ways
// (Decision 17). Pure and client-safe: no prisma, no server-only imports.
// The Plan 3A migration backfills existing rows with the same rules in SQL
// (prisma/migrations/20261107000001_sales_leads_contacts), so a change here
// needs the same change there.

/** Only ASCII whitespace is trimmed, the same set the SQL backfill trims. */
const EDGE_SPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
const NOT_DIGIT = /[^0-9]/g;
const NOT_LETTER_OR_DIGIT = /[^a-z0-9]/g;
/** Fewer digits than this is not a phone number (no key). */
const PHONE_MIN_DIGITS = 7;
/** A US number without its country code. */
const PHONE_KEY_DIGITS = 10;

/** The email trimmed and in lower case; blank is null. */
export function emailKey(email: string | null | undefined): string | null {
  const key = (email ?? "").replace(EDGE_SPACE, "").toLowerCase();
  return key || null;
}

/**
 * US phone digits: a leading 1 is dropped from 11 or more digits, then the
 * first 10 are kept, so an extension never changes the key. Under 7 digits is null.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(NOT_DIGIT, "");
  if (digits.length < PHONE_MIN_DIGITS) return null;
  const national = digits.length >= PHONE_KEY_DIGITS + 1 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.slice(0, PHONE_KEY_DIGITS);
}

/** Lower-case letters and digits only, so "Oak-Creek Dental." matches "Oak Creek Dental"; none is null. */
export function nameKey(name: string): string | null {
  const key = name.toLowerCase().replace(NOT_LETTER_OR_DIGIT, "");
  return key || null;
}

export function personKeys(p: { name: string; email: string | null; phone: string | null }): {
  nameKey: string | null;
  emailKey: string | null;
  phoneKey: string | null;
} {
  return { nameKey: nameKey(p.name), emailKey: emailKey(p.email), phoneKey: phoneKey(p.phone) };
}

export function organizationKeys(o: { name: string }): { nameKey: string | null } {
  return { nameKey: nameKey(o.name) };
}
