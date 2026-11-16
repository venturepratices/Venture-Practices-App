import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { checkBearer } from "@/lib/secret-compare";
import { continueImportRun, startImportRun } from "@/lib/sales/pipedrive/import";
import { pipedriveClientFromEnv, TOKEN_NOT_SET } from "@/lib/sales/pipedrive/import-check";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro allows up to 300 seconds. We leave headroom to save and answer.
export const maxDuration = 300;

// The whole function may spend this much time on Pipedrive work before it returns
// and lets the next cron pick up the rest. One Pipedrive call still times out at
// RUN_MS below CHUNK_MS, so a slow Pipedrive pauses the run instead of killing the function.
const RUN_MS = 280_000;
// One chunk's time on Pipedrive before the engine pauses. Shared with the admin's
// "Keep going" route so the behavior feels the same whether a person or a cron is driving.
const CHUNK_MS = 45_000;
// Time left before the overall deadline at which we stop starting new chunks.
const WRAP_UP_MS = 5_000;

const SKIP_NOT_ENABLED =
  "Automatic Pipedrive sync is turned off. Set SALES_PIPEDRIVE_SYNC_ENABLED=true in Vercel to turn it on.";
const SKIP_NO_ADMIN = "No admin was found to attribute the sync to.";
const SKIP_LOCKED = "Pipedrive copying is locked (the final copy already finished).";

/**
 * The automatic Pipedrive to Sales sync. Vercel Cron calls this on the schedule
 * in vercel.json. It drives the same engine the admin's "Copy for real" uses,
 * so the two cannot both copy at once (the engine's own partial unique index
 * refuses a second RUNNING run).
 *
 * It only runs when:
 *  - The caller carries `Bearer <CRON_SECRET>`.
 *  - The master switch SALES_PIPEDRIVE_SYNC_ENABLED is exactly "true".
 *  - PIPEDRIVE_API_TOKEN is set.
 *  - The import is not locked (no final LIVE run that finished).
 *  - At least one admin exists to attribute the run to.
 * Each call: resume any RUNNING run first; otherwise start a new LIVE
 * non-final run. Then drive continue() in a loop until done, paused, the time
 * budget runs out, or the engine throws. A time-budget stop leaves the run
 * RUNNING for the next cron to pick up. The engine answers paused when
 * Pipedrive asks us to slow down; we stop at once and the next cron tries again.
 */
export async function GET(request: Request) {
  if (!checkBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.SALES_PIPEDRIVE_SYNC_ENABLED !== "true") {
    return NextResponse.json({ skipped: SKIP_NOT_ENABLED });
  }

  if (!pipedriveClientFromEnv()) {
    return NextResponse.json({ skipped: TOKEN_NOT_SET });
  }

  const locked = await prisma.salesImportRun.findFirst({
    where: { mode: "LIVE", isFinal: true, status: "DONE" },
    select: { id: true },
  });
  if (locked) return NextResponse.json({ skipped: SKIP_LOCKED });

  // Vercel Cron runs under no human user, but the engine stores a startedById for history and the user match.
  // Attribute to the earliest admin, a stable choice that does not change behavior per run.
  const admin = await prisma.teamMember.findFirst({
    where: { isAdmin: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) return NextResponse.json({ skipped: SKIP_NO_ADMIN });

  let runId: string;
  const running = await prisma.salesImportRun.findFirst({
    where: { status: "RUNNING" },
    select: { id: true },
  });
  if (running) {
    runId = running.id;
  } else {
    const started = await startImportRun({ mode: "LIVE", isFinal: false, startedById: admin.id });
    if (!started.ok) {
      // ALREADY_RUNNING race, FINAL_PRACTICE guard or a late lock. The next cron tries again.
      return NextResponse.json({ skipped: started.message });
    }
    runId = started.runId;
  }

  const overall = Date.now() + RUN_MS;
  let done = false;
  let paused = false;
  let phase = "";
  let counts: unknown = {};
  const startedAt = Date.now();

  try {
    while (!done && !paused && Date.now() < overall - WRAP_UP_MS) {
      const deadline = new Date(Math.min(overall, Date.now() + CHUNK_MS));
      const client = pipedriveClientFromEnv(process.env, { deadline });
      if (!client) return NextResponse.json({ ok: false, error: TOKEN_NOT_SET }, { status: 500 });
      const result = await continueImportRun({
        runId,
        client,
        deadline,
        now: () => new Date(),
      });
      done = result.done;
      paused = result.paused;
      phase = result.phase;
      counts = result.counts;
    }
  } catch (error) {
    // Vercel shows a failed cron with a 500; Sentry picks the console.error up with the run id so an
    // admin can look at what the engine left in SalesImportRun. We never try to recover inside the catch.
    console.error("Pipedrive automatic sync failed:", { runId, error });
    return NextResponse.json({ ok: false, runId, error: "sync failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, runId, done, paused, phase, counts, ranMs: Date.now() - startedAt });
}
