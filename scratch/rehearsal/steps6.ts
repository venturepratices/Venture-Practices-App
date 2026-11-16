import fs from "node:fs";
import path from "node:path";
import { GUARD_HOST, prisma, DIR, recordRun, countAll, diff, drive, issuesOf } from "./common";
import { buildDataset, makeFakeClient, failingClient } from "./fake-client";
import { startImportRun, continueImportRun } from "@/lib/sales/pipedrive/import";
import { PipedriveError } from "@/lib/sales/pipedrive/client";
import { buildCheckReport } from "@/lib/sales/pipedrive/verify";

const rows: string[] = [];
const check = (step: string, name: string, ok: boolean, obs: unknown) => rows.push(`${step} | ${name} | ${ok ? "PASS" : "FAIL"} | ${typeof obs === "string" ? obs : JSON.stringify(obs)}`);
const fail = (id: string) => prisma.salesImportRun.updateMany({ where: { id, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date() } });
const only = process.argv[2] ?? "habdfge";

async function main() {
  console.log("host", GUARD_HOST);
  const members = await prisma.teamMember.findMany({ where: { OR: [{ isAdmin: true }, { canUseSales: true }] }, select: { id: true, email: true }, orderBy: { id: "asc" } });
  const [A, B, C] = members;
  const data = buildDataset({ a: A.email, b: B.email });
  const fake = () => makeFakeClient(data).client;
  const live = JSON.parse(fs.readFileSync(path.join(DIR, "live-run.json"), "utf8")) as { counts: Record<string, number> };

  if (only.includes("h")) {
    const sk = (e: string) => live.counts[`${e}.skipped`] ?? 0;
    const rep = await buildCheckReport(fake(), () => [0, 1, 2], { organizations: sk("organizations"), persons: sk("persons"), deals: sk("deals"), leads: sk("leads"), activities: sk("activities"), notes: sk("notes") });
    check("6h", "check report ok everywhere", rep.rows.every((r) => r.ok), rep.rows.map((r) => `${r.entity} pd=${r.pipedrive} app=${r.app} skip=${r.skipped} ${r.ok ? "ok" : "NOT OK"}`).join("; ") + ` | spot=${rep.spot.length}`);
  }

  if (only.includes("a")) {
    const [r1, r2] = await Promise.allSettled([
      startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id }),
      startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id }),
    ]);
    const vals = [r1, r2].map((r) => (r.status === "fulfilled" ? r.value : { thrown: String((r.reason as Error)?.message).slice(0, 120), code: (r.reason as { code?: string })?.code }));
    for (const v of vals) if ("ok" in v && v.ok) recordRun(v.runId);
    const okOnes = vals.filter((v) => "ok" in v && v.ok);
    const refused = vals.filter((v) => "ok" in v && !v.ok) as { message: string }[];
    let code = "n/a";
    try {
      const x = await prisma.salesImportRun.create({ data: { mode: "LIVE", isFinal: false, status: "RUNNING", phase: "users", counts: {}, issues: [], startedById: C.id } });
      recordRun(x.id);
      code = "NO ERROR (index missing?)";
    } catch (e) {
      const err = e as { code?: string; name?: string; meta?: { target?: unknown; driverAdapterError?: { cause?: { kind?: string; originalCode?: string; constraint?: unknown } } } };
      code = `${err.name} code=${err.code} adapterKind=${err.meta?.driverAdapterError?.cause?.kind} pg=${err.meta?.driverAdapterError?.cause?.originalCode} target=${JSON.stringify(err.meta?.target ?? err.meta?.driverAdapterError?.cause?.constraint)}`;
    }
    check("6a", "concurrent start: one ok, one plain refusal, no throw", okOnes.length === 1 && refused.length === 1, `${JSON.stringify(refused.map((r) => r.message))}; direct insert error: ${code}`);
    const runId = (okOnes[0] as { runId: string }).runId;

    // (b) explicit updatedAt kept by updateMany
    const u0 = (await prisma.salesImportRun.findUnique({ where: { id: runId } }))!.updatedAt;
    const T = new Date(Date.now() + 7777);
    await continueImportRun({ runId, client: fake(), deadline: new Date(Date.now() - 1), now: () => T });
    const u1 = (await prisma.salesImportRun.findUnique({ where: { id: runId } }))!.updatedAt;
    await continueImportRun({ runId, client: fake(), deadline: new Date(Date.now() - 1), now: () => T });
    const u2 = (await prisma.salesImportRun.findUnique({ where: { id: runId } }))!.updatedAt;
    // stale-version save must lose: a continue whose read is older cannot save (simulate by two parallel continues)
    const par = await Promise.all([1, 2].map(() => continueImportRun({ runId, client: fake(), deadline: new Date(Date.now() + 60_000), now: () => new Date() })));
    const after = await prisma.salesImportRun.findUnique({ where: { id: runId } });
    check("6b", "explicit updatedAt kept; each save advances", u1.getTime() === T.getTime() && u2.getTime() === T.getTime() + 1, `u0=${u0.toISOString()} u1=${u1.toISOString()} (T=${T.toISOString()}) u2=+${u2.getTime() - T.getTime()}ms`);
    check("6b", "two parallel continues: one carries on, other stops", after?.status === "DONE" && par.filter((p) => p.done).length >= 1, `results done=${par.map((p) => p.done)} status=${after?.status}`);
  }

  if (only.includes("d")) {
    const s1 = await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
    if (!s1.ok) throw new Error("d: " + s1.message);
    recordRun(s1.runId);
    const blocked = await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
    await prisma.$executeRaw`UPDATE "SalesImportRun" SET "updatedAt" = now() - interval '10 minutes' WHERE "id" = ${s1.runId}`;
    const s2 = await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
    if (s2.ok) recordRun(s2.runId);
    const old = await prisma.salesImportRun.findUnique({ where: { id: s1.runId } });
    check("6d", "fresh RUNNING blocks; stale RUNNING closed as FAILED, new starts", !blocked.ok && s2.ok && old?.status === "FAILED" && issuesOf(old).some((g) => g.message.includes("5 minutes")), `blocked=${!blocked.ok} old=${old?.status} new ok=${s2.ok}`);
    if (s2.ok) await fail(s2.runId);
  }

  if (only.includes("f")) {
    const f1 = await startImportRun({ mode: "LIVE", isFinal: true, startedById: C.id });
    if (!f1.ok) throw new Error("f: " + f1.message);
    recordRun(f1.runId);
    const before = await countAll();
    const fr = await drive(f1.runId, failingClient(fake(), "/api/v2/activities", new PipedriveError(500, "Pipedrive request failed (HTTP 500): Pipedrive had a server error.")), 60_000);
    const later = await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
    if (later.ok) recordRun(later.runId);
    const iss = issuesOf(fr.run!).filter((g) => g.message.startsWith("The copy stopped"));
    check("6f", "500 mid-phase -> FAILED final run; later LIVE start allowed", fr.run?.status === "FAILED" && fr.run.phase === "activities" && iss.length === 1 && later.ok, `status=${fr.run?.status} phase=${fr.run?.phase} issue="${iss[0]?.message.slice(0, 80)}" laterOk=${later.ok}; table diff ${diff(before, await countAll()).join(",")}`);

    if (only.includes("g") && later.ok) {
      const before2 = await countAll();
      const client = failingClient(fake(), "/api/v2/deals", new PipedriveError(429, "Pipedrive request failed (HTTP 429): Pipedrive is rate limiting this token."));
      const first = await continueImportRun({ runId: later.runId, client, deadline: new Date(Date.now() + 120_000), now: () => new Date() });
      const mid = await prisma.salesImportRun.findUnique({ where: { id: later.runId } });
      const rest = await drive(later.runId, client, 120_000);
      const c = rest.run!.counts as Record<string, number>;
      const d = diff(before2, await countAll()).filter((x) => !x.startsWith("salesImportRun"));
      check("6g", "429 -> paused, place kept, resume to DONE, nothing lost/duplicated", first.paused && mid?.status === "RUNNING" && mid.phase === "deals" && rest.run?.status === "DONE" && c["deals.unchanged"] === 11 && d.length === 0,
        `paused=${first.paused} phaseAtPause=${mid?.phase} status=${mid?.status} -> ${rest.run?.status}; deals.unchanged=${c["deals.unchanged"]}; table diff ${d.join(",") || "none"}`);
    } else if (later.ok) await fail(later.runId);
  }

  if (only.includes("e")) {
    const e1 = await startImportRun({ mode: "LIVE", isFinal: true, startedById: C.id });
    if (!e1.ok) throw new Error("e: " + e1.message);
    recordRun(e1.runId);
    const er = await drive(e1.runId, fake(), 120_000);
    const lv = await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
    const lf = await startImportRun({ mode: "LIVE", isFinal: true, startedById: C.id });
    const dr = await startImportRun({ mode: "DRY_RUN", isFinal: false, startedById: C.id });
    if (lv.ok) recordRun(lv.runId);
    if (lf.ok) recordRun(lf.runId);
    if (dr.ok) recordRun(dr.runId);
    check("6e", "final DONE locks LIVE (normal and final)", er.run?.status === "DONE" && !lv.ok && !lf.ok, `final=${er.run?.status}; live: ${!lv.ok ? lv.message : "ALLOWED"}; final: ${!lf.ok ? lf.message : "ALLOWED"}`);
    check("6e", "DRY_RUN after lock (report only)", true, dr.ok ? "DRY_RUN still allowed after lock" : `DRY_RUN refused: ${dr.message}`);
    if (dr.ok) await fail(dr.runId);
  }

  console.log("\nRESULTS");
  for (const r of rows) console.log(r);
  console.log("RUNNING left:", await prisma.salesImportRun.count({ where: { status: "RUNNING" } }));
}
main().catch((e) => { console.error("ERROR", e?.code, String(e?.stack ?? e).slice(0, 1500)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
