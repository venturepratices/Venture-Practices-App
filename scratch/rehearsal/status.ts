import { prisma } from "./common";
prisma.salesImportRun.findMany({ orderBy: { startedAt: "asc" }, select: { id: true, mode: true, isFinal: true, status: true, phase: true, startedAt: true, updatedAt: true } })
  .then((r) => { for (const x of r) console.log(x.id.slice(-6), x.mode, x.isFinal, x.status, x.phase, x.startedAt.toISOString(), x.updatedAt.toISOString()); console.log("now", new Date().toISOString()); })
  .finally(() => prisma.$disconnect());
