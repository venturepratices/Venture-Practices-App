// "Check the copy" on the admin screen: runs the check report against the
// latest real copy and saves it on that run, so the screen can show it again
// without asking Pipedrive. The check walks every Pipedrive list (real API
// requests), so it runs only when someone presses the button, at most once a
// minute, and never for a practice run (a practice run leaves out records
// differently when it cannot check links, so its counts would not compare).

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { fail, type SalesFail } from "@/lib/sales/http";
import { createPipedriveClient, PipedriveError, type PipedriveClient } from "@/lib/sales/pipedrive/client";
import type { SavedCheck } from "@/lib/sales/pipedrive/import-view-model";
import { readSavedCheck } from "@/lib/sales/pipedrive/status";
import { buildCheckReport, type CheckEntity } from "@/lib/sales/pipedrive/verify";

export const TOKEN_NOT_SET = "The Pipedrive token is not set yet.";

/** A client built from PIPEDRIVE_API_TOKEN, or null when it is not set. The token goes no further than the client. */
export function pipedriveClientFromEnv(env: Record<string, string | undefined> = process.env): PipedriveClient | null {
  const token = env.PIPEDRIVE_API_TOKEN?.trim();
  return token ? createPipedriveClient({ token }) : null;
}

const SPOT_PICKS = 5;
const CHECK_GAP_MS = 60_000;
const ENTITIES: CheckEntity[] = ["organizations", "persons", "deals", "leads", "activities", "notes"];

/** Up to 5 distinct positions below `total`, chosen with `random` (a number in [0, 1), like Math.random). */
export function randomIndexes(total: number, random: () => number): number[] {
  const want = Math.min(SPOT_PICKS, Math.max(0, Math.floor(total)));
  const picked: number[] = [];
  const taken = new Set<number>();
  // Draw first; a repeat moves to the next free position, so this always ends.
  while (picked.length < want) {
    let at = Math.min(total - 1, Math.max(0, Math.floor(random() * total)));
    while (taken.has(at)) at = (at + 1) % total;
    taken.add(at);
    picked.push(at);
  }
  return picked;
}

/** The run's own skip counts, as recorded (missing is 0). buildCheckReport takes off what its mapper refuses. */
export function skippedFromCounts(counts: unknown): Record<CheckEntity, number> {
  const record = counts !== null && typeof counts === "object" && !Array.isArray(counts) ? (counts as Record<string, unknown>) : {};
  return Object.fromEntries(
    ENTITIES.map((entity) => {
      const value = record[`${entity}.skipped`];
      return [entity, typeof value === "number" ? value : 0];
    }),
  ) as Record<CheckEntity, number>;
}

export async function checkLatestRun(args: {
  client: PipedriveClient;
  now: Date;
  random: () => number;
}): Promise<({ ok: true } & SavedCheck) | SalesFail> {
  const latest = await prisma.salesImportRun.findFirst({
    orderBy: { startedAt: "desc" },
    select: { id: true, mode: true, status: true, cursor: true, counts: true },
  });
  if (!latest || latest.mode !== "LIVE" || latest.status !== "DONE") return fail(409, "Run the real copy first.");

  const previous = readSavedCheck(latest.cursor);
  if (previous && args.now.getTime() - new Date(previous.at).getTime() < CHECK_GAP_MS) {
    return fail(409, "The copy was checked less than a minute ago. Try again in a minute.");
  }

  let report: SavedCheck["report"];
  try {
    report = await buildCheckReport(args.client, (total) => randomIndexes(total, args.random), skippedFromCounts(latest.counts));
  } catch (error) {
    if (!(error instanceof PipedriveError)) throw error;
    if (error.status === 429) return fail(409, "Pipedrive asked us to slow down. Try the check again in a minute.");
    // The client's messages never carry the token.
    return fail(503, `The check could not finish: ${error.message}`);
  }

  const at = args.now.toISOString();
  const cursor = latest.cursor !== null && typeof latest.cursor === "object" && !Array.isArray(latest.cursor) ? latest.cursor : {};
  await prisma.salesImportRun.update({
    where: { id: latest.id },
    data: { cursor: { ...cursor, report: { report, at } } as unknown as Prisma.InputJsonValue },
  });
  return { ok: true, report, at };
}
