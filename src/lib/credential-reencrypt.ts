import { decryptSecret, encryptSecret, readKeyIds, storedKeyId } from "@/lib/credential-crypto";

/**
 * Pure planning helpers for scripts/reencrypt-credentials.ts, kept here so
 * they can be unit-tested without a database. The script loads every stored
 * encrypted value, asks planReencryption what to change, prints describePlan
 * (counts only, never a value) and, with --apply, writes plan.updates.
 */

export type EncryptedRow<F extends string> = { id: string; values: Record<F, string> };

export type ReencryptDeps = {
  /** True when the stored value is already written with the current key. */
  isCurrent: (stored: string) => boolean;
  /** Decrypts with any configured key and encrypts again with the current one. Throws if unreadable. */
  reencrypt: (stored: string) => string;
};

export type ReencryptPlan<F extends string> = {
  table: string;
  values: number;
  alreadyCurrent: number;
  toReencrypt: number;
  unreadable: { id: string; field: F }[];
  /** `from` is the value that was read, so the write can skip a row changed since. */
  updates: { id: string; from: Partial<Record<F, string>>; to: Partial<Record<F, string>> }[];
};

export function planReencryption<F extends string>(
  table: string,
  rows: EncryptedRow<F>[],
  deps: ReencryptDeps,
): ReencryptPlan<F> {
  const plan: ReencryptPlan<F> = { table, values: 0, alreadyCurrent: 0, toReencrypt: 0, unreadable: [], updates: [] };
  for (const row of rows) {
    const from: Partial<Record<F, string>> = {};
    const to: Partial<Record<F, string>> = {};
    for (const field of Object.keys(row.values) as F[]) {
      const stored = row.values[field];
      plan.values += 1;
      if (deps.isCurrent(stored)) {
        plan.alreadyCurrent += 1;
        continue;
      }
      try {
        to[field] = deps.reencrypt(stored);
        from[field] = stored;
        plan.toReencrypt += 1;
      } catch {
        plan.unreadable.push({ id: row.id, field });
      }
    }
    if (Object.keys(to).length > 0) plan.updates.push({ id: row.id, from, to });
  }
  return plan;
}

/** One line of counts for the console. Never includes a stored value. */
export function describePlan<F extends string>(plan: ReencryptPlan<F>): string {
  return `${plan.table}: ${plan.values} stored values, ${plan.alreadyCurrent} already on the current key, ${plan.toReencrypt} to re-encrypt, ${plan.unreadable.length} cannot be read.`;
}

/** The real deps, from the keys in the environment now. Throws at once if either key is missing or malformed. */
export function currentKeyDeps(): ReencryptDeps {
  const [currentId] = readKeyIds();
  return {
    isCurrent: (stored) => {
      try {
        return storedKeyId(stored) === currentId;
      } catch {
        return false;
      }
    },
    reencrypt: (stored) => encryptSecret(decryptSecret(stored)),
  };
}

export function parseReencryptArgs(args: string[]): { apply: boolean } {
  let apply = false;
  for (const arg of args) {
    if (arg === "--apply") apply = true;
    else throw new Error(`Unknown option "${arg}". The only option is --apply (without it, nothing is written).`);
  }
  return { apply };
}
