import { prisma } from "@/lib/prisma";
import { savedViewsSchema, type SavedBoardView, type SavedView } from "@/lib/sales/board-query";

// The remembered Deals view (spec 16.3): pipeline, Board or List, and Everyone
// or Just me, kept per person on TeamMember.salesDefaultView. And the person's
// named views (the Views menu, Decision 29), kept on TeamMember.salesSavedViews.
// Preferences, not Sales data, so saving either writes no history row
// (Decision 13).

type ViewDb = Pick<typeof prisma, "teamMember">;

/** The stored view as raw JSON (or null). `parseBoardQuery` validates it and ignores anything malformed. */
export async function loadDefaultView(userId: string, db: ViewDb = prisma): Promise<unknown> {
  const row = await db.teamMember.findUnique({ where: { id: userId }, select: { salesDefaultView: true } });
  return row?.salesDefaultView ?? null;
}

export async function saveDefaultView(userId: string, view: SavedView, db: ViewDb = prisma): Promise<void> {
  await db.teamMember.update({ where: { id: userId }, data: { salesDefaultView: view }, select: { id: true } });
}

/** The person's saved views. Nothing stored, or anything that breaks the rules, gives none. */
export async function loadSavedViews(userId: string, db: ViewDb = prisma): Promise<SavedBoardView[]> {
  const row = await db.teamMember.findUnique({ where: { id: userId }, select: { salesSavedViews: true } });
  const parsed = savedViewsSchema.safeParse(row?.salesSavedViews ?? []);
  return parsed.success ? parsed.data : [];
}

/** Replaces the person's saved views with `views`, already checked by `savedViewsSchema`. */
export async function saveSavedViews(userId: string, views: SavedBoardView[], db: ViewDb = prisma): Promise<void> {
  await db.teamMember.update({ where: { id: userId }, data: { salesSavedViews: views }, select: { id: true } });
}
