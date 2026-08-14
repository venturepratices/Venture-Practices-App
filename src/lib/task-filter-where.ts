import type { Prisma } from "@/generated/prisma/client";
import { endOfDay, startOfDay, todayDateString } from "@/lib/utils";

/**
 * The one place the Tasks filter query-string is turned into a Prisma `where`.
 *
 * Two pages render the same TaskFilters bar — the agency-wide /tasks list and
 * each client's own Tasks tab — and before this existed the first of them
 * built its `where` inline. Duplicating that logic for the second page would
 * have meant every future filter had to be added twice, with a silent
 * behavioral drift the moment someone forgot. Both now call this.
 */

export type TaskFilterParams = {
  q?: string;
  status?: string;
  clientId?: string;
  assigneeId?: string;
  occurrence?: string;
  kind?: string;
  deadline?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  open?: string;
};

/** Every filter key this module reads — used to rebuild pagination links without dropping filters. */
export const TASK_FILTER_PARAM_KEYS = [
  "q",
  "status",
  "clientId",
  "assigneeId",
  "occurrence",
  "kind",
  "deadline",
  "deadlineFrom",
  "deadlineTo",
  "open",
] as const;

/**
 * Returns the filter clause and the free-text search clause **separately**,
 * deliberately: search is an `OR` across title/description, and the callers
 * also set their own top-level `OR` for per-client permission scoping. Merging
 * the two into one object would have one silently overwrite the other, so the
 * caller ANDs them as separate members instead.
 */
export function buildTaskFilterWhere(
  params: TaskFilterParams,
  completeStatusId: string | null
): { filters: Prisma.TaskWhereInput; searchClause: Prisma.TaskWhereInput | null } {
  const filters: Prisma.TaskWhereInput = {};

  if (params.status) filters.statusId = params.status;
  else if (params.open && completeStatusId) {
    // "Open" means "not the status flagged as the done-state" — read from the
    // live TaskStatusOption row rather than a hardcoded "COMPLETE" string,
    // since statuses are admin-editable.
    filters.statusId = { not: completeStatusId };
  }

  if (params.clientId === "NONE") filters.clientId = null;
  else if (params.clientId) filters.clientId = params.clientId;

  if (params.assigneeId === "UNASSIGNED") filters.assignees = { none: {} };
  else if (params.assigneeId) filters.assignees = { some: { teamMemberId: params.assigneeId } };

  if (params.occurrence) filters.occurrence = params.occurrence as Prisma.TaskWhereInput["occurrence"];
  if (params.kind) filters.kind = params.kind as Prisma.TaskWhereInput["kind"];

  // An explicit date range always beats the preset dropdown — the UI clears
  // one when the other is set, but a hand-edited URL could carry both.
  if (params.deadlineFrom || params.deadlineTo) {
    filters.deadline = {
      ...(params.deadlineFrom ? { gte: new Date(params.deadlineFrom) } : {}),
      ...(params.deadlineTo ? { lte: endOfDay(params.deadlineTo) } : {}),
    };
  } else if (params.deadline === "OVERDUE") {
    filters.deadline = { lt: new Date() };
  } else if (params.deadline === "TODAY") {
    const today = todayDateString();
    filters.deadline = { gte: startOfDay(today), lte: endOfDay(today) };
  } else if (params.deadline === "SOON") {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    filters.deadline = { gte: new Date(), lte: sevenDaysFromNow };
  } else if (params.deadline === "NONE") {
    filters.deadline = null;
  }

  const searchClause: Prisma.TaskWhereInput | null = params.q
    ? {
        OR: [
          { title: { contains: params.q, mode: "insensitive" } },
          { description: { contains: params.q, mode: "insensitive" } },
        ],
      }
    : null;

  return { filters, searchClause };
}

/**
 * Rebuilds a URL for the same filtered view — used by pagination links and by
 * the clickable stat cards, so neither ever silently drops the filters that
 * are already applied. Passing null for a key removes it (that's how a stat
 * card toggles itself off).
 */
export function buildTaskFilterHref(
  basePath: string,
  params: TaskFilterParams & { view?: string; page?: string },
  overrides: Partial<Record<(typeof TASK_FILTER_PARAM_KEYS)[number] | "view" | "page", string | null>> = {}
): string {
  const query = new URLSearchParams();
  const merged: Record<string, string | null | undefined> = {
    view: params.view,
    ...Object.fromEntries(TASK_FILTER_PARAM_KEYS.map((key) => [key, params[key]])),
    page: params.page,
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    // page=1 is the default; carrying it would make every "first page" URL noisy.
    if (!value || (key === "page" && value === "1")) continue;
    query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
