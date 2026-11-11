// Must stay the first import: it copies the environment as the terminal set it
// before .env is loaded, and loads .env before src/lib/prisma reads DATABASE_URL.
import { terminalEnv } from "./reencrypt-credentials-env";

import { readKeyIds } from "../src/lib/credential-crypto";
import {
  type EncryptedRow,
  type ReencryptDeps,
  confirmAppUsesCurrentKey,
  currentKeyDeps,
  describePlan,
  parseReencryptArgs,
  planReencryption,
  requireKeysFromTerminal,
} from "../src/lib/credential-reencrypt";
import { prisma } from "../src/lib/prisma";

/**
 * Re-encrypts every stored secret (client vault passwords, HighLevel tokens,
 * Google Calendar tokens) with the current CREDENTIALS_ENCRYPTION_KEY, so the
 * previous key, set as CREDENTIALS_ENCRYPTION_KEY_OLD during a rotation, can
 * then be removed. Everything it writes is in the labelled format, which names
 * the key. The rotation steps are in .env.example, next to
 * CREDENTIALS_ENCRYPTION_KEY_OLD. With no old key set there is nothing to move
 * (the app then saves the unlabelled format itself), so it only counts what the
 * current key can and cannot read, and writes nothing.
 *
 * Dry run by default: prints counts only and writes nothing. It never prints a
 * secret or a stored value. Safe to re-run: values already on the current key
 * are skipped, and a row whose value changed after it was read is left alone
 * (the next run picks it up).
 *
 * Set DATABASE_URL and both keys in the terminal for this one command. The
 * keys are never taken from .env (a laptop .env may hold a different key from
 * production's): the script stops if CREDENTIALS_ENCRYPTION_KEY is not set in
 * the terminal, or if either key would come from .env.
 *
 * With CREDENTIALS_ENCRYPTION_KEY_OLD set, it also stops, before reading any
 * table, unless the most recently saved vault password is on the terminal's
 * CREDENTIALS_ENCRYPTION_KEY. That proves the terminal holds the key the app
 * now saves with, so after the redeploy with the new key, edit one vault
 * password in the app (type the same password back in) before running this.
 * After --apply, reveal one older vault password in the app to check the app
 * can read it before removing CREDENTIALS_ENCRYPTION_KEY_OLD.
 *
 * Usage (from the project root):
 *   npx tsx scripts/reencrypt-credentials.ts           dry run, counts only
 *   npx tsx scripts/reencrypt-credentials.ts --apply   write the changes
 */

type Fields<F extends string> = Partial<Record<F, string>>;

type Table<F extends string> = {
  table: string;
  load: () => Promise<EncryptedRow<F>[]>;
  /** Writes `to` only if the row still holds `from`. Returns how many rows changed (0 or 1). */
  write: (id: string, from: Fields<F>, to: Fields<F>) => Promise<number>;
};

const clientCredentials: Table<"encryptedPassword"> = {
  table: "ClientCredential",
  load: async () =>
    (await prisma.clientCredential.findMany({ select: { id: true, encryptedPassword: true } })).map(
      ({ id, ...values }) => ({ id, values }),
    ),
  write: async (id, from, to) => (await prisma.clientCredential.updateMany({ where: { id, ...from }, data: to })).count,
};

const highLevelConnections: Table<"encryptedToken"> = {
  table: "ClientHighLevelConnection",
  load: async () =>
    (await prisma.clientHighLevelConnection.findMany({ select: { id: true, encryptedToken: true } })).map(
      ({ id, ...values }) => ({ id, values }),
    ),
  write: async (id, from, to) =>
    (await prisma.clientHighLevelConnection.updateMany({ where: { id, ...from }, data: to })).count,
};

const calendarConnections: Table<"encryptedAccessToken" | "encryptedRefreshToken"> = {
  table: "TeamMemberCalendarConnection",
  load: async () =>
    (
      await prisma.teamMemberCalendarConnection.findMany({
        select: { id: true, encryptedAccessToken: true, encryptedRefreshToken: true },
      })
    ).map(({ id, ...values }) => ({ id, values })),
  write: async (id, from, to) =>
    (await prisma.teamMemberCalendarConnection.updateMany({ where: { id, ...from }, data: to })).count,
};

type Outcome = { unreadable: number; written: number; changedMeanwhile: number; failed: number };

async function runTable<F extends string>(table: Table<F>, deps: ReencryptDeps, apply: boolean): Promise<Outcome> {
  const plan = planReencryption(table.table, await table.load(), deps);
  console.log(describePlan(plan));
  for (const { id, field } of plan.unreadable) {
    console.log(`  cannot be read, left as it is: ${table.table} ${id} ${field}`);
  }

  const outcome: Outcome = { unreadable: plan.unreadable.length, written: 0, changedMeanwhile: 0, failed: 0 };
  if (!apply) return outcome;

  for (const update of plan.updates) {
    if (Object.keys(update.from).length === 0) continue;
    try {
      const count = await table.write(update.id, update.from, update.to);
      if (count === 1) outcome.written += 1;
      else outcome.changedMeanwhile += 1;
    } catch (error) {
      // Only the row id and the error code: a database error can echo the values it was given.
      const code = (error as { code?: unknown })?.code;
      console.error(`  could not write ${table.table} ${update.id} (${typeof code === "string" ? code : "database error"})`);
      outcome.failed += 1;
    }
  }
  console.log(
    `  ${table.table}: ${outcome.written} rows re-encrypted, ${outcome.changedMeanwhile} changed while this ran (run again), ${outcome.failed} failed.`,
  );
  return outcome;
}

async function main() {
  const { apply } = parseReencryptArgs(process.argv.slice(2));
  requireKeysFromTerminal(terminalEnv, process.env);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set. Point it at the database whose keys are being rotated.");

  // Both checks throw a clear message, before anything is read, if a key is missing or malformed.
  const deps = currentKeyDeps();
  const [currentId, oldId] = readKeyIds();

  console.log(`Database host: ${new URL(databaseUrl).host}`);
  console.log(`Current key id: ${currentId}. Old key id: ${oldId ?? "none set"}.`);
  console.log(apply ? "Mode: --apply, writing changes." : "Mode: dry run, nothing will be written. Add --apply to write.");

  // With an old key set, stops unless the app's newest saved vault password is on this terminal's current key.
  const newest = await prisma.clientCredential.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { encryptedPassword: true },
  });
  confirmAppUsesCurrentKey(newest?.encryptedPassword ?? null, deps);

  const totals: Outcome = { unreadable: 0, written: 0, changedMeanwhile: 0, failed: 0 };
  const outcomes = [
    await runTable(clientCredentials, deps, apply),
    await runTable(highLevelConnections, deps, apply),
    await runTable(calendarConnections, deps, apply),
  ];
  for (const outcome of outcomes) {
    totals.unreadable += outcome.unreadable;
    totals.written += outcome.written;
    totals.changedMeanwhile += outcome.changedMeanwhile;
    totals.failed += outcome.failed;
  }

  if (totals.unreadable > 0) {
    console.error(
      `${totals.unreadable} stored values cannot be read with either key and were not changed. Do not remove CREDENTIALS_ENCRYPTION_KEY_OLD until this is 0.`,
    );
  }
  if (totals.failed > 0) console.error(`${totals.failed} rows could not be written. Run again.`);
  if (totals.unreadable > 0 || totals.failed > 0) process.exitCode = 1;

  console.log(
    apply
      ? "Done. Run again without --apply to check that 0 are left to re-encrypt, then reveal one older vault password in the app to check the app can read it."
      : "Dry run finished. Nothing was changed.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unexpected error.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
