/**
 * True when a failed Prisma query reports this error code, e.g. "P2002" (unique
 * key taken), "P2003" (foreign key broken) or "P2025" (row to change not found).
 * Checks the `code` field rather than the error class, so test fakes can throw
 * a plain error with a code.
 */
export function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
