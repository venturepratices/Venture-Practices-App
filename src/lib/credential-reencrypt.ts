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

/**
 * The real deps, from the keys in the environment now. Throws at once if
 * either key is missing or malformed.
 *
 * A labelled value is current when it names the current key. An unlabelled
 * value is never current during a key change (it may be on the old key, and
 * re-encrypting labels it). With no old key set, the app itself saves the
 * unlabelled format, so a readable unlabelled value is already where it
 * belongs; re-encrypting it would only give another unlabelled value, and the
 * count to re-encrypt would never reach 0. One it cannot read is reported as
 * unreadable.
 */
export function currentKeyDeps(): ReencryptDeps {
  const readIds = readKeyIds();
  const [currentId] = readIds;
  const keyChange = readIds.length > 1;
  return {
    isCurrent: (stored) => {
      try {
        const keyId = storedKeyId(stored);
        if (keyId !== null) return keyId === currentId;
        if (keyChange) return false;
        decryptSecret(stored);
        return true;
      } catch {
        return false;
      }
    },
    reencrypt: (stored) => encryptSecret(decryptSecret(stored)),
  };
}

type Env = Record<string, string | undefined>;

const KEY_NAMES = ["CREDENTIALS_ENCRYPTION_KEY", "CREDENTIALS_ENCRYPTION_KEY_OLD"] as const;

/** A blank value counts as not set, as it does in credential-crypto. */
function setValue(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

/**
 * Both keys must be typed into the terminal for this command. A laptop .env
 * may hold a different key from production's, and a key quietly taken from it
 * could let --apply move every stored value onto a key production does not
 * have. `terminal` is the environment as the terminal set it, before .env was
 * loaded; `loaded` is the environment now. Throws, naming the setting but
 * never its value, if the current key is not set in the terminal or if either
 * key in use differs from what the terminal set.
 */
export function requireKeysFromTerminal(terminal: Env, loaded: Env): void {
  const [current] = KEY_NAMES;
  if (!setValue(terminal[current])) {
    throw new Error(
      `${current} must be set in this terminal for this command. It is never taken from .env, which may hold a different key from the one the app uses. Nothing was read or written.`,
    );
  }
  for (const name of KEY_NAMES) {
    if (setValue(terminal[name]) !== setValue(loaded[name])) {
      const hint = name === current ? "" : ", or set it to nothing there to run without an old key";
      throw new Error(`${name} came from .env, not from this terminal. Set it in this terminal${hint}. Nothing was read or written.`);
    }
  }
}

/**
 * With an old key set, a wrong current key in the terminal still reads every
 * value through the old key, so the counts look right and --apply would move
 * everything onto a key the app does not have. Counting values "already on
 * the current key" is not proof either: with the two keys swapped, values
 * saved with the old key count as current. The app always saves with its own
 * current key, and labels the value with it while both keys are set in Vercel,
 * so the most recently saved vault password, re-saved in the app after the
 * redeploy, must be labelled with this terminal's current key. Throws if not.
 * Not needed with no old key set: then nothing is written at all.
 */
export function confirmAppUsesCurrentKey(newestVaultPassword: string | null, deps: Pick<ReencryptDeps, "isCurrent">): void {
  if (!setValue(process.env.CREDENTIALS_ENCRYPTION_KEY_OLD)) return;
  if (newestVaultPassword !== null && deps.isCurrent(newestVaultPassword)) return;
  throw new Error(
    "Stopped, nothing was written. The most recently saved vault password is not on the CREDENTIALS_ENCRYPTION_KEY set in this terminal, so this terminal's key cannot be confirmed as the one the app now saves with. Either no vault password has been saved since the new key went live, CREDENTIALS_ENCRYPTION_KEY_OLD is not set in Vercel as well (the app marks what it saves with its key only while both are set there), or the keys in this terminal are not the ones in Vercel. In the app, edit any vault password, type the same password back in and save, then run this again. If it stops again, check both keys in this terminal against Vercel.",
  );
}

export function parseReencryptArgs(args: string[]): { apply: boolean } {
  let apply = false;
  for (const arg of args) {
    if (arg === "--apply") apply = true;
    else throw new Error(`Unknown option "${arg}". The only option is --apply (without it, nothing is written).`);
  }
  return { apply };
}
