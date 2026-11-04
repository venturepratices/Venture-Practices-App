import { prisma } from "@/lib/prisma";
import type { SavedView } from "@/lib/sales/board-query";

// The remembered Deals view (spec 16.3): pipeline, Board or List, and Everyone
// or Just me, kept per person on TeamMember.salesDefaultView. A preference, not
// Sales data, so saving it writes no history row (Decision 13).

type ViewDb = Pick<typeof prisma, "teamMember">;

/** The stored view as raw JSON (or null). `parseBoardQuery` validates it and ignores anything malformed. */
export async function loadDefaultView(userId: string, db: ViewDb = prisma): Promise<unknown> {
  const row = await db.teamMember.findUnique({ where: { id: userId }, select: { salesDefaultView: true } });
  return row?.salesDefaultView ?? null;
}

export async function saveDefaultView(userId: string, view: SavedView, db: ViewDb = prisma): Promise<void> {
  await db.teamMember.update({ where: { id: userId }, data: { salesDefaultView: view }, select: { id: true } });
}
