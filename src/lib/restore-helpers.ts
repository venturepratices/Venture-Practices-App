/**
 * Pure helpers shared by scripts/restore-from-backup.ts, extracted so their
 * logic can be unit-tested in isolation from the actual database restore.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** JSON.parse reviver — turns ISO date strings back into real Date objects so Prisma gets DateTimes, not strings. */
export function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value;
}

/**
 * Splits self-referencing rows (e.g. AssetComment.parentId -> AssetComment)
 * into dependency-safe batches: batch 0 is every row with no parent (or a
 * parent outside this row set), batch 1 is every row whose parent is in
 * batch 0, and so on — so createMany can insert one batch at a time without
 * ever violating the self-referencing FK. Guards against an unexpected cycle
 * by bailing out (returning any leftover rows as a final batch) rather than
 * looping forever.
 */
export function topologicalBatches<T extends { id: string }>(rows: T[], parentField: keyof T): T[][] {
  const remaining = new Map(rows.map((r) => [r.id, r]));
  const batches: T[][] = [];
  let placedIds = new Set<string>();

  while (remaining.size > 0) {
    const batch: T[] = [];
    for (const row of remaining.values()) {
      const parentId = row[parentField] as unknown as string | null;
      if (!parentId || placedIds.has(parentId) || !rows.some((r) => r.id === parentId)) {
        batch.push(row);
      }
    }
    if (batch.length === 0) {
      // Unexpected cycle — insert everything left in one shot rather than hang.
      batches.push([...remaining.values()]);
      break;
    }
    for (const row of batch) remaining.delete(row.id);
    placedIds = new Set([...placedIds, ...batch.map((r) => r.id)]);
    batches.push(batch);
  }

  return batches;
}
