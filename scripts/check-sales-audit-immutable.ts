import "dotenv/config";
import { prisma } from "@/lib/prisma";

// Proves the Sales history log is locked at the database level. First checks
// the lock triggers from the add_sales_audit_log migration are there and turned
// on, then adds one row (it stays, that is the point) and tries to change,
// delete and empty the table. Each attempt runs in its own transaction that is
// rolled back, so even a failure of the lock could not lose data. Run with:
//   npx tsx scripts/check-sales-audit-immutable.ts
class Rollback extends Error {}

// The lock is two triggers covering three kinds of change: one row-level trigger
// for UPDATE and DELETE, one statement-level trigger for TRUNCATE.
const LOCK_TRIGGERS = {
  sales_audit_log_no_update_delete: ["update", "delete"],
  sales_audit_log_no_truncate: ["truncate"],
} as const;
// Event bits in pg_trigger.tgtype (see TRIGGER_TYPE_* in PostgreSQL's pg_trigger.h).
const EVENT_BITS = { delete: 8, update: 16, truncate: 32 } as const;

type TriggerRow = { name: string; enabled: string; type: number };

/** Each lock trigger: present, not disabled, and firing on the changes it should block. */
async function checkLockTriggers(): Promise<{ ok: boolean; summary: string }> {
  const rows = await prisma.$queryRaw<TriggerRow[]>`
    SELECT t.tgname::text AS name, t.tgenabled::text AS enabled, t.tgtype::int AS type
    FROM pg_trigger t
    WHERE t.tgrelid = '"SalesAuditLog"'::regclass AND NOT t.tgisinternal
  `;
  let ok = true;
  const parts: string[] = [];
  for (const [name, events] of Object.entries(LOCK_TRIGGERS)) {
    const row = rows.find((r) => r.name === name);
    const firesOnAll = row ? events.every((event) => (row.type & EVENT_BITS[event]) !== 0) : false;
    const state = !row ? "MISSING" : row.enabled === "D" ? "DISABLED" : !firesOnAll ? "WRONG EVENTS" : "enabled";
    if (state !== "enabled") ok = false;
    parts.push(`${name} (${events.join(", ")}) ${state}`);
  }
  return { ok, summary: parts.join("; ") };
}

async function isBlocked(attempt: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>) {
  try {
    await prisma.$transaction(async (tx) => {
      await attempt(tx);
      throw new Rollback();
    });
    return false; // the statement worked, so the lock is missing
  } catch (error) {
    // Only the lock's own message counts, so a dropped connection is not mistaken for success.
    return !(error instanceof Rollback) && String(error).includes("cannot be changed or deleted");
  }
}

async function main() {
  const triggers = await checkLockTriggers();

  const row = await prisma.salesAuditLog.create({
    data: {
      actorType: "SYSTEM",
      entityType: "check",
      entityId: "immutable-check",
      action: "check-locked-history",
      after: { note: "Test row from check-sales-audit-immutable.ts. It stays on purpose." },
    },
  });

  const updateBlocked = await isBlocked((tx) =>
    tx.salesAuditLog.update({ where: { id: row.id }, data: { action: "tampered" } }),
  );
  const deleteBlocked = await isBlocked((tx) => tx.salesAuditLog.delete({ where: { id: row.id } }));
  const truncateBlocked = await isBlocked((tx) => tx.$executeRawUnsafe('TRUNCATE TABLE "SalesAuditLog"'));

  if (triggers.ok && updateBlocked && deleteBlocked && truncateBlocked) {
    console.log(`OK: update blocked, delete blocked, truncate blocked. Lock triggers present and enabled: ${triggers.summary}`);
    return;
  }
  console.error(
    `FAIL: update blocked=${updateBlocked}, delete blocked=${deleteBlocked}, truncate blocked=${truncateBlocked}. ` +
      `Lock triggers: ${triggers.summary}`,
  );
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
