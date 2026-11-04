import { prisma } from "@/lib/prisma";
import { SALES_SEED_FIELDS, SALES_SEED_PIPELINES } from "@/lib/sales/seed-data";

// Only the three config tables the seed touches, so tests can pass a small fake.
type SeedDb = Pick<typeof prisma, "salesPipeline" | "salesStage" | "salesCustomField">;

/**
 * Makes sure the starting pipelines, stages and custom fields exist. Safe to run
 * any number of times: it creates only what is missing and never changes a row
 * that already exists, so edits admins make later are kept. Returns how many
 * rows this run created.
 */
export async function ensureSalesSeed(db: SeedDb = prisma): Promise<{ pipelines: number; stages: number; fields: number }> {
  let pipelines = 0;
  let stages = 0;
  let fields = 0;

  const existingPipelineKeys = new Set((await db.salesPipeline.findMany({ select: { key: true } })).map((p) => p.key));

  for (const seed of SALES_SEED_PIPELINES) {
    const pipeline = await db.salesPipeline.upsert({
      where: { key: seed.key },
      create: { key: seed.key, name: seed.name, kind: seed.kind, position: seed.position },
      update: {},
    });
    if (!existingPipelineKeys.has(seed.key)) pipelines += 1;

    const existingStageKeys = new Set(
      (await db.salesStage.findMany({ where: { pipelineId: pipeline.id }, select: { key: true } })).map((s) => s.key),
    );
    for (const stage of seed.stages) {
      await db.salesStage.upsert({
        where: { pipelineId_key: { pipelineId: pipeline.id, key: stage.key } },
        create: { pipelineId: pipeline.id, ...stage },
        update: {},
      });
      if (!existingStageKeys.has(stage.key)) stages += 1;
    }
  }

  const existingFieldKeys = new Set((await db.salesCustomField.findMany({ select: { key: true } })).map((f) => f.key));
  for (const field of SALES_SEED_FIELDS) {
    await db.salesCustomField.upsert({ where: { key: field.key }, create: field, update: {} });
    if (!existingFieldKeys.has(field.key)) fields += 1;
  }

  return { pipelines, stages, fields };
}
