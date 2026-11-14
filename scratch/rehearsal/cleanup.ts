// Removes ONLY what the rehearsal created, in foreign-key-safe order, then compares
// every Sales table with the "before" snapshot. Audit rows cannot be deleted (trigger).
import { prisma, readState, countAll, diff, saveState } from "./common";

const PD = { pipedriveId: { gte: 9000000 } };
const LEADS = { pipedriveId: { startsWith: "90000000-" } };

async function main() {
  const s = readState();
  const deals = (await prisma.salesDeal.findMany({ where: { OR: [PD, { title: { startsWith: "REHEARSAL " } }] }, select: { id: true } })).map((d) => d.id);
  const leads = (await prisma.salesLead.findMany({ where: { OR: [LEADS, { title: { startsWith: "REHEARSAL " } }] }, select: { id: true } })).map((d) => d.id);
  const fields = (await prisma.salesCustomField.findMany({ where: { label: { startsWith: "REHEARSAL " } }, select: { id: true } })).map((f) => f.id);
  const pipes = (await prisma.salesPipeline.findMany({ where: { name: { startsWith: "REHEARSAL " } }, select: { id: true } })).map((p) => p.id);
  const stageIds = (await prisma.salesStage.findMany({ where: { OR: [{ name: { startsWith: "REHEARSAL " } }, { pipelineId: { in: pipes } }] }, select: { id: true } })).map((x) => x.id);
  const auditLeft = await prisma.salesAuditLog.count({ where: { entityId: { in: [...deals, ...leads] } } });

  const out: Record<string, number> = {};
  out.customValues = (await prisma.salesCustomFieldValue.deleteMany({ where: { OR: [{ dealId: { in: deals } }, { leadId: { in: leads } }, { fieldId: { in: fields } }] } })).count;
  out.files = (await prisma.salesFile.deleteMany({ where: { OR: [PD, { dealId: { in: deals } }, { leadId: { in: leads } }] } })).count;
  out.notes = (await prisma.salesNote.deleteMany({ where: { OR: [PD, { dealId: { in: deals } }, { leadId: { in: leads } }] } })).count;
  out.activities = (await prisma.salesActivity.deleteMany({ where: { OR: [PD, { dealId: { in: deals } }, { leadId: { in: leads } }] } })).count;
  out.deals = (await prisma.salesDeal.deleteMany({ where: { id: { in: deals } } })).count;
  out.leads = (await prisma.salesLead.deleteMany({ where: { id: { in: leads } } })).count;
  out.persons = (await prisma.salesPerson.deleteMany({ where: { OR: [PD, { name: { startsWith: "REHEARSAL " } }] } })).count;
  out.orgs = (await prisma.salesOrganization.deleteMany({ where: { OR: [PD, { name: { startsWith: "REHEARSAL " } }] } })).count;
  out.stages = (await prisma.salesStage.deleteMany({ where: { id: { in: stageIds } } })).count;
  out.pipelines = (await prisma.salesPipeline.deleteMany({ where: { id: { in: pipes } } })).count;
  out.fields = (await prisma.salesCustomField.deleteMany({ where: { id: { in: fields } } })).count;
  out.userMap = (await prisma.salesImportUserMap.deleteMany({ where: { pipedriveUserId: { gte: 9000000 } } })).count;
  // Every run row: there were 0 before the rehearsal (recorded ids plus anything started since).
  out.runs = (await prisma.salesImportRun.deleteMany({ where: { OR: [{ id: { in: s.runIds } }, ...(s.startedAt ? [{ startedAt: { gte: new Date(s.startedAt) } }] : [])] } })).count;

  // Restore positions (and updatedAt) of app stages the structure step moved down.
  let restored = 0;
  for (const st of s.stages ?? []) {
    const now = await prisma.salesStage.findUnique({ where: { id: st.id }, select: { position: true, updatedAt: true } });
    if (now && (now.position !== st.position || now.updatedAt.toISOString() !== st.updatedAt)) {
      await prisma.$executeRaw`UPDATE "SalesStage" SET "position" = ${st.position}, "updatedAt" = ${new Date(st.updatedAt)} WHERE "id" = ${st.id}`;
      restored++;
    }
  }
  console.log("deleted", JSON.stringify(out), "stagesRestored", restored, "auditRowsLeft(immutable)", auditLeft);

  const after = await countAll();
  if (s.before) {
    const d = diff(s.before, after).filter((x) => !x.startsWith("salesAuditLog"));
    console.log("count diff vs before (excluding audit):", d.length === 0 ? "NONE" : d.join("; "));
    console.log("audit:", s.before.salesAuditLog, "->", after.salesAuditLog);
  }
  const stagesNow = await prisma.salesStage.findMany({ select: { id: true, position: true, updatedAt: true } });
  const mism = (s.stages ?? []).filter((st) => { const n = stagesNow.find((x) => x.id === st.id); return !n || n.position !== st.position || n.updatedAt.toISOString() !== st.updatedAt; });
  console.log("stage positions/updatedAt identical to before:", mism.length === 0, "stage count", stagesNow.length, "before", s.stages?.length);
  const test = await prisma.salesDeal.findMany({ where: { title: { startsWith: "TEST " } }, select: { updatedAt: true } });
  console.log("TEST deals", test.length, "max updatedAt", test.map((x) => x.updatedAt.toISOString()).sort().pop());
  console.log("leftover pipedriveId rows:", await prisma.salesDeal.count({ where: { pipedriveId: { not: null } } }), await prisma.salesOrganization.count({ where: { pipedriveId: { not: null } } }), await prisma.salesPerson.count({ where: { pipedriveId: { not: null } } }));
  saveState({ ...s, runIds: [] });
}
main().catch((e) => { console.error("CLEANUP ERROR", e?.code, String(e?.message).slice(0, 300)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
