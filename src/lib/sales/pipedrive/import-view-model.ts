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
  /** The latest real copy (practice runs never count): only the check and the final copy need it. */
  realCopy: { status: ImportRunStatus; finishedAt: string | null } | null;
  /** The check report saved on the latest real copy, when it has one. */
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
    const times = `${formatCount(group.count)} ${group.count === 1 ? "time" : "times"}`;
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

/** Every number on the screen goes through this, so they all read the same way (1,284). */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** "Matches", or how far the app is from Pipedrive and which way: "55 short" or "3 extra". */
export function checkResult(row: CheckRow): string {
  if (row.ok) return "Matches";
  const diff = row.pipedrive - (row.app + row.skipped);
  return diff >= 0 ? `${formatCount(diff)} short` : `${formatCount(-diff)} extra`;
}

const FAILURE_PREFIXES = ["The copy stopped", "This run stopped answering"];

/** The sentence that says why a run failed: the engine's own, newest last. */
export function failureMessage(run: ImportRunView): string {
  const found = [...run.issues].reverse().find((group) => FAILURE_PREFIXES.some((p) => group.message.startsWith(p)));
  return found?.message ?? "The copy stopped before it finished.";
}

/** "The practice run", "The real copy" or "The final copy", for card titles. */
export function runName(run: Pick<ImportRunView, "mode" | "isFinal">): string {
  if (run.mode === "DRY_RUN") return "The practice run";
  return run.isFinal ? "The final copy" : "The real copy";
}

// --- The loop that carries a copy forward from the browser ---

export type ContinueAnswer = { done: boolean; paused: boolean; phase: string; counts: Record<string, number> };
export type ContinueResult = { ok: true; data: ContinueAnswer } | { ok: false; status: number; error: string };
export type DriveOutcome = { kind: "done" } | { kind: "stopped"; message: string | null } | { kind: "inactive" };

export const STALL_MESSAGE = "This copy may be running in another window. Close other windows, then press Keep going.";

/** Pipedrive asked us to slow down: wait this long before the next call. */
export const PAUSE_MS = 60_000;
/** A chunk that comes back not done faster than this did no real work (usually another window holds the copy). */
const QUICK_MS = 10_000;
const QUICK_WAIT_MS = 5_000;
const QUICK_LIMIT = 6;
const PAUSE_LIMIT = 10;

/**
 * Calls `continueFn` until the server says done. Waits a minute after a pause
 * (and says so through `onProgress`, then clears it before the next call),
 * waits 5 seconds after a quick answer that is not done, and stops with
 * STALL_MESSAGE after 6 quick answers or 10 pauses in a row. A 409 means the
 * copy ended somewhere else: it stops with no message (the refreshed status
 * says how). Any other error stops with its message. `isActive` false (the page
 * was left) stops quietly.
 */
export async function driveRun(opts: {
  continueFn: () => Promise<ContinueResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  isActive: () => boolean;
  onProgress: (answer: ContinueAnswer) => void;
}): Promise<DriveOutcome> {
  let quick = 0;
  let pauses = 0;
  while (opts.isActive()) {
    const started = opts.now();
    const result = await opts.continueFn();
    if (!opts.isActive()) break;
    if (!result.ok) return { kind: "stopped", message: result.status === 409 ? null : result.error };

    const answer = result.data;
    opts.onProgress(answer);
    if (answer.done) return { kind: "done" };

    if (answer.paused) {
      quick = 0;
      pauses += 1;
      if (pauses >= PAUSE_LIMIT) return { kind: "stopped", message: STALL_MESSAGE };
      await opts.sleep(PAUSE_MS);
      opts.onProgress({ ...answer, paused: false });
      continue;
    }
    pauses = 0;

    if (opts.now() - started < QUICK_MS) {
      quick += 1;
      if (quick >= QUICK_LIMIT) return { kind: "stopped", message: STALL_MESSAGE };
      await opts.sleep(QUICK_WAIT_MS);
    } else {
      quick = 0;
    }
  }
  return { kind: "inactive" };
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
