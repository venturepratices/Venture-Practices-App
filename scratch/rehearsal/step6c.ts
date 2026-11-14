// (c) createMany({ skipDuplicates }) on the unique pipedriveId, under a real race:
// a hook inserts org 9000407 from ANOTHER connection right before the engine's
// createMany (after the engine already checked the row was not there).
import { GUARD_HOST } from "./guard";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "@/generated/prisma/client";

async function main() {
  console.log("host", GUARD_HOST);
  neonConfig.webSocketConstructor = ws;
  const base = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  const other = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  const members = await base.teamMember.findMany({ where: { OR: [{ isAdmin: true }, { canUseSales: true }] }, select: { id: true, email: true }, orderBy: { id: "asc" } });
  const [A, B, C] = members;
  let fired = 0;
  const extended = base.$extends({
    query: {
      salesOrganization: {
        async createMany({ args, query }) {
          const data = (Array.isArray(args.data) ? args.data : [args.data]) as { pipedriveId?: number | null }[];
          if (data.some((d) => d.pipedriveId === 9000407) && fired === 0) {
            fired++;
            await other.salesOrganization.create({ data: { name: "REHEARSAL Pre-inserted 7", pipedriveId: 9000407, ownerId: C.id } });
          }
          return query(args);
        },
      },
    },
  });
  (globalThis as unknown as { prisma: unknown }).prisma = extended;
  const { recordRun, drive } = await import("./common");
  const { buildDataset, makeFakeClient } = await import("./fake-client");
  const { startImportRun } = await import("@/lib/sales/pipedrive/import");
  const data = buildDataset({ a: A.email, b: B.email });
  (data["/api/v2/organizations"] as unknown[]).push({ id: 9000407, name: "REHEARSAL Org 7", owner_id: 9000001, add_time: "2025-07-15T10:00:00Z" });
  const s = await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
  if (!s.ok) throw new Error(s.message);
  recordRun(s.runId);
  const r = await drive(s.runId, makeFakeClient(data).client, 120_000);
  const rows = await base.salesOrganization.findMany({ where: { pipedriveId: 9000407 }, select: { name: true } });
  const c = r.run!.counts as Record<string, number>;
  const ok = fired === 1 && r.run?.status === "DONE" && rows.length === 1;
  console.log(`6c | createMany skipDuplicates under race | ${ok ? "PASS" : "FAIL"} | hookFired=${fired} status=${r.run?.status} rowsWithId=${rows.length} keptName="${rows[0]?.name}" organizations.created=${c["organizations.created"]} unchanged=${c["organizations.unchanged"]}`);
  await base.$disconnect(); await other.$disconnect();
}
main().catch((e) => { console.error("ERROR", e?.code, String(e?.stack ?? e).slice(0, 1500)); process.exitCode = 1; });
