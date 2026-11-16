import fs from "node:fs";
import path from "node:path";
import { GUARD_HOST, prisma, DIR, readState, saveState, recordRun, countAll, diff, drive, issuesOf } from "./common";
import { buildDataset, makeFakeClient, LEAD } from "./fake-client";
import { startImportRun } from "@/lib/sales/pipedrive/import";
import { NO_FILE_STORAGE_ISSUE } from "@/lib/sales/pipedrive/import-state";

const rows: [string, string, string, string][] = [];
function check(step: string, name: string, ok: boolean, observed: unknown) {
  rows.push([step, name, ok ? "PASS" : "FAIL", typeof observed === "string" ? observed : JSON.stringify(observed)]);
}

async function main() {
  console.log("host", GUARD_HOST);
  const members = await prisma.teamMember.findMany({ where: { OR: [{ isAdmin: true }, { canUseSales: true }] }, select: { id: true, email: true }, orderBy: { id: "asc" } });
  const [A, B, C] = members;
  const realEmails = members.map((m) => m.email.toLowerCase());
  const data = buildDataset({ a: A.email, b: B.email });
  const expected = {
    pipelinesCreated: ["REHEARSAL Pipeline"], stagesCreated: ["REHEARSAL Extra Stage (Direct Mail)", "REHEARSAL Stage One", "REHEARSAL Stage Two"],
    customFieldsCreated: ["REHEARSAL Lead Tier"], organizations: 6, persons: 8, deals: { created: 11, skipped: [9000604] },
    leads: 4, activities: { created: 8, skipped: [9000706, 9000710] }, notes: { created: 4, skipped: [9000805, 9000806] },
    files: { created: 0, noStorageIssue: 1 }, users: { matched: [9000001, 9000002], unmatched: [9000003, 9000004] },
  };
  fs.writeFileSync(path.join(DIR, "expected.json"), JSON.stringify(expected, null, 2));

  // ---- Step 3: before snapshot + DRY_RUN ----
  const st = readState();
  const before = await countAll();
  const stages = await prisma.salesStage.findMany({ select: { id: true, position: true, updatedAt: true } });
  if (!st.before) saveState({ ...st, before, stages: stages.map((x) => ({ id: x.id, position: x.position, updatedAt: x.updatedAt.toISOString() })), auditBefore: before.salesAuditLog, startedAt: new Date(Date.now() - 1000).toISOString() });
  console.log("before", JSON.stringify(before));

  const RESUME = process.env.RESUME_RUN;
  if (!RESUME) {
  const { client: dryClient } = makeFakeClient(data);
  const dry = await startImportRun({ mode: "DRY_RUN", isFinal: false, startedById: C.id });
  if (!dry.ok) throw new Error("dry start refused: " + dry.message);
  recordRun(dry.runId);
  const dr = await drive(dry.runId, dryClient, 60_000);
  const afterDry = await countAll();
  const dd = diff(before, afterDry);
  check("3", "DRY_RUN reaches DONE", dr.run?.status === "DONE", `${dr.run?.status} in ${dr.chunks} chunk(s)`);
  check("3", "DRY_RUN writes nothing but its run row", dd.length === 1 && dd[0].startsWith("salesImportRun"), dd.join("; "));
  const dIssues = issuesOf(dr.run!);
  const dText = JSON.stringify(dr.run!.issues) + JSON.stringify(dr.run!.counts);
  check("3", "DRY issues have no real email / token", !realEmails.some((e) => dText.toLowerCase().includes(e)) && !dText.includes("rehearsal-fake-token"), `${dIssues.length} groups; fake-user emails present by design: ${dText.includes("example.invalid")}`);
  console.log("DRY counts", JSON.stringify(dr.run!.counts));
  console.log("DRY issues:"); for (const g of dIssues) console.log(`  [${g.phase}] x${g.count} ${g.message.slice(0, 150)}`);
  }

  // ---- Step 4: LIVE with forced resumes ----
  const { client, requests } = makeFakeClient(data);
  const auditMark = RESUME ? readState().auditBefore! : await prisma.salesAuditLog.count();
  const liveStart = RESUME ? (await prisma.salesImportRun.findUnique({ where: { id: RESUME } }))!.startedAt : new Date();
  const live = RESUME ? { ok: true as const, runId: RESUME } : await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
  if (!live.ok) throw new Error("live start refused: " + live.message);
  recordRun(live.runId);
  const t0 = Date.now();
  const lr = await drive(live.runId, client, 150, { tick: 30 });
  const run = lr.run!;
  const counts = run.counts as Record<string, number>;
  check("4", "LIVE reaches DONE with forced resumes", run.status === "DONE", `${run.status}; ${lr.chunks} chunks, ${lr.zeroProgress} with no progress, ${((Date.now() - t0) / 1000).toFixed(1)}s, ${requests.length} fake requests`);
  console.log("LIVE counts", JSON.stringify(counts));
  const issues = issuesOf(run);
  console.log("LIVE issues:"); for (const g of issues) console.log(`  [${g.phase}] x${g.count} ${JSON.stringify(g.sampleIds)} ${g.message.slice(0, 150)}`);

  const PD = { pipedriveId: { gte: 9000000 } };
  const orgs = await prisma.salesOrganization.findMany({ where: PD });
  const people = await prisma.salesPerson.findMany({ where: PD });
  const deals = await prisma.salesDeal.findMany({ where: PD, include: { stage: true, pipeline: true } });
  const leads = await prisma.salesLead.findMany({ where: { pipedriveId: { startsWith: "90000000-" } } });
  const acts = await prisma.salesActivity.findMany({ where: PD });
  const notes = await prisma.salesNote.findMany({ where: PD });
  const files = await prisma.salesFile.count({ where: PD });
  const by = <T extends { pipedriveId: unknown }>(list: T[], id: unknown) => list.find((x) => x.pipedriveId === id);
  const uniq = (list: { pipedriveId: unknown }[]) => new Set(list.map((x) => x.pipedriveId)).size === list.length;
  check("4", "row counts org/person/deal/lead/act/note/file", orgs.length === 6 && people.length === 8 && deals.length === 11 && leads.length === 4 && acts.length === 8 && notes.length === 4 && files === 0,
    `${orgs.length}/${people.length}/${deals.length}/${leads.length}/${acts.length}/${notes.length}/${files} (exp 6/8/11/4/8/4/0)`);
  check("4", "no duplicate pipedriveIds", [orgs, people, deals, leads, acts, notes].every(uniq), "each id once");
  const o1 = by(orgs, 9000401)!, p1 = by(people, 9000501)!, d1 = by(deals, 9000601)!, d2 = by(deals, 9000602)!;
  check("4", "FKs: person->org, deal->person/org/owner/stage", p1.organizationId === o1.id && d1.personId === p1.id && d1.organizationId === o1.id && d1.ownerId === A.id && d1.stage.name === "New Opt-In" && d1.pipeline.name === "Direct Mail" && d2.ownerId === B.id && d2.stage.name === "Contract Signed" && d2.status === "WON",
    `d1 stage=${d1.stage.name}, d2 ${d2.status}/${d2.stage.name}`);
  const a1 = by(acts, 9000701)!, n1 = by(notes, 9000801)!;
  check("4", "FKs: activity->deal, note->deal", a1.dealId === d1.id && n1.dealId === d1.id, "ok");
  check("4", "HTML note: script removed", !/alert|<script/i.test(n1.body), JSON.stringify(n1.body));
  const d8 = by(deals, 9000608)!, d9 = by(deals, 9000609)!;
  const unmatchedIssue = issues.filter((g) => g.phase === "users");
  check("4", "owners by email; unmatched+deactivated -> starter w/ issue", d8.ownerId === C.id && d9.ownerId === C.id && unmatchedIssue.length === 2 && counts["users.unmatched"] === 2, `users.unmatched=${counts["users.unmatched"]}, ${unmatchedIssue.length} user issues`);
  check("4", "deleted deal skipped", !by(deals, 9000604) && counts["deals.skipped"] === 1, `deals.skipped=${counts["deals.skipped"]}`);
  const d5 = by(deals, 9000605)!, d6 = by(deals, 9000606)!;
  check("4", "zero + EUR deal cents/issues", d5.valueCents === 0 && d6.valueCents === 250000 && issues.some((g) => g.message.includes("EUR")), `0 -> ${d5.valueCents}, EUR 2500 -> ${d6.valueCents}`);
  const dmStages = await prisma.salesStage.findMany({ where: { pipeline: { name: "Direct Mail" } }, orderBy: { position: "asc" } });
  const extra = dmStages.find((s) => s.name === "REHEARSAL Extra Stage");
  const firstWon = Math.min(...dmStages.filter((s) => s.isWon || s.isLost).map((s) => s.position));
  check("4", "unmatched stage created before won/lost", !!extra && extra.position < firstWon && by(deals, 9000607)!.stageId === extra.id, dmStages.map((s) => `${s.position}:${s.name.slice(0, 14)}${s.isWon ? "(W)" : ""}`).join(", "));
  const newPipe = await prisma.salesPipeline.findFirst({ where: { name: "REHEARSAL Pipeline" }, include: { stages: true } });
  check("4", "unmatched pipeline created with its stages", !!newPipe && newPipe.stages.length === 2 && d8.pipelineId === newPipe.id, `${newPipe?.kind} stages=${newPipe?.stages.map((s) => s.position + ":" + s.name).join(",")}`);
  const tier = await prisma.salesCustomField.findFirst({ where: { label: "REHEARSAL Lead Tier" } });
  const tsd = await prisma.salesCustomField.findFirst({ where: { label: "Target Start Date", entity: "DEAL" } });
  const vals = await prisma.salesCustomFieldValue.findMany({ where: { dealId: { in: deals.map((d) => d.id) } }, select: { fieldId: true, dealId: true, value: true } });
  const tierVal = vals.find((v) => v.fieldId === tier?.id && v.dealId === d1.id)?.value;
  const tsdVal = vals.find((v) => v.fieldId === tsd?.id && v.dealId === d1.id)?.value;
  check("4", "new SELECT field created with option LABELS; values saved", tier?.fieldType === "SELECT" && JSON.stringify(tier.options) === '["Gold","Silver"]' && tierVal === "Gold" && tsdVal === "2026-12-01",
    `options=${JSON.stringify(tier?.options)} tier=${tierVal} targetStart=${tsdVal} totalValues=${vals.length}`);
  const leadStat = leads.map((l) => `${l.pipedriveId!.slice(-1)}:${l.status}`).join(",");
  check("4", "leads (no pagination block) all read; archived status", leads.length === 4 && by(leads, LEAD(4))?.status === "ARCHIVED" && leads.filter((l) => l.status === "OPEN").length === 3, `${leadStat} (mapper has no CONVERTED status)`);
  const a7 = by(acts, 9000707)!;
  check("4", "org-only activity -> first person; no-people org skipped", a7.personId === p1.id && !by(acts, 9000706) && !by(acts, 9000710), `activities.skipped=${counts["activities.skipped"]}, midnight=${counts.activitiesAtMidnightUtc}`);
  const fileIssues = issues.filter((g) => g.phase === "files");
  check("4", "files: ONE 'not set up' issue, no SalesFile rows", fileIssues.length === 1 && fileIssues[0].message === NO_FILE_STORAGE_ISSUE && fileIssues[0].count === 1 && files === 0, `${fileIssues.length} file issue(s): ${fileIssues.map((g) => g.message.slice(0, 60))}`);
  const audits = await prisma.salesAuditLog.findMany({ where: { at: { gte: liveStart } }, select: { actorType: true, entityType: true, entityId: true, action: true } });
  const importedIds = new Set([...deals.map((d) => d.id), ...leads.map((l) => l.id)]);
  check("4", "audit: one SYSTEM 'imported' row per deal+lead, nothing else", audits.length === 15 && audits.every((a) => a.actorType === "SYSTEM" && a.action === "imported" && importedIds.has(a.entityId)) && (await prisma.salesAuditLog.count()) - auditMark === 15,
    `${audits.length} new rows: ${[...new Set(audits.map((a) => `${a.actorType}/${a.entityType}/${a.action}`))].join(",")}`);
  check("4", "createdAt from Pipedrive add_time", d1.createdAt.toISOString() === "2025-03-01T10:00:00.000Z" && o1.createdAt.toISOString() === "2025-01-15T10:00:00.000Z", d1.createdAt.toISOString());
  const keysOk = ["organizations.created", "persons.created", "deals.created", "deals.skipped", "leads.created", "activities.created", "notes.created", "files.seen", "users.seen", "pipelines.created", "stages.created", "customFields.created"].every((k) => k in counts);
  check("4", "counts keys + values", keysOk && counts["deals.created"] === 11 && counts["organizations.created"] === 6 && counts["persons.created"] === 8 && counts["leads.created"] === 4 && counts["activities.created"] === 8 && counts["notes.created"] === 4 && counts["pipelines.created"] === 1 && counts["stages.created"] === 3 && counts["customFields.created"] === 1,
    `deals.created=${counts["deals.created"]} stages.created=${counts["stages.created"]} pipelines.created=${counts["pipelines.created"]}`);
  // (i) JSON round trip
  const cur = run.cursor as { context?: { users?: unknown[]; stages?: object; fields?: object } };
  check("6i", "cursor/counts/issues JSON round-trip", Array.isArray(run.issues) && typeof run.counts === "object" && (cur.context?.users?.length ?? 0) === 4 && Object.keys(cur.context?.stages ?? {}).length === 18 && Object.keys(cur.context?.fields ?? {}).length === 2,
    `users=${cur.context?.users?.length} stages=${Object.keys(cur.context?.stages ?? {}).length} fields=${Object.keys(cur.context?.fields ?? {}).length} issues=${issues.length}`);

  // ---- Step 5: re-run idempotent ----
  const snap = async () => {
    const all = [
      ...(await prisma.salesOrganization.findMany({ where: PD, select: { id: true, updatedAt: true } })),
      ...(await prisma.salesPerson.findMany({ where: PD, select: { id: true, updatedAt: true } })),
      ...(await prisma.salesDeal.findMany({ where: PD, select: { id: true, updatedAt: true } })),
      ...(await prisma.salesLead.findMany({ where: { pipedriveId: { startsWith: "90000000-" } }, select: { id: true, updatedAt: true } })),
      ...(await prisma.salesActivity.findMany({ where: PD, select: { id: true, updatedAt: true } })),
      ...(await prisma.salesNote.findMany({ where: PD, select: { id: true, updatedAt: true } })),
    ];
    return new Map(all.map((r) => [r.id, r.updatedAt.toISOString()]));
  };
  const s1 = await snap();
  const before5 = await countAll();
  const re = await startImportRun({ mode: "LIVE", isFinal: false, startedById: C.id });
  if (!re.ok) throw new Error("rerun refused " + re.message);
  recordRun(re.runId);
  const rr = await drive(re.runId, makeFakeClient(data).client, 150, { tick: 30 });
  const rc = rr.run!.counts as Record<string, number>;
  const after5 = await countAll();
  const s2 = await snap();
  const changedRows = [...s1].filter(([id, u]) => s2.get(id) !== u).length;
  const created = Object.entries(rc).filter(([k, v]) => k.endsWith(".created") && v > 0);
  const updated = Object.entries(rc).filter(([k, v]) => k.endsWith(".updated") && v > 0);
  check("5", "re-run DONE, nothing created/updated", rr.run?.status === "DONE" && created.length === 0 && updated.length === 0, `created=${JSON.stringify(created)} updated=${JSON.stringify(updated)} chunks=${rr.chunks}`);
  check("5", "*.unchanged counts", rc["deals.unchanged"] === 11 && rc["organizations.unchanged"] === 6 && rc["persons.unchanged"] === 8 && rc["leads.unchanged"] === 4 && rc["activities.unchanged"] === 8 && rc["notes.unchanged"] === 4,
    Object.entries(rc).filter(([k]) => k.endsWith(".unchanged")).map(([k, v]) => `${k.split(".")[0]}=${v}`).join(" "));
  const tdiff = diff(before5, after5);
  check("5", "updatedAt unchanged on all imported rows; no new rows/audit", changedRows === 0 && tdiff.length === 0, `${changedRows}/${s1.size} rows changed; table diff: ${tdiff.join("; ") || "none"}`);
  console.log("RERUN counts", JSON.stringify(rc));
  console.log("RERUN issues:"); for (const g of issuesOf(rr.run!)) console.log(`  [${g.phase}] x${g.count} ${g.message.slice(0, 110)}`);

  fs.writeFileSync(path.join(DIR, "live-run.json"), JSON.stringify({ liveRunId: live.runId, counts }, null, 2));
  console.log("\nRESULTS");
  for (const r of rows) console.log(r.join(" | "));
}
main().catch((e) => { console.error("ERROR", e?.code, String(e?.stack ?? e).slice(0, 1500)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
