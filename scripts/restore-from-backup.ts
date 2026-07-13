import "dotenv/config";

import { readFileSync } from "node:fs";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

/**
 * Restores a database snapshot produced by src/lib/backup.ts back into a
 * Postgres database.
 *
 * SAFETY: point DATABASE_URL at a THROWAWAY / branch database, never production —
 * this wipes and repopulates every table. Its two jobs are (1) the real recovery
 * tool if Neon is ever lost, and (2) proving a snapshot actually round-trips
 * (see the plan's verification step 4).
 *
 * Usage (from the project root):
 *   npx tsx scripts/restore-from-backup.ts path/to/backup.json
 */

neonConfig.webSocketConstructor = ws;

// Revive ISO date strings back into Date objects so Prisma gets real DateTimes.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function reviveDates(_key: string, value: unknown) {
  return typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/restore-from-backup.ts <path-to-backup.json>");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Point it at a throwaway/branch database.");
    process.exit(1);
  }

  const snapshot = JSON.parse(readFileSync(filePath, "utf8"), reviveDates) as {
    version: number;
    createdAt: string;
    counts: Record<string, number>;
    tables: Record<string, Record<string, unknown>[]>;
  };

  console.log(`Restoring snapshot v${snapshot.version} from ${snapshot.createdAt}`);
  console.log("Row counts in snapshot:", snapshot.counts);

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const t = snapshot.tables;

  try {
    await prisma.$transaction(async (tx) => {
      // Wipe in reverse-dependency order so FKs never block a delete.
      await tx.activityLog.deleteMany();
      await tx.archivedTask.deleteMany();
      await tx.taskLink.deleteMany();
      await tx.comment.deleteMany();
      await tx.task.deleteMany();
      await tx.clientNote.deleteMany();
      await tx.session.deleteMany();
      await tx.account.deleteMany();
      await tx.verificationToken.deleteMany();
      await tx.client.deleteMany();
      await tx.teamMember.deleteMany();

      // Re-insert in dependency order so every FK target already exists.
      if (t.teamMembers?.length) await tx.teamMember.createMany({ data: t.teamMembers as never });
      if (t.clients?.length) await tx.client.createMany({ data: t.clients as never });
      if (t.clientNotes?.length) await tx.clientNote.createMany({ data: t.clientNotes as never });
      if (t.tasks?.length) await tx.task.createMany({ data: t.tasks as never });
      if (t.comments?.length) await tx.comment.createMany({ data: t.comments as never });
      if (t.taskLinks?.length) await tx.taskLink.createMany({ data: t.taskLinks as never });
      if (t.activityLogs?.length) await tx.activityLog.createMany({ data: t.activityLogs as never });
      if (t.archivedTasks?.length) await tx.archivedTask.createMany({ data: t.archivedTasks as never });
      if (t.accounts?.length) await tx.account.createMany({ data: t.accounts as never });
      if (t.sessions?.length) await tx.session.createMany({ data: t.sessions as never });
      if (t.verificationTokens?.length)
        await tx.verificationToken.createMany({ data: t.verificationTokens as never });
    });

    // Confirm the restore round-tripped by counting rows back out.
    const restored = {
      teamMembers: await prisma.teamMember.count(),
      clients: await prisma.client.count(),
      clientNotes: await prisma.clientNote.count(),
      tasks: await prisma.task.count(),
      comments: await prisma.comment.count(),
      taskLinks: await prisma.taskLink.count(),
      activityLogs: await prisma.activityLog.count(),
      archivedTasks: await prisma.archivedTask.count(),
      accounts: await prisma.account.count(),
      sessions: await prisma.session.count(),
      verificationTokens: await prisma.verificationToken.count(),
    };
    console.log("Row counts after restore:", restored);
    console.log("Restore complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
