// The files step of a Pipedrive import run: pages Pipedrive's file list and copies
// each file onto its deal or lead (src/lib/sales/pipedrive/files.ts does one file).
//
// It reads like the record steps (import-rows.ts), with three differences that
// come from a file being slow:
// - Files are copied one at a time, never in a burst. Each can take seconds, so
//   the time left is checked before each one, and a chunk can end in the middle
//   of a page.
// - The saved place is therefore a position inside the list, not just a page
//   start: after every file the run row is saved with `{ start }` pointing at the
//   next file, and the counts and issues saved with it cover exactly the files
//   before that place. A resume (after the time ran out, or a rate-limit pause)
//   carries on at the next file; nothing is read, counted or copied twice.
// - A rate limit (429) while downloading pauses the run like one while listing
//   does, instead of marking every remaining file as failed.
//
// A file that cannot be copied is reported and skipped; it never fails the run.
// Only a refusal from Pipedrive while LISTING does (the engine decides that).
// Re-running is safe: a file whose Pipedrive id already has a row is left alone.
//
// A file's name appears only in report issues (admins only), never in a thrown
// error or a log line.

import { prisma } from "@/lib/prisma";
import { FILE_MAX_BYTES, FILES_PER_DEAL_MAX } from "@/lib/sales/constants";
import type { PageToken } from "@/lib/sales/pipedrive/client";
import { copyPipedriveFile, type CopyFileFailure } from "@/lib/sales/pipedrive/files";
import { bump, type PhaseResult, type PhaseWork } from "@/lib/sales/pipedrive/import-state";
import { leadRef, parseUtc, refId } from "@/lib/sales/pipedrive/map";

const FILES_PATH = "/api/v1/files";
/** Pipedrive allows at most 100 files per page of this list. */
const FILES_PAGE_LIMIT = 100;

// What the admin reads. The sentences for a file the team must attach by hand
// come after "File "<name>" on "<deal or lead>": ".
const TOO_BIG = "Too big to copy (over 4 MB). Attach it by hand.";
const WRONG_TYPE = "Not a PDF, Word, Excel, PNG or JPG file. Attach it by hand if you need it.";
const NOT_DOWNLOADED =
  "Pipedrive would not let us download it (files kept on an outside service often cannot be copied). Attach it by hand.";
const NOT_SAVED = "Could not save it. Try the copy again.";
const NO_STORAGE = "File storage is not set up yet, so no files were copied.";
const DEAL_FULL = `The deal already holds ${FILES_PER_DEAL_MAX} files, so this one was not copied. Attach it by hand if you need it.`;
const PERSON_OR_ORG = "File is attached to a person or organization; the app keeps files on deals and leads.";
const NOT_ON_DEAL_OR_LEAD = "File is not attached to a deal or lead; the app keeps files on deals and leads.";
const NO_ID = "The file had no usable id in Pipedrive.";
const NO_DATE = "The file's added date was missing or unreadable, so the import date was used.";
const DEAL_NOT_COPIED = "The file's deal was not copied, so the file was not copied.";
const LEAD_NOT_COPIED = "The file's lead was not copied, so the file was not copied.";
// A practice run cannot open the file, so it judges by what the list says and says so.
const DRY_TOO_BIG = `${TOO_BIG} This is the size Pipedrive lists; the real copy checks the file itself.`;
const DRY_WRONG_NAME =
  "Its name does not end in .pdf, .docx, .xlsx, .png or .jpg, so it may not be copied. The real copy decides by looking inside the file, not at its name. Attach it by hand if it is not copied.";

/** Endings the app takes. Word and Excel only in their current forms (.docx, .xlsx). */
const TAKEN_ENDINGS = new Set(["pdf", "docx", "xlsx", "png", "jpg", "jpeg"]);

/** One entry of Pipedrive's file list, read defensively (any field may be missing or the wrong kind). */
type Listed = {
  id: number | null;
  name: string;
  /** The size Pipedrive lists, 0 when it lists none. */
  size: number;
  addedAt: Date | null;
  active: boolean;
  /** Kept on an outside service (Google Drive), which often cannot be downloaded. */
  remote: boolean;
  dealPipedriveId: number | null;
  leadPipedriveId: string | null;
  onPersonOrOrg: boolean;
  /** The deal's or lead's name as the list gives it, for a practice run that has no copied deal to name. */
  parentName: string;
};

/** One line of trimmed text; any control character, direction override or unpaired half of a pair becomes a space. */
function plain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text for a sentence: no double quotes (they mark the quoted parts), short enough not to flood the report. */
function shown(text: string): string {
  const flat = text.replace(/"/g, "'");
  const chars = [...flat];
  return chars.length > 60 ? `${chars.slice(0, 60).join("").trimEnd()}...` : flat;
}

function readListed(raw: Record<string, unknown>): Listed {
  const size = typeof raw.file_size === "number" && Number.isFinite(raw.file_size) && raw.file_size > 0 ? raw.file_size : 0;
  const dealPipedriveId = refId(raw.deal_id);
  const leadPipedriveId = leadRef(raw.lead_id);
  return {
    id: refId(raw.id),
    name: plain(raw.name) || plain(raw.file_name),
    size,
    addedAt: parseUtc(raw.add_time),
    active: raw.active_flag !== false,
    remote: plain(raw.remote_location) !== "",
    dealPipedriveId,
    leadPipedriveId,
    onPersonOrOrg: refId(raw.person_id) !== null || refId(raw.org_id) !== null,
    parentName: dealPipedriveId !== null ? plain(raw.deal_name) : plain(raw.lead_name),
  };
}

/** True when the name ends in something the app does not take (a name with no ending says nothing either way). */
function nameLooksUnsupported(name: string): boolean {
  const ending = /\.([a-z][a-z0-9]{1,7})$/i.exec(name);
  return ending !== null && !TAKEN_ENDINGS.has(ending[1].toLowerCase());
}

/** `File "<name>" on "<deal or lead>": <message>`, so the team can find it and attach it by hand. */
function named(file: Listed, parent: string, message: string): string {
  const label = shown(file.name) || "unnamed file";
  const where = shown(parent);
  return where ? `File "${label}" on "${where}": ${message}` : `File "${label}": ${message}`;
}

// --- What a page needs from the app (one query per kind, never one per file) ---

type Parent = { id: string; ownerId: string; title: string; stageName: string | null };

async function copiedFileIds(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.salesFile.findMany({ where: { pipedriveId: { in: ids } }, select: { pipedriveId: true } });
  return new Set(rows.flatMap((row) => (row.pipedriveId === null ? [] : [row.pipedriveId])));
}

async function copiedDeals(ids: number[]): Promise<Map<number, Parent>> {
  const found = new Map<number, Parent>();
  if (ids.length === 0) return found;
  const deals = await prisma.salesDeal.findMany({
    where: { pipedriveId: { in: ids } },
    select: { id: true, pipedriveId: true, ownerId: true, title: true, stageId: true },
  });
  const stageIds = [...new Set(deals.map((deal) => deal.stageId))];
  const stages = stageIds.length > 0 ? await prisma.salesStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, name: true } }) : [];
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
  for (const deal of deals) {
    if (deal.pipedriveId !== null) {
      found.set(deal.pipedriveId, { id: deal.id, ownerId: deal.ownerId, title: deal.title, stageName: stageName.get(deal.stageId) ?? null });
    }
  }
  return found;
}

async function copiedLeads(ids: string[]): Promise<Map<string, Parent>> {
  const found = new Map<string, Parent>();
  if (ids.length === 0) return found;
  const leads = await prisma.salesLead.findMany({
    where: { pipedriveId: { in: ids } },
    select: { id: true, pipedriveId: true, ownerId: true, title: true },
  });
  for (const lead of leads) {
    if (lead.pipedriveId !== null) found.set(lead.pipedriveId, { id: lead.id, ownerId: lead.ownerId, title: lead.title, stageName: null });
  }
  return found;
}

/** How many live (not removed) files each of these deals holds. */
async function liveFileCounts(dealIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (dealIds.length === 0) return counts;
  const rows = await prisma.salesFile.findMany({ where: { dealId: { in: dealIds }, archivedAt: null }, select: { dealId: true } });
  for (const row of rows) if (row.dealId) counts.set(row.dealId, (counts.get(row.dealId) ?? 0) + 1);
  return counts;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

// --- The step ---

/** How a page ended: every file handled, out of time (or the run was taken over), or no storage so nothing more can be tried. */
type PageOutcome = "done" | "stopped" | "no-storage";

export async function runFilesPhase(work: PhaseWork): Promise<PhaseResult> {
  const resumeAt = work.cursor.page;
  // Where the current page starts in Pipedrive's list; a file's place is this plus its position in the page.
  let pageStart = resumeAt && "start" in resumeAt ? resumeAt.start : 0;
  // Files tried in this request. The first one always runs, so a chunk always moves forward.
  const request = { tried: 0 };

  const batches = work.client.pageBatches<Record<string, unknown>>(FILES_PATH, {
    style: "offset",
    limit: FILES_PAGE_LIMIT,
    ...(resumeAt ? { resumeAt } : {}),
  });
  try {
    for (;;) {
      if (work.outOfTime()) return "stopped";
      const next = await batches.next();
      const items = next.done ? [] : next.value.items;
      const nextPage = next.done ? null : next.value.resumeAt;

      const outcome = await importPage(items, { pageStart, nextPage }, work, request);
      if (outcome === "no-storage") return "finished";
      if (outcome === "stopped") return "stopped";

      work.cursor.page = nextPage;
      if (!(await work.save())) return "stopped";
      if (nextPage === null) break;
      pageStart = "start" in nextPage ? nextPage.start : pageStart + items.length;
    }
  } finally {
    await batches.return(undefined);
  }
  return "finished";
}

async function importPage(
  items: Record<string, unknown>[],
  page: { pageStart: number; nextPage: PageToken | null },
  work: PhaseWork,
  request: { tried: number },
): Promise<PageOutcome> {
  const listed = items.map(readListed);

  // The file ids still to look at, and (real runs) what they link to. A practice run
  // copies nothing, so it has no deals or leads to look up.
  const candidates = listed.filter((file) => file.id !== null && file.active);
  const copied = await copiedFileIds(unique(candidates.flatMap((file) => (file.id === null ? [] : [file.id]))));
  const open = candidates.filter((file) => file.id !== null && !copied.has(file.id));
  const deals = work.live ? await copiedDeals(unique(open.flatMap((file) => (file.dealPipedriveId === null ? [] : [file.dealPipedriveId])))) : new Map<number, Parent>();
  const leads = work.live ? await copiedLeads(unique(open.flatMap((file) => (file.leadPipedriveId === null ? [] : [file.leadPipedriveId])))) : new Map<string, Parent>();
  const onDeal = work.live ? await liveFileCounts([...deals.values()].map((deal) => deal.id)) : new Map<string, number>();

  /** The place of file `index` of this page (the next page's place once the page is used up). */
  const place = (index: number): PageToken | null => (index >= listed.length ? page.nextPage : { start: page.pageStart + index });

  for (let index = 0; index < listed.length; index++) {
    const file = listed[index];

    /** Counts the file and moves the saved place past it, in one step, so a save never sees one without the other. */
    const tally = (kind: "created" | "unchanged" | "skipped", issues: { message: string; exact: boolean }[] = []) => {
      bump(work.counts, "files.seen");
      bump(work.counts, `files.${kind}`);
      for (const issue of issues) work.issues.add({ phase: "files", pipedriveId: file.id, message: issue.message }, { exact: issue.exact });
      work.cursor.page = place(index + 1);
    };
    const skipped = (message: string, exact = false) => tally("skipped", [{ message, exact }]);
    const dateIssues = file.addedAt === null ? [{ message: NO_DATE, exact: false }] : [];

    if (file.id === null) {
      skipped(NO_ID);
      continue;
    }
    // Deleted in Pipedrive: nothing to copy, nothing to report.
    if (!file.active) {
      tally("skipped");
      continue;
    }
    if (copied.has(file.id)) {
      tally("unchanged");
      continue;
    }
    if (file.dealPipedriveId === null && file.leadPipedriveId === null) {
      skipped(file.onPersonOrOrg ? PERSON_OR_ORG : NOT_ON_DEAL_OR_LEAD);
      continue;
    }

    if (!work.live) {
      if (file.size > FILE_MAX_BYTES) skipped(named(file, file.parentName, DRY_TOO_BIG), true);
      else if (nameLooksUnsupported(file.name)) skipped(named(file, file.parentName, DRY_WRONG_NAME), true);
      else tally("created", dateIssues);
      continue;
    }

    const deal = file.dealPipedriveId === null ? undefined : deals.get(file.dealPipedriveId);
    const lead = deal || file.leadPipedriveId === null ? undefined : leads.get(file.leadPipedriveId);
    const parent = deal ?? lead;
    if (!parent) {
      skipped(file.dealPipedriveId !== null ? DEAL_NOT_COPIED : LEAD_NOT_COPIED);
      continue;
    }
    if (deal && (onDeal.get(deal.id) ?? 0) >= FILES_PER_DEAL_MAX) {
      skipped(named(file, parent.title, DEAL_FULL), true);
      continue;
    }

    // Each copy can take seconds, so the time is checked before each one. The place saved is this file's.
    if (request.tried > 0 && work.outOfTime()) {
      await work.save();
      return "stopped";
    }
    request.tried += 1;

    const result = await copyPipedriveFile({
      client: work.client,
      file: { id: file.id, name: file.name, dealId: deal ? deal.id : null, leadId: lead ? lead.id : null, size: file.size },
      uploadedById: parent.ownerId,
      stageName: parent.stageName,
      addedAt: file.addedAt ?? work.fallback,
    });

    if (result.ok) {
      if (deal) onDeal.set(deal.id, (onDeal.get(deal.id) ?? 0) + 1);
      tally("created", dateIssues);
    } else if (result.reason === "no-storage") {
      // Nothing can be stored, so one issue and no more tries: not one issue per file.
      skipped(NO_STORAGE);
      await work.save();
      return "no-storage";
    } else {
      const issue = failureIssue(result.reason, file, parent.title);
      tally("skipped", [issue]);
    }
    // Saved after every file: a chunk that dies loses no copied file's count or place.
    if (!(await work.save())) return "stopped";
  }
  return "done";
}

/** The report line for a file that was not copied. Those the team must attach by hand are listed one by one. */
function failureIssue(reason: Exclude<CopyFileFailure, "no-storage">, file: Listed, parentTitle: string): { message: string; exact: boolean } {
  switch (reason) {
    case "too-big":
      return { message: named(file, parentTitle, TOO_BIG), exact: true };
    case "unsupported-type":
      // A file kept on an outside service often answers with a web page, not the file: that is a download problem.
      return { message: named(file, parentTitle, file.remote ? NOT_DOWNLOADED : WRONG_TYPE), exact: true };
    case "download-failed":
      return { message: named(file, parentTitle, NOT_DOWNLOADED), exact: true };
    case "save-failed":
      return { message: named(file, parentTitle, NOT_SAVED), exact: false };
  }
}
