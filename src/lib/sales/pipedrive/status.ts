// What the "Copy from Pipedrive" screen shows on load and on every status
// request: the latest run, whether the token is set (its last 4 characters at
// most), whether copying is locked, the saved check report and the owner list.
// It reads the database only. It never calls Pipedrive, so loading the page or
// asking for the status costs none of the company's Pipedrive budget.

import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";
import { pipedriveTokenInfo } from "@/lib/sales/pipedrive/client";
import { loadUserMappings } from "@/lib/sales/pipedrive/import";
import { readCounts, readIssueGroups } from "@/lib/sales/pipedrive/import-state";
import type { CheckReport, ImportStatus, SavedCheck } from "@/lib/sales/pipedrive/import-view-model";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The `{ report, at }` the check saved under `report` in a run's cursor, or null. */
export function readSavedCheck(cursor: unknown): SavedCheck | null {
  const saved = asRecord(asRecord(cursor)?.report);
  const report = asRecord(saved?.report);
  if (!saved || !report || typeof saved.at !== "string") return null;
  if (!Array.isArray(report.rows) || !Array.isArray(report.spot)) return null;
  return { report: report as unknown as CheckReport, at: saved.at };
}

export async function loadImportStatus(env: Record<string, string | undefined> = process.env): Promise<ImportStatus> {
  const [latest, lock, users, members] = await Promise.all([
    prisma.salesImportRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.salesImportRun.findFirst({
      where: { mode: "LIVE", isFinal: true, status: "DONE" },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true },
    }),
    loadUserMappings(),
    prisma.teamMember.findMany({ where: SALES_MEMBER_WHERE, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return {
    token: pipedriveTokenInfo(env),
    locked: lock !== null,
    lockedAt: lock?.finishedAt?.toISOString() ?? null,
    run: latest
      ? {
          id: latest.id,
          mode: latest.mode,
          isFinal: latest.isFinal,
          status: latest.status,
          phase: latest.phase,
          counts: readCounts(latest.counts),
          issues: readIssueGroups(latest.issues),
          startedAt: latest.startedAt.toISOString(),
          finishedAt: latest.finishedAt?.toISOString() ?? null,
        }
      : null,
    check: latest ? readSavedCheck(latest.cursor) : null,
    users,
    members: members.map((m) => ({ id: m.id, name: m.name })),
  };
}
