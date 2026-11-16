// Step 3 re-proof: a DRY_RUN changes no Sales table (counts) and no row's updatedAt.
import { GUARD_HOST, prisma, recordRun, countAll, diff, drive, issuesOf } from "./common";
import { buildDataset, makeFakeClient } from "./fake-client";
import { startImportRun } from "@/lib/sales/pipedrive/import";

async function stamps() {
  const q = { select: { id: true, updatedAt: true } };
  const all = [
    ...(await prisma.salesOrganization.findMany(q)), ...(await prisma.salesPerson.findMany(q)), ...(await prisma.salesDeal.findMany(q)),
    ...(await prisma.salesLead.findMany(q)), ...(await prisma.salesActivity.findMany(q)), ...(await prisma.salesNote.findMany(q)),
    ...(await prisma.salesStage.findMany(q)), ...(await prisma.salesPipeline.findMany(q)), ...(await prisma.salesCustomField.findMany(q)),
    ...(await prisma.salesCustomFieldValue.findMany(q)),
  ];
  return new Map(all.map((r) => [r.id, r.updatedAt.getTime()]));
}

async function main() {
  console.log("host", GUARD_HOST);
  const members = await prisma.teamMember.findMany({ where: { OR: [{ isAdmin: true }, { canUseSales: true }] }, select: { id: true, email: true }, orderBy: { id: "asc" } });
  const [A, B, C] = members;
  const before = await countAll();
  const s1 = await stamps();
  const r = await startImportRun({ mode: "DRY_RUN", isFinal: false, startedById: C.id });
  if (!r.ok) throw new Error(r.message);
  recordRun(r.runId);
  const d = await drive(r.runId, makeFakeClient(buildDataset({ a: A.email, b: B.email })).client, 60_000);
  const after = await countAll();
  const s2 = await stamps();
  const moved = [...s1].filter(([id, t]) => s2.get(id) !== t).length;
  const dd = diff(before, after);
  const text = JSON.stringify(d.run!.issues) + JSON.stringify(d.run!.counts) + JSON.stringify(d.run!.cursor);
  const leak = members.some((m) => JSON.stringify(d.run!.issues).toLowerCase().includes(m.email.toLowerCase())) || text.includes("rehearsal-fake-token");
  console.log(`3 | DRY on populated DB writes nothing | ${d.run?.status === "DONE" && dd.length === 1 && moved === 0 ? "PASS" : "FAIL"} | status=${d.run?.status} diff=${dd.join(";")} rowsWithUpdatedAtMoved=${moved}/${s1.size}`);
  console.log(`3 | DRY issues: no real email or token | ${leak ? "FAIL" : "PASS"} | ${issuesOf(d.run!).length} groups (cursor holds matched users' emails by design)`);
  console.log("dry counts on populated DB", JSON.stringify(d.run!.counts));
}
main().catch((e) => { console.error("ERROR", e?.code, String(e?.stack ?? e).slice(0, 800)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
