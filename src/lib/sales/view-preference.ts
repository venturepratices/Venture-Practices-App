import { prisma } from "@/lib/prisma";
import { savedViewSummary } from "@/lib/sales/board-client";
import { savedViewsSchema, type SavedBoardView, type SavedView } from "@/lib/sales/board-query";
import { BOARD_PIPELINE_KINDS } from "@/lib/sales/constants";

// The remembered Deals view (spec 16.3): pipeline, Board or List, and Everyone
// or Just me, kept per person on TeamMember.salesDefaultView. And the person's
// named views (the Views menu, Decision 29), kept on TeamMember.salesSavedViews.
// Preferences, not Sales data, so saving either writes no history row
// (Decision 13).

type ViewDb = Pick<typeof prisma, "teamMember" | "salesPipeline">;

/** One saved view plus its summary line, shown by the Views menu. */
export type SavedViewItem = { view: SavedBoardView; summary: string };

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

/**
 * The person's saved views together with each one's summary line (the Views
 * menu, Decision 29). Reads live Sales and Consulting pipelines and their live
 * stage keys and names in parallel with the views, so an archived pipeline or
 * a renamed stage shows through. A view naming a pipeline that is gone gets a
 * summary without the pipeline or the stage (`savedViewSummary` drops both).
 */
export async function loadSavedViewItems(userId: string, db: ViewDb = prisma): Promise<SavedViewItem[]> {
  const [views, pipelines] = await Promise.all([
    loadSavedViews(userId, db),
    db.salesPipeline.findMany({
      where: { archivedAt: null, kind: { in: [...BOARD_PIPELINE_KINDS] } },
      orderBy: { position: "asc" },
      select: { key: true, name: true, stages: { where: { archivedAt: null }, select: { key: true, name: true } } },
    }),
  ]);
  const pipelineByKey = new Map(pipelines.map((p) => [p.key, p] as const));
  return views.map((view) => {
    const pipeline = view.pipeline ? pipelineByKey.get(view.pipeline) ?? null : null;
    const stage = pipeline && view.stage ? pipeline.stages.find((s) => s.key === view.stage) ?? null : null;
    const names = {
      pipeline: pipeline?.name ?? null,
      stage: stage?.name ?? null,
    };
    return { view, summary: savedViewSummary(view, names) };
  });
}
