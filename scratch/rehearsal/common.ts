import { GUARD_HOST, assertNoBlob } from "./guard";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { continueImportRun } from "@/lib/sales/pipedrive/import";
import type { PipedriveClient } from "@/lib/sales/pipedrive/client";

export { GUARD_HOST, prisma, assertNoBlob };
export const DIR = path.join(process.cwd(), "scratch", "rehearsal");
const STATE = path.join(DIR, "state.json");

export type State = { runIds: string[]; before?: Record<string, number>; stages?: { id: string; position: number; updatedAt: string }[]; auditBefore?: number; startedAt?: string };
export function readState(): State {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { runIds: [] }; }
}
export function saveState(s: State) { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); }
export function recordRun(id: string) { const s = readState(); if (!s.runIds.includes(id)) s.runIds.push(id); saveState(s); }

export const TABLES = ["salesPipeline", "salesStage", "salesOrganization", "salesPerson", "salesLead", "salesDeal", "salesActivity", "salesNote", "salesFile", "salesCustomField", "salesCustomFieldValue", "salesAuditLog", "salesImportUserMap", "salesImportRun", "salesSettings"] as const;
export async function countAll(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = await (prisma[t] as unknown as { count(): Promise<number> }).count();
  return out;
}
export function diff(a: Record<string, number>, b: Record<string, number>) {
  return Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
}

/** Drives a run to done. chunkMs small = forced resumes. Returns chunk stats. */
export async function drive(runId: string, client: PipedriveClient, chunkMs: number, opts: { maxChunks?: number; tick?: number } = {}) {
  assertNoBlob();
  let chunks = 0, zero = 0, paused = 0, last: Awaited<ReturnType<typeof continueImportRun>> | null = null;
  const phasesSeen: string[] = [];
  let prevSig = "";
  for (; chunks < (opts.maxChunks ?? 150); ) {
    const run = await prisma.salesImportRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (run?.status !== "RUNNING") break;
    let ticks = 0;
    const tick = opts.tick ?? 0;
    // tick > 0: virtual clock advancing only when the engine asks the time (real DB latency
    // otherwise eats a 150 ms budget before the first page). tick 0: real time.
    const base = Date.now();
    const now = tick > 0 ? () => new Date(base + tick * ticks++) : () => new Date();
    chunks++;
    last = await continueImportRun({ runId, client, deadline: new Date(base + chunkMs), now });
    if (last.paused) paused++;
    const r = await prisma.salesImportRun.findUnique({ where: { id: runId }, select: { phase: true, cursor: true } });
    const c = (r?.cursor ?? {}) as { source?: number; page?: unknown };
    const sig = `${r?.phase}|${c.source}|${JSON.stringify(c.page)}`;
    if (sig === prevSig) zero++;
    prevSig = sig;
    if (!phasesSeen.includes(String(r?.phase))) phasesSeen.push(String(r?.phase));
    if (last.done) break;
  }
  const run = await prisma.salesImportRun.findUnique({ where: { id: runId } });
  return { chunks, zeroProgress: zero, paused, last, run, phasesSeen };
}

export function issuesOf(run: { issues: unknown }) {
  return (run.issues as { phase: string; message: string; count: number; sampleIds: unknown[] }[]) ?? [];
}
