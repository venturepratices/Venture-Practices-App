import { GUARD_HOST } from "./guard";
import { prisma } from "@/lib/prisma";
async function main() {
  console.log("host", GUARD_HOST);
  const pipes = await prisma.salesPipeline.findMany({ select: { id: true, key: true, name: true, kind: true, position: true, archivedAt: true, stages: { select: { name: true, key: true, position: true, isWon: true, isLost: true, archivedAt: true }, orderBy: { position: "asc" } } } });
  for (const p of pipes) console.log(p.position, p.name, p.kind, p.archivedAt ? "ARCH" : "", "|", p.stages.map((s) => `${s.position}:${s.name}${s.isWon ? "(W)" : ""}${s.isLost ? "(L)" : ""}${s.archivedAt ? "(A)" : ""}`).join(", "));
  const fields = await prisma.salesCustomField.findMany({ select: { key: true, label: true, entity: true, fieldType: true, archivedAt: true } });
  console.log("fields", fields.map((f) => `${f.entity}:${f.label}:${f.fieldType}${f.archivedAt ? "(A)" : ""}`).join(" | "));
  const members = await prisma.teamMember.findMany({ where: { OR: [{ isAdmin: true }, { canUseSales: true }] }, select: { id: true } });
  console.log("sales members", members.length);
  const t = ["salesOrganization","salesPerson","salesLead","salesDeal","salesActivity","salesNote","salesFile"] as const;
  for (const n of t) console.log(n, "withPipedriveId", await (prisma[n] as any).count({ where: { pipedriveId: { not: null } } }));
  console.log("runs", await prisma.salesImportRun.count(), "usermap", await prisma.salesImportUserMap.count());
  console.log("TEST deals", await prisma.salesDeal.count({ where: { title: { startsWith: "TEST " } } }));
  const info = await prisma.$queryRawUnsafe<any[]>(`select table_name::text as table_name, column_name::text as column_name from information_schema.columns where table_schema='public' and (column_name='pipedriveId' or table_name in ('SalesImportRun','SalesImportUserMap')) order by 1,2`);
  console.log(info.map((r) => `${r.table_name}.${r.column_name}`).join(" "));
}
main().finally(() => prisma.$disconnect());
