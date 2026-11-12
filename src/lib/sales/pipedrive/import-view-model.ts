// What the "Copy from Pipedrive" screen shows, decided by small pure helpers so
// each rule is tested on its own: which state the screen is in, each step in
// plain words, the issue lines, how a check row came out, and the typed word
// the final copy needs. Safe for the browser: types only from the server side.

import type { UserMatch } from "@/lib/sales/pipedrive/import-decide";
import type { IssueGroup } from "@/lib/sales/pipedrive/import-state";
import type { CheckRow, SpotCheck } from "@/lib/sales/pipedrive/verify";
import { APP_TIME_ZONE } from "@/lib/utils";

export type ImportMode = "DRY_RUN" | "LIVE";
export type ImportRunStatus = "RUNNING" | "DONE" | "FAILED";

/** The latest run as the screen sees it. Times are ISO strings (the same shape from the page and the status route). */
export type ImportRunView = {
  id: string;
  mode: ImportMode;
  isFinal: boolean;
  status: ImportRunStatus;
  phase: string;
  counts: Record<string, number>;
  issues: IssueGroup[];
  startedAt: string;
  finishedAt: string | null;
};

export type CheckReport = { rows: CheckRow[]; spot: SpotCheck[] };
export type SavedCheck = { report: CheckReport; at: string };

/** Everything the screen needs. It never carries the token, only whether it is set and its last 4 characters. */
export type ImportStatus = {
  token: { set: boolean; last4: string | null };
  /** True once a final real copy finished: no copy can run again. */
  locked: boolean;
  lockedAt: string | null;
  run: ImportRunView | null;
  /** The check report saved on the latest run, when it has one. */
  check: SavedCheck | null;
  users: UserMatch[];
  /** Sales members, for the owner picker. */
  members: { id: string; name: string }[];
};

export type ScreenState = "no-token" | "locked" | "running" | "failed" | "done" | "ready";

export function screenState(status: ImportStatus): ScreenState {
  if (status.locked) return "locked";
  if (!status.token.set) return "no-token";
  const run = status.run;
  if (!run) return "ready";
  if (run.status === "RUNNING") return "running";
  if (run.status === "FAILED") return "failed";
  return "done";
}

/** The word the final copy asks for. */
export const FINAL_WORD = "LOCK";

export function finalEnabled(typed: string): boolean {
  return typed.trim() === FINAL_WORD;
}

/** The steps that do work, in order (the engine's list without "done"). */
const STEPS: { phase: string; label: string }[] = [
  { phase: "users", label: "Reading Pipedrive users" },
  { phase: "structure", label: "Setting up pipelines, stages and fields" },
  { phase: "organizations", label: "Copying organizations" },
  { phase: "persons", label: "Copying people" },
  { phase: "deals", label: "Copying deals" },
  { phase: "leads", label: "Copying leads" },
  { phase: "activities", label: "Copying activities" },
  { phase: "notes", label: "Copying notes" },
  { phase: "files", label: "Copying files" },
];

export function stepLabel(phase: string): string {
  if (phase === "done") return "Finished";
  return STEPS.find((s) => s.phase === phase)?.label ?? "Working";
}

export function stepPosition(phase: string): { step: number; total: number } {
  const at = STEPS.findIndex((s) => s.phase === phase);
  return { step: at === -1 ? STEPS.length : at + 1, total: STEPS.length };
}

/** The name of a kind of record or a step, for issue lines and counts. */
const KIND_NAMES: Record<string, string> = {
  users: "Pipedrive users",
  structure: "Pipelines, stages and fields",
  organizations: "Organizations",
  persons: "People",
  deals: "Deals",
  leads: "Leads",
  activities: "Activities",
  notes: "Notes",
  files: "Files",
  done: "Finishing",
};

export const ISSUES_SHOWN = 50;

/** "Deals: 3 times, example ids 12, 40, 77: <message>", the first `limit` groups, and how many more there are. */
export function issueLines(groups: IssueGroup[], limit = ISSUES_SHOWN): { lines: string[]; rest: number } {
  const lines = groups.slice(0, limit).map((group) => {
    const kind = KIND_NAMES[group.phase] ?? "Other";
    const times = `${group.count} ${group.count === 1 ? "time" : "times"}`;
    const ids = group.sampleIds.length
      ? `, example ${group.sampleIds.length === 1 ? "id" : "ids"} ${group.sampleIds.join(", ")}`
      : "";
    return `${kind}: ${times}${ids}: ${group.message}`;
  });
  return { lines, rest: Math.max(0, groups.length - limit) };
}

export type CountRow = { label: string; created: number; updated: number; unchanged: number; skipped: number };

const COUNTED: string[] = ["organizations", "persons", "deals", "leads", "activities", "notes"];

/** One row per kind of record the run has touched so far. */
export function countRows(counts: Record<string, number>): CountRow[] {
  const read = (key: string) => counts[key] ?? 0;
  return COUNTED.flatMap((kind) => {
    const row = {
      label: KIND_NAMES[kind],
      created: read(`${kind}.created`),
      updated: read(`${kind}.updated`),
      unchanged: read(`${kind}.unchanged`),
      skipped: read(`${kind}.skipped`),
    };
    return row.created + row.updated + row.unchanged + row.skipped > 0 ? [row] : [];
  });
}

export function checkResult(row: CheckRow): string {
  if (row.ok) return "Matches";
  return `Off by ${Math.abs(row.pipedrive - (row.app + row.skipped))}`;
}

const FAILURE_PREFIXES = ["The copy stopped", "This run stopped answering"];

/** The sentence that says why a run failed: the engine's own, newest last. */
export function failureMessage(run: ImportRunView): string {
  const found = [...run.issues].reverse().find((group) => FAILURE_PREFIXES.some((p) => group.message.startsWith(p)));
  return found?.message ?? "The copy stopped before it finished.";
}

export function runTitle(run: Pick<ImportRunView, "mode" | "isFinal">): string {
  if (run.mode === "DRY_RUN") return "Practice run";
  return run.isFinal ? "Final copy" : "Copy for real";
}

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

/** One fixed time zone, so the server render and the browser agree. */
export function formatWhen(iso: string): string {
  return WHEN.format(new Date(iso));
}

export const BOSS_NOTE =
  "Until you switch off Pipedrive, Pipedrive is the boss. Copying again replaces edits made here to copied records.";

export const SLOW_DOWN = "Pipedrive asked us to slow down. Continuing in a minute.";

export const NOT_COPIED: string[] = [
  "Emails and call logs (emails come with the Gmail project)",
  "Products on deals",
  "Labels",
  "Smart Docs",
  "Projects",
  "Campaigns",
];

export const NOT_COPIED_FILES = "Files over 4 MB, or of a type the app does not take, are listed under Things to look at instead.";
