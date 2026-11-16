import { prisma, countAll, readState, diff } from "./common";
async function main() {
  const s = readState();
  await prisma.salesImportRun.updateMany({ where: { id: { in: s.runIds }, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date() } });
  const PD = { pipedriveId: { gte: 9000000 } };
  console.log("pd rows org/person/deal/act/note/file", await prisma.salesOrganization.count({ where: PD }), await prisma.salesPerson.count({ where: PD }), await prisma.salesDeal.count({ where: PD }), await prisma.salesActivity.count({ where: PD }), await prisma.salesNote.count({ where: PD }), await prisma.salesFile.count({ where: PD }));
  console.log("leads", await prisma.salesLead.count({ where: { pipedriveId: { startsWith: "90000000-" } } }));
  console.log("REHEARSAL pipelines/stages/fields", await prisma.salesPipeline.count({ where: { name: { startsWith: "REHEARSAL" } } }), await prisma.salesStage.count({ where: { name: { startsWith: "REHEARSAL" } } }), await prisma.salesCustomField.count({ where: { label: { startsWith: "REHEARSAL" } } }));
  console.log("runs RUNNING", await prisma.salesImportRun.count({ where: { status: "RUNNING" } }), "final DONE", await prisma.salesImportRun.count({ where: { isFinal: true, status: "DONE" } }));
  console.log("diff vs before:", diff(s.before!, await countAll()).join("; "));
}
main().finally(() => prisma.$disconnect());
