// The Pipedrive import engine: starts a run, carries it forward one time-boxed
// chunk per request, and keeps the user matching the admin page shows. The
// steps themselves live next door (import-structure.ts, import-rows.ts); this
// file decides which step runs, saves progress, and guards the run.
//
// Guards:
// - Only one run can be RUNNING (a partial unique index in the database; a
//   refused insert comes back here as a plain-words answer).
// - A RUNNING run nobody has saved for 5 minutes (its request died) is closed
//   as FAILED when a new run starts, so it can never block runs forever.
// - Every save is conditional on the run's `updatedAt` being the one this
//   request last saw. When two requests carry the same run forward at once
//   (two admins pressing Keep going), the one that saves second sees the row
//   moved and stops. Rows are keyed on their unique Pipedrive id, so neither
//   can make a copy.
// - Once a final real run is DONE (Pipedrive was switched off), no real or
//   final run can start again.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrismaError } from "@/lib/prisma-errors";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";
import { PipedriveError, type PipedriveClient } from "@/lib/sales/pipedrive/client";
import { matchPipedriveUsers, type UserMatch } from "@/lib/sales/pipedrive/import-decide";
import { isRowPhase, runRowPhase } from "@/lib/sales/pipedrive/import-rows";
import {
  createIssueLog,
  isImportPhase,
  nextPhase,
  readCounts,
  readCursor,
  readIssueGroups,
  type ImportPhase,
  type PhaseResult,
  type PhaseWork,
} from "@/lib/sales/pipedrive/import-state";
import { runStructurePhase, runUsersPhase } from "@/lib/sales/pipedrive/import-structure";

export type { ImportIssue, ImportPhase, IssueGroup } from "@/lib/sales/pipedrive/import-state";

/** A RUNNING run not saved for this long is taken to have died. */
const STALE_RUN_MS = 5 * 60_000;

const ALREADY_RUNNING = "An import is already running. Wait for it to finish, or press Keep going.";
const LOCKED = "The import is locked. Pipedrive was switched off.";
const FINAL_PRACTICE = "A practice run cannot be the final run.";

export async function startImportRun(args: {
  mode: "DRY_RUN" | "LIVE";
  isFinal: boolean;
  startedById: string;
}): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  if (args.mode === "DRY_RUN" && args.isFinal) return { ok: false, message: FINAL_PRACTICE };
  if (args.mode === "LIVE") {
    const locked = await prisma.salesImportRun.findFirst({ where: { mode: "LIVE", isFinal: true, status: "DONE" }, select: { id: true } });
    if (locked) return { ok: false, message: LOCKED };
  }

  const now = new Date();
  const running = await prisma.salesImportRun.findFirst({
    where: { status: "RUNNING" },
    select: { id: true, phase: true, issues: true, counts: true, updatedAt: true },
  });
  if (running) {
    if (now.getTime() - running.updatedAt.getTime() < STALE_RUN_MS) return { ok: false, message: ALREADY_RUNNING };
    const log = createIssueLog(readIssueGroups(running.issues), readCounts(running.counts).issuesDropped ?? 0);
    log.add(
      {
        phase: isImportPhase(running.phase) ? running.phase : "users",
        pipedriveId: null,
        message: "This run stopped answering for more than 5 minutes, so it was closed to let a new run start.",
      },
      { exact: true },
    );
    // Conditional, so a run that came back to life a moment ago is not closed under it.
    await prisma.salesImportRun.updateMany({
      where: { id: running.id, status: "RUNNING", updatedAt: running.updatedAt },
      data: { status: "FAILED", finishedAt: now, issues: log.groups as unknown as Prisma.InputJsonValue },
    });
  }

  try {
    const run = await prisma.salesImportRun.create({
      data: { mode: args.mode, isFinal: args.isFinal, status: "RUNNING", phase: "users", counts: {}, issues: [], startedById: args.startedById },
      select: { id: true },
    });
    return { ok: true, runId: run.id };
  } catch (error) {
    // Another start won the race (or a live run is still going): the one-RUNNING index refused this one.
    if (isPrismaError(error, "P2002")) return { ok: false, message: ALREADY_RUNNING };
    throw error;
  }
}

type ContinueResult = { done: boolean; paused: boolean; phase: ImportPhase; counts: Record<string, number> };

/**
 * Carries a RUNNING run forward until `deadline`, saving its step, place,
 * counts and issues after every page. Pipedrive's rate limit pauses the run
 * (`paused: true`, place saved) instead of failing it; any other Pipedrive
 * error fails it with a plain-words issue. Any other error is thrown, and the
 * run stays RUNNING at its last saved place, so Keep going can retry it.
 */
export async function continueImportRun(args: {
  runId: string;
  client: PipedriveClient;
  deadline: Date;
  now: () => Date;
}): Promise<ContinueResult> {
  const { runId, client, deadline, now } = args;
  const run = await prisma.salesImportRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("That import run was not found.");
  if (run.status !== "RUNNING") throw new Error("This import is not running, so it cannot continue.");

  let phase: ImportPhase = isImportPhase(run.phase) ? run.phase : "users";
  const cursor = readCursor(run.cursor);
  const counts = readCounts(run.counts);
  const issues = createIssueLog(readIssueGroups(run.issues), counts.issuesDropped ?? 0);
  let version = run.updatedAt;
  let lost = false;

  async function save(finish?: { status: "DONE" | "FAILED"; finishedAt: Date }): Promise<boolean> {
    if (lost) return false;
    if (issues.dropped > 0) counts.issuesDropped = issues.dropped;
    // Always later than the last save, so the next conditional save can tell the two apart.
    const at = new Date(Math.max(now().getTime(), version.getTime() + 1));
    const saved = await prisma.salesImportRun.updateMany({
      where: { id: runId, status: "RUNNING", updatedAt: version },
      data: {
        phase,
        cursor: cursor as unknown as Prisma.InputJsonValue,
        counts,
        issues: issues.groups as unknown as Prisma.InputJsonValue,
        updatedAt: at,
        ...finish,
      },
    });
    if (saved.count === 0) {
      lost = true;
      return false;
    }
    version = at;
    return true;
  }

  const result = (paused: boolean): ContinueResult => ({ done: phase === "done", paused, phase, counts: { ...counts } });

  const work: PhaseWork = {
    client,
    live: run.mode === "LIVE",
    starterId: run.startedById,
    fallback: run.startedAt,
    cursor,
    counts,
    issues,
    outOfTime: () => now().getTime() >= deadline.getTime(),
    save: () => save(),
  };

  // Claims the run: if another request saved it since it was read, that one carries on and this one stops.
  if (!(await save())) return result(false);

  try {
    while (phase !== "done") {
      if (work.outOfTime()) return result(false);
      const outcome = await runPhase(phase, work);
      if (outcome === "stopped" || lost) return result(false);
      phase = nextPhase(phase);
      cursor.source = 0;
      cursor.page = null;
      if (phase !== "done" && !(await save())) return result(false);
    }
  } catch (error) {
    if (!(error instanceof PipedriveError)) throw error;
    if (error.status === 429) {
      await save();
      return result(true);
    }
    // The client's messages never carry the token, a URL or a query string.
    issues.add({ phase, pipedriveId: null, message: `The import stopped because Pipedrive refused a request. ${error.message}` }, { exact: true });
    await save({ status: "FAILED", finishedAt: now() });
    return result(false);
  }

  if (!(await save({ status: "DONE", finishedAt: now() }))) return { ...result(false), done: false };
  return result(false);
}

function runPhase(phase: ImportPhase, work: PhaseWork): Promise<PhaseResult> {
  if (phase === "users") return runUsersPhase(work);
  if (phase === "structure") return runStructurePhase(work);
  if (isRowPhase(phase)) return runRowPhase(phase, work);
  // "files" is filled in by the file copy (Task 7); until then the step simply moves on.
  return Promise.resolve("finished");
}

// --- Owner matching for the admin page ---

/** Saves which team member a Pipedrive user's records go to. Used by the next run (a running one keeps what it read). */
export async function setUserMapping(args: { pipedriveUserId: number; memberId: string }): Promise<void> {
  const member = await prisma.teamMember.findFirst({ where: { id: args.memberId, ...SALES_MEMBER_WHERE }, select: { id: true } });
  if (!member) throw new Error("That team member cannot own Sales records.");
  await prisma.salesImportUserMap.upsert({
    where: { pipedriveUserId: args.pipedriveUserId },
    create: { pipedriveUserId: args.pipedriveUserId, memberId: args.memberId },
    update: { memberId: args.memberId },
  });
}

/** How many recent runs are searched for the Pipedrive user list. */
const RECENT_RUNS = 10;

/**
 * The Pipedrive users the latest run read, each with the team member they go
 * to now (saved choices included). Empty until a run has read the users: there
 * is no Pipedrive call here, so the page answers fast and spends none of the
 * company's Pipedrive budget.
 */
export async function loadUserMappings(): Promise<UserMatch[]> {
  const runs = await prisma.salesImportRun.findMany({ orderBy: { startedAt: "desc" }, take: RECENT_RUNS, select: { cursor: true } });
  const users = runs.map((r) => readCursor(r.cursor).context.users).find((list) => list.length > 0) ?? [];
  if (users.length === 0) return [];
  const [members, overrides] = await Promise.all([
    prisma.teamMember.findMany({ where: SALES_MEMBER_WHERE, select: { id: true, name: true, email: true } }),
    prisma.salesImportUserMap.findMany({ select: { pipedriveUserId: true, memberId: true } }),
  ]);
  return matchPipedriveUsers(users, members, overrides);
}
