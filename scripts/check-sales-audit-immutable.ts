import "dotenv/config";
import { prisma } from "@/lib/prisma";

// Proves the Sales history log is locked at the database level. Adds one row
// (it stays, that is the point), then tries to change, delete and empty the
// table. Each attempt runs in its own transaction that is rolled back, so even
// a failure of the lock could not lose data. Run with:
//   npx tsx scripts/check-sales-audit-immutable.ts
class Rollback extends Error {}

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

  if (updateBlocked && deleteBlocked && truncateBlocked) {
    console.log("OK: update blocked, delete blocked, truncate blocked");
    return;
  }
  console.error(`FAIL: update blocked=${updateBlocked}, delete blocked=${deleteBlocked}, truncate blocked=${truncateBlocked}`);
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
