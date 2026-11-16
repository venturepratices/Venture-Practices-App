// The shared state of one Pipedrive import run: its steps, the grouped issue
// list, the counts, and what the run remembers between requests (its cursor).
// Pure: no Prisma, no network. The run row stores all of it as JSON.

import type { PipedriveClient, PageToken } from "@/lib/sales/pipedrive/client";

/** The steps of a run, in the order they run. */
export const IMPORT_PHASES = [
  "users",
  "structure",
  "organizations",
  "persons",
  "deals",
  "leads",
  "activities",
  "notes",
  "files",
  "done",
] as const;

export type ImportPhase = (typeof IMPORT_PHASES)[number];

/** One thing the report should mention. Lead ids (and the lead link on activities and notes) are UUID text. */
export type ImportIssue = { phase: ImportPhase; pipedriveId: number | string | null; message: string };

/**
 * How issues are stored: one row per kind of issue. `message` is the first
 * example of the kind, `count` how many records had it, `sampleIds` the first
 * three Pipedrive ids.
 */
export type IssueGroup = { phase: ImportPhase; message: string; count: number; sampleIds: (number | string)[] };

/** At most this many kinds of issue are kept, so one noisy kind cannot crowd out the rest. */
export const ISSUE_GROUPS_MAX = 200;
const SAMPLE_IDS_MAX = 3;

/**
 * The files-step issue that says nothing more can be stored. It is its own kind
 * (never grouped with another), and the screen lists it first, so it can never
 * fall past the lines the screen shows.
 */
export const NO_FILE_STORAGE_ISSUE = "File storage is not set up, so no more files were copied.";

export type Counts = Record<string, number>;

export function bump(counts: Counts, key: string, by = 1): void {
  if (by === 0) return;
  counts[key] = (counts[key] ?? 0) + by;
}

export function isImportPhase(value: unknown): value is ImportPhase {
  return typeof value === "string" && (IMPORT_PHASES as readonly string[]).includes(value);
}

export function nextPhase(phase: ImportPhase): ImportPhase {
  return IMPORT_PHASES[Math.min(IMPORT_PHASES.indexOf(phase) + 1, IMPORT_PHASES.length - 1)];
}

/**
 * The kind of an issue: the same sentence with any quoted text and any number
 * taken out, so "\"a@b\" is not an email address" and "\"x@y\" is not an email
 * address" are one kind. The record ids are never in the sentences, so they
 * never split a kind.
 */
export function issueKind(message: string): string {
  return message.replace(/"[^"]*"/g, '""').replace(/\d+/g, "#");
}

export type IssueLog = {
  groups: IssueGroup[];
  /** Kinds of issue refused because the list was full (counted once per kind within one request). */
  dropped: number;
  /**
   * Adds one issue to its group. `exact` keeps sentences that name a pipeline,
   * stage or field apart even though they differ only in quoted text.
   */
  add(issue: ImportIssue, opts?: { exact?: boolean }): void;
};

export function createIssueLog(groups: IssueGroup[], dropped = 0): IssueLog {
  const byKey = new Map<string, IssueGroup>();
  const exactKey = (phase: string, message: string) => `${phase}\u0001=${message}`;
  const kindKey = (phase: string, message: string) => `${phase}\u0001~${issueKind(message)}`;
  for (const group of groups) {
    byKey.set(exactKey(group.phase, group.message), group);
    if (!byKey.has(kindKey(group.phase, group.message))) byKey.set(kindKey(group.phase, group.message), group);
  }
  const refused = new Set<string>();

  const log: IssueLog = {
    groups,
    dropped,
    add(issue, opts = {}) {
      const key = opts.exact ? exactKey(issue.phase, issue.message) : kindKey(issue.phase, issue.message);
      let group = byKey.get(key);
      if (!group) {
        if (groups.length >= ISSUE_GROUPS_MAX) {
          if (!refused.has(key)) {
            refused.add(key);
            log.dropped += 1;
          }
          return;
        }
        group = { phase: issue.phase, message: issue.message, count: 0, sampleIds: [] };
        groups.push(group);
        byKey.set(key, group);
      }
      group.count += 1;
      if (issue.pipedriveId !== null && group.sampleIds.length < SAMPLE_IDS_MAX && !group.sampleIds.includes(issue.pipedriveId)) {
        group.sampleIds.push(issue.pipedriveId);
      }
    },
  };
  return log;
}

/** Reads stored issue groups back, dropping anything that is not one. */
export function readIssueGroups(json: unknown): IssueGroup[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((raw): IssueGroup[] => {
    const g = raw as Partial<IssueGroup> | null;
    if (!g || !isImportPhase(g.phase) || typeof g.message !== "string" || typeof g.count !== "number") return [];
    const sampleIds = Array.isArray(g.sampleIds)
      ? g.sampleIds.filter((id): id is number | string => typeof id === "number" || typeof id === "string")
      : [];
    return [{ phase: g.phase, message: g.message, count: g.count, sampleIds }];
  });
}

export function readCounts(json: unknown): Counts {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return {};
  return Object.fromEntries(
    Object.entries(json as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

// --- What the run remembers between requests ---

/** A Pipedrive user and the team member their records go to (null: the person who started the run). */
export type ImportUser = { id: number; name: string; email: string | null; memberId: string | null };

/** The app stage a Pipedrive stage became. Ids are null in a practice run for one that would be created. */
export type StageLink = { stageId: string | null; pipelineId: string | null };
export type PipelineLink = { pipelineId: string | null; firstStageId: string | null };

/** A Pipedrive deal field: its name, its choices (id to label, for single and multiple option fields), and the app fields it fills. */
export type FieldLink = {
  name: string;
  options: Record<string, string> | null;
  dealFieldId: string | null;
  leadFieldId: string | null;
};

export type ImportContext = {
  users: ImportUser[];
  stages: Record<string, StageLink>;
  pipelines: Record<string, PipelineLink>;
  fields: Record<string, FieldLink>;
};

/**
 * Stored in the run's `cursor` column. `context` is what the users and
 * structure steps learned (later steps need it, and a later request cannot ask
 * again for free). `source` is which list of the step is being read (deals have
 * two: open ones and archived ones), `page` where its next page starts.
 */
export type RunCursor = { context: ImportContext; source: number; page: PageToken | null };

export function emptyContext(): ImportContext {
  return { users: [], stages: {}, pipelines: {}, fields: {} };
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readPage(value: unknown): PageToken | null {
  const page = asObject(value);
  if (typeof page.cursor === "string" && page.cursor !== "") return { cursor: page.cursor };
  if (typeof page.start === "number" && Number.isInteger(page.start) && page.start >= 0) return { start: page.start };
  return null;
}

export function readCursor(json: unknown): RunCursor {
  const raw = asObject(json);
  const context = asObject(raw.context);
  return {
    context: {
      users: Array.isArray(context.users) ? (context.users as ImportUser[]) : [],
      stages: asObject(context.stages) as Record<string, StageLink>,
      pipelines: asObject(context.pipelines) as Record<string, PipelineLink>,
      fields: asObject(context.fields) as Record<string, FieldLink>,
    },
    source: typeof raw.source === "number" && Number.isInteger(raw.source) && raw.source >= 0 ? raw.source : 0,
    page: readPage(raw.page),
  };
}

/** What a step works with. The step functions change `cursor`, `counts` and `issues` in place. */
export type PhaseWork = {
  client: PipedriveClient;
  /** False for a practice run: read and report, write nothing to any Sales table. */
  live: boolean;
  starterId: string;
  /** The import date, used by the mappers for anything Pipedrive left out. */
  fallback: Date;
  cursor: RunCursor;
  counts: Counts;
  issues: IssueLog;
  /** True once there is no time left to start another page. */
  outOfTime: () => boolean;
  /** Saves the run after a page. False when another request took the run over: stop at once. */
  save: () => Promise<boolean>;
};

/** How a step ended: all its lists were read, or it stopped (out of time, or the run was taken over). */
export type PhaseResult = "finished" | "stopped";
