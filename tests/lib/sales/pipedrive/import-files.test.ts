import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipedriveError } from "@/lib/sales/pipedrive/client";

import { clock, db, fakeClient, resetDb, salesWrites, seed, store, writes } from "./import-fakes";

// The files step of the Pipedrive import: pages /api/v1/files, copies each file
// onto its deal or lead (one at a time), resumes mid-page, and reports what it
// could not copy. Against the in-memory database, a fake Pipedrive and a fake
// Blob store. Every number is exact: the fixtures are small enough to count by hand.

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const blob = {
  put: vi.fn<(pathname: string, body: unknown, options: Record<string, unknown>) => Promise<unknown>>(),
  del: vi.fn<(pathname: string) => Promise<void>>(),
};
vi.mock("@vercel/blob", () => blob);

const { continueImportRun } = await import("@/lib/sales/pipedrive/import");
const { FILES_PER_DEAL_MAX } = await import("@/lib/sales/constants");

const FAR = new Date("2100-01-01T00:00:00.000Z");
const MB = 1024 * 1024;
const now = () => clock.now;

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const pdf = (size = 1000) => {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(ascii("%PDF-1.7\n"));
  return bytes;
};
const exe = () => Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);

/** One entry of Pipedrive's file list, with the fields the docs name. */
function listed(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    file_name: `Doc ${id}.pdf`,
    name: `Doc ${id}.pdf`,
    file_size: 1000,
    add_time: "2025-03-01 10:00:00",
    active_flag: true,
    deal_id: 300,
    person_id: 0,
    org_id: 0,
    lead_id: null,
    ...over,
  };
}

/** Bytes for each id, so a download of any listed file works. */
function pdfsFor(...ids: number[]): Record<number, Uint8Array> {
  return Object.fromEntries(ids.map((id) => [id, pdf()]));
}

function seedApp() {
  seed(
    "teamMember",
    { id: "starter", name: "Admin A", email: "admin@vp.test", isAdmin: true, canUseSales: true },
    { id: "m1", name: "Ben K", email: "ben@vp.test", isAdmin: false, canUseSales: true },
    { id: "m2", name: "Robert", email: "robert@vp.test", isAdmin: false, canUseSales: true },
  );
  seed("salesPipeline", { id: "dm", key: "direct-mail", name: "Direct Mail", kind: "SALES", position: 1 });
  seed(
    "salesStage",
    { id: "s-new", pipelineId: "dm", key: "new-opt-in", name: "New Opt-In", position: 1, isWon: false, isLost: false },
    { id: "s-demo", pipelineId: "dm", key: "demo", name: "Demo", position: 2, isWon: false, isLost: false },
  );
  seed(
    "salesDeal",
    { id: "d1", pipedriveId: 300, title: "Oak deal", ownerId: "m1", stageId: "s-demo", pipelineId: "dm" },
    { id: "d2", pipedriveId: 301, title: "Pine deal", ownerId: "m2", stageId: "s-new", pipelineId: "dm" },
  );
  seed("salesLead", { id: "l1", pipedriveId: "u-1", title: "Cedar lead", ownerId: "m2" });
}

function seedRun(mode: "LIVE" | "DRY_RUN" = "LIVE") {
  const [run] = seed("salesImportRun", {
    mode,
    isFinal: false,
    status: "RUNNING",
    phase: "files",
    counts: {},
    issues: [],
    cursor: null,
    startedById: "starter",
  });
  return run.id as string;
}

type Carry = {
  downloads?: Record<number, Uint8Array | Error>;
  deadline?: Date;
  onDownload?: (path: string) => void;
  onPage?: (path: string, index: number) => void;
};

async function carry(runId: string, pages: unknown[][], opts: Carry = {}) {
  const fake = fakeClient(
    { "/api/v1/files": pages },
    { downloads: opts.downloads, onDownload: opts.onDownload, onPage: opts.onPage },
  );
  const result = await continueImportRun({ runId, client: fake.client, deadline: opts.deadline ?? FAR, now });
  return { result, ...fake };
}

const runRow = (runId: string) => store.salesImportRun.find((r) => r.id === runId)!;
const issuesOf = (runId: string) => runRow(runId).issues as { phase: string; message: string; count: number; sampleIds: unknown[] }[];
const messagesOf = (runId: string) => issuesOf(runId).map((i) => i.message);
const filesOf = (dealId: string) => store.salesFile.filter((f) => f.dealId === dealId);

const TOO_BIG = "Too big to copy (over 4 MB). Attach it by hand.";
const WRONG_TYPE = "Not a PDF, Word, Excel, PNG or JPG file. Attach it by hand if you need it.";
const NOT_DOWNLOADED =
  "Pipedrive would not let us download it (files kept on an outside service often cannot be copied). Attach it by hand.";
const NO_STORAGE = "File storage is not set up, so no more files were copied.";
// What stands in for the named lines once a run has used up its 30: one counted line per reason.
const MORE_TOO_BIG = "More files than this report can name were too big to copy (over 4 MB). Sort Pipedrive's file list by size to find them.";
const MORE_WRONG_TYPE =
  "More files than this report can name were not a PDF, Word, Excel, PNG or JPG file. Sort Pipedrive's file list by type to find them.";
const MORE_NOT_DOWNLOADED =
  "More files than this report can name could not be downloaded from Pipedrive. Look first at files kept on an outside service.";
const MORE_DEAL_FULL =
  "More files than this report can name were left out because their deal already holds 50 files. Look for deals with a lot of files.";
const MORE_DRY_WRONG_NAME =
  "More files than this report can name have a name that does not end in .pdf, .docx, .xlsx, .png or .jpg, so they may not be copied. The real copy decides by looking inside each file.";
const NOT_SAVED = "Could not save it. Try the copy again.";
const PERSON_OR_ORG = "File is attached to a person or organization; the app keeps files on deals and leads.";

beforeEach(() => {
  resetDb();
  clock.now = new Date("2026-11-12T15:00:00.000Z");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
  vi.stubEnv("BLOB_STORE_ID", "");
  blob.put.mockReset().mockResolvedValue({});
  blob.del.mockReset().mockResolvedValue(undefined);
  db.salesDeal.findMany.mockClear();
  db.salesLead.findMany.mockClear();
  db.salesFile.findMany.mockClear();
  seedApp();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a real run copies files", () => {
  it("puts each file on its deal or lead, uploaded by the owner, with the stage now and the Pipedrive add time", async () => {
    const runId = seedRun();
    const { result, calls, downloads } = await carry(
      runId,
      [[listed(11), listed(12, { deal_id: 301, add_time: "2025-04-02 08:30:00" }), listed(13, { deal_id: null, lead_id: "u-1" })]],
      { downloads: pdfsFor(11, 12, 13) },
    );

    expect(result).toMatchObject({ done: true, paused: false, phase: "done" });
    expect(result.counts).toMatchObject({ "files.seen": 3, "files.created": 3 });
    expect(Object.keys(result.counts).filter((k) => k.startsWith("files.")).sort()).toEqual(["files.created", "files.seen"]);
    expect(calls).toEqual([{ path: "/api/v1/files", resumeAt: undefined, limit: 100, style: "offset" }]);
    expect(downloads).toEqual(["/api/v1/files/11/download", "/api/v1/files/12/download", "/api/v1/files/13/download"]);

    expect(blob.put).toHaveBeenCalledTimes(3);
    for (const [pathname, , options] of blob.put.mock.calls) {
      expect(pathname).toMatch(/^sales-files\/[0-9a-f-]{36}\.pdf$/);
      expect(options).toMatchObject({ access: "private", allowOverwrite: false });
    }

    expect(store.salesFile.find((f) => f.pipedriveId === 11)).toMatchObject({
      name: "Doc 11.pdf",
      dealId: "d1",
      leadId: null,
      uploadedById: "m1",
      stageName: "Demo",
      finalConfirmedAt: new Date("2025-03-01T10:00:00Z"),
      contentType: "application/pdf",
      sizeBytes: 1000,
    });
    expect(store.salesFile.find((f) => f.pipedriveId === 12)).toMatchObject({
      dealId: "d2",
      uploadedById: "m2",
      stageName: "New Opt-In",
      finalConfirmedAt: new Date("2025-04-02T08:30:00Z"),
    });
    expect(store.salesFile.find((f) => f.pipedriveId === 13)).toMatchObject({ dealId: null, leadId: "l1", uploadedById: "m2", stageName: null });

    // The run finished: nothing left to resume from.
    expect(runRow(runId)).toMatchObject({ status: "DONE", cursor: expect.objectContaining({ page: null, source: 0 }) });
    // No history rows and no other table was written for files.
    expect(salesWrites().map((w) => w.table)).toEqual(["salesFile", "salesFile", "salesFile"]);
  });

  it("looks the deals and files up once per page, not once per file", async () => {
    const runId = seedRun();
    await carry(runId, [[listed(11), listed(12), listed(13), listed(14), listed(15)]], { downloads: pdfsFor(11, 12, 13, 14, 15) });
    expect(db.salesDeal.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesLead.findMany).not.toHaveBeenCalled();
    // One for the copied files (skip those already there), one for each deal's file count.
    expect(db.salesFile.findMany).toHaveBeenCalledTimes(2);
  });

  it("skips a file whose Pipedrive id is already copied and counts it unchanged", async () => {
    seed("salesFile", { id: "f-old", pipedriveId: 11, dealId: "d1", name: "old.pdf", archivedAt: null });
    const runId = seedRun();
    const { result, downloads } = await carry(runId, [[listed(11), listed(12)]], { downloads: pdfsFor(11, 12) });

    expect(downloads).toEqual(["/api/v1/files/12/download"]);
    expect(blob.put).toHaveBeenCalledTimes(1);
    expect(store.salesFile).toHaveLength(2);
    expect(result.counts).toMatchObject({ "files.seen": 2, "files.unchanged": 1, "files.created": 1 });
  });

  it("a second run copies nothing and reports every file unchanged", async () => {
    await carry(seedRun(), [[listed(11), listed(12)]], { downloads: pdfsFor(11, 12) });
    blob.put.mockClear();
    store.salesImportRun.length = 0;
    const second = seedRun();
    const { result, downloads } = await carry(second, [[listed(11), listed(12)]], { downloads: pdfsFor(11, 12) });

    expect(downloads).toEqual([]);
    expect(blob.put).not.toHaveBeenCalled();
    expect(store.salesFile).toHaveLength(2);
    expect(result.counts).toMatchObject({ "files.seen": 2, "files.unchanged": 2 });
    expect(result.counts["files.created"]).toBeUndefined();
  });

  it("skips a file kept only on a person or organization, with one grouped issue", async () => {
    const runId = seedRun();
    const { result, downloads } = await carry(
      runId,
      [[listed(11, { deal_id: null, person_id: 5, person_name: "Ann P" }), listed(12, { deal_id: null, org_id: 9 }), listed(13)]],
      { downloads: pdfsFor(11, 12, 13) },
    );

    expect(downloads).toEqual(["/api/v1/files/13/download"]);
    expect(result.counts).toMatchObject({ "files.seen": 3, "files.skipped": 2, "files.created": 1 });
    expect(issuesOf(runId)).toContainEqual({ phase: "files", message: PERSON_OR_ORG, count: 2, sampleIds: [11, 12] });
  });

  it("skips a file on a deal or lead that was not copied, with an issue", async () => {
    const runId = seedRun();
    const { result, downloads } = await carry(
      runId,
      [[listed(11, { deal_id: 999, deal_name: "Ghost deal" }), listed(12, { deal_id: null, lead_id: "u-missing", lead_name: "Ghost lead" })]],
      { downloads: pdfsFor(11, 12) },
    );

    expect(downloads).toEqual([]);
    expect(result.counts).toMatchObject({ "files.seen": 2, "files.skipped": 2 });
    const messages = messagesOf(runId);
    expect(messages).toContain("The file's deal was not copied, so the file was not copied.");
    expect(messages).toContain("The file's lead was not copied, so the file was not copied.");
  });

  it("skips a file attached to nothing a deal, lead, person or organization can hold, with its own issue", async () => {
    const runId = seedRun();
    const { result } = await carry(runId, [[listed(11, { deal_id: null })]], { downloads: pdfsFor(11) });
    expect(result.counts).toMatchObject({ "files.skipped": 1 });
    expect(messagesOf(runId)).toEqual(["File is not attached to a deal or lead; the app keeps files on deals and leads."]);
  });

  it("skips files past the deal limit, naming the file and the deal; removed files do not count", async () => {
    // 48 live files and 1 removed one: room for exactly two more.
    for (let i = 1; i <= 48; i++) seed("salesFile", { id: `f${i}`, pipedriveId: 1000 + i, dealId: "d1", name: `n${i}.pdf`, archivedAt: null });
    seed("salesFile", { id: "f-gone", pipedriveId: 2000, dealId: "d1", name: "gone.pdf", archivedAt: new Date("2025-01-01") });
    const runId = seedRun();
    const { result, downloads } = await carry(runId, [[listed(11), listed(12), listed(13)]], { downloads: pdfsFor(11, 12, 13) });

    expect(FILES_PER_DEAL_MAX).toBe(50);
    expect(downloads).toEqual(["/api/v1/files/11/download", "/api/v1/files/12/download"]);
    expect(filesOf("d1").filter((f) => f.archivedAt === null)).toHaveLength(50);
    expect(result.counts).toMatchObject({ "files.seen": 3, "files.created": 2, "files.skipped": 1 });
    expect(issuesOf(runId)).toContainEqual({
      phase: "files",
      message: 'File "Doc 13.pdf" on "Oak deal": The deal already holds 50 files, so this one was not copied. Attach it by hand if you need it.',
      count: 1,
      sampleIds: [13],
    });
  });

  it("skips a file marked inactive in Pipedrive without an issue, and counts it skipped", async () => {
    const runId = seedRun();
    const { result, downloads } = await carry(runId, [[listed(11, { active_flag: false }), listed(12)]], { downloads: pdfsFor(11, 12) });
    expect(downloads).toEqual(["/api/v1/files/12/download"]);
    expect(result.counts).toMatchObject({ "files.seen": 2, "files.skipped": 1, "files.created": 1 });
    expect(issuesOf(runId)).toEqual([]);
  });

  it("uses the import date when Pipedrive sent no usable add time, with an issue", async () => {
    const runId = seedRun();
    await carry(runId, [[listed(11, { add_time: null })]], { downloads: pdfsFor(11) });
    expect(store.salesFile[0].finalConfirmedAt).toEqual(runRow(runId).startedAt);
    expect(messagesOf(runId)).toContain("The file's added date was missing or unreadable, so the import date was used.");
  });
});

describe("files that cannot be copied", () => {
  it("lists each one with the file and deal named, plain words, and keeps going; the run is never FAILED", async () => {
    const runId = seedRun();
    const { result } = await carry(
      runId,
      [
        [
          listed(11, { file_size: 5 * MB, name: "Big scan.pdf" }),
          listed(12, { name: "setup.exe" }),
          listed(13, { name: "Drive file.pdf" }),
          listed(14),
          listed(15, { deal_id: null, lead_id: "u-1", name: "Lead quote.pdf" }),
        ],
      ],
      { downloads: { 12: exe(), 13: new PipedriveError(403, "Pipedrive refused the request"), 14: pdf(), 15: exe() } },
    );

    expect(runRow(runId).status).toBe("DONE");
    expect(result.counts).toMatchObject({ "files.seen": 5, "files.created": 1, "files.skipped": 4 });
    expect(issuesOf(runId)).toEqual([
      { phase: "files", message: `File "Big scan.pdf" on "Oak deal": ${TOO_BIG}`, count: 1, sampleIds: [11] },
      { phase: "files", message: `File "setup.exe" on "Oak deal": ${WRONG_TYPE}`, count: 1, sampleIds: [12] },
      { phase: "files", message: `File "Drive file.pdf" on "Oak deal": ${NOT_DOWNLOADED}`, count: 1, sampleIds: [13] },
      { phase: "files", message: `File "Lead quote.pdf" on "Cedar lead": ${WRONG_TYPE}`, count: 1, sampleIds: [15] },
    ]);
    // A listed 5 MB file was never downloaded.
    expect(store.salesFile.map((f) => f.pipedriveId)).toEqual([14]);
  });

  it("shows a file name in the report cleaned and short: no direction tricks, no double quotes, cut at 60 characters", async () => {
    const override = String.fromCharCode(0x202e);
    const runId = seedRun();
    await carry(runId, [[
      listed(11, { file_size: 5 * MB, name: `Invoice "x"${override}fdp.exe` }),
      listed(12, { file_size: 5 * MB, name: `${"long ".repeat(20)}end.pdf` }),
    ]]);
    const messages = messagesOf(runId);
    expect(messages[0]).toBe(`File "Invoice 'x' fdp.exe" on "Oak deal": ${TOO_BIG}`);
    expect(messages[1]).toBe(`File "${"long ".repeat(12).trim()}..." on "Oak deal": ${TOO_BIG}`);
    expect(messages.join("")).not.toContain(override);
  });

  it("cleans the deal's title in a line the same way as the file's name", async () => {
    const override = String.fromCharCode(0x202e);
    seed("salesDeal", { id: "d3", pipedriveId: 302, title: `Evil${override}deal`, ownerId: "m1", stageId: "s-demo", pipelineId: "dm" });
    const runId = seedRun();
    await carry(runId, [[listed(11, { deal_id: 302, file_size: 5 * MB })]]);
    expect(messagesOf(runId)).toEqual([`File "Doc 11.pdf" on "Evil deal": ${TOO_BIG}`]);
  });

  it("reports a remote (outside service) file that answers with a web page as not downloadable, not as the wrong type", async () => {
    const runId = seedRun();
    await carry(runId, [[listed(11, { remote_location: "googledrive", remote_id: "abc" })]], { downloads: { 11: ascii("<html>Sign in</html>") } });
    expect(messagesOf(runId)).toEqual([`File "Doc 11.pdf" on "Oak deal": ${NOT_DOWNLOADED}`]);
  });

  it("answers a file the app could not save with a grouped retry issue, and still copies the next one", async () => {
    db.salesFile.create.mockRejectedValueOnce(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const runId = seedRun();
    const { result } = await carry(runId, [[listed(11), listed(12)]], { downloads: pdfsFor(11, 12) });

    expect(result.counts).toMatchObject({ "files.seen": 2, "files.created": 1, "files.skipped": 1 });
    expect(messagesOf(runId)).toEqual([`File "Doc 11.pdf" on "Oak deal": ${NOT_SAVED}`]);
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect(store.salesFile.map((f) => f.pipedriveId)).toEqual([12]);
    expect(runRow(runId).status).toBe("DONE");
  });

  it("without file storage: one issue, no download, no more attempts, and the run still finishes", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const runId = seedRun();
    const pagesServed: number[] = [];
    const { result, downloads } = await carry(runId, [[listed(11), listed(12), listed(13)], [listed(14), listed(15)]], {
      downloads: pdfsFor(11, 12, 13, 14, 15),
      onPage: (_path, index) => pagesServed.push(index),
    });

    expect(downloads).toEqual([]);
    expect(blob.put).not.toHaveBeenCalled();
    expect(store.salesFile).toHaveLength(0);
    expect(issuesOf(runId)).toEqual([{ phase: "files", message: NO_STORAGE, count: 1, sampleIds: [11] }]);
    expect(result).toMatchObject({ done: true });
    expect(runRow(runId).status).toBe("DONE");
    // It stopped asking for more pages once it knew nothing could be stored.
    expect(pagesServed).toEqual([0]);
    expect(result.counts).toMatchObject({ "files.seen": 1, "files.skipped": 1 });
  });

  it("never puts a file name in a console line, even when a failure quotes it", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const quoting = new Error('failed for "Secret client contract.pdf"');
    blob.put.mockRejectedValueOnce(quoting);
    db.salesFile.create.mockRejectedValueOnce(quoting);
    blob.del.mockRejectedValueOnce(quoting);
    const runId = seedRun();
    await carry(
      runId,
      [
        [
          listed(11, { name: "Secret client contract.pdf" }),
          listed(12, { name: "Secret client contract 2.pdf" }),
          listed(13, { name: "Secret client contract 3.exe" }),
          listed(14, { name: "Secret client contract 4.pdf" }),
        ],
      ],
      { downloads: { 11: pdf(), 12: pdf(), 13: exe(), 14: new PipedriveError(404, "gone") } },
    );
    const lines = spies.flatMap((spy) => spy.mock.calls.flat().map((arg) => String(arg)));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("Secret");
  });
});

describe("keeping the report readable", () => {
  const startsNamed = (message: string) => message.startsWith('File "');
  const oversize = (count: number) => Array.from({ length: count }, (_, i) => listed(i + 1, { file_size: 5 * MB }));

  it("names at most 30 files; the rest of a reason is one counted line, and the later kinds still show", async () => {
    // Needs no storage: oversize files are refused by the list alone. The save fails for the last file.
    db.salesFile.create.mockRejectedValueOnce(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const runId = seedRun();
    const { result } = await carry(
      runId,
      [[...oversize(40), listed(41, { deal_id: null, person_id: 5 }), listed(42, { deal_id: 999 }), listed(43)]],
      { downloads: pdfsFor(43) },
    );

    const messages = messagesOf(runId);
    expect(messages.filter((m) => startsNamed(m) && m.endsWith(TOO_BIG))).toHaveLength(30);
    expect(issuesOf(runId)).toContainEqual({ phase: "files", message: MORE_TOO_BIG, count: 10, sampleIds: [31, 32, 33] });
    // The kinds that come after the oversize files are their own groups, not crowded out.
    expect(messages).toContain(PERSON_OR_ORG);
    expect(messages).toContain("The file's deal was not copied, so the file was not copied.");
    expect(messages).toContain(`File "Doc 43.pdf" on "Oak deal": ${NOT_SAVED}`);
    // Every one of the 43 is still counted.
    expect(result.counts).toMatchObject({ "files.seen": 43, "files.skipped": 43 });
    expect(issuesOf(runId)).toHaveLength(30 + 4);
  });

  it("keeps one counted line per reason once the 30 names are used up", async () => {
    for (let i = 1; i <= 50; i++) seed("salesFile", { id: `g${i}`, pipedriveId: 3000 + i, dealId: "d2", name: `n${i}.pdf`, archivedAt: null });
    const runId = seedRun();
    await carry(
      runId,
      [
        [
          ...oversize(30),
          listed(31, { name: "a.exe" }),
          listed(32, { name: "b.exe" }),
          listed(33),
          listed(34, { file_size: 5 * MB }),
          listed(35, { deal_id: 301 }),
        ],
      ],
      { downloads: { 31: exe(), 32: exe(), 33: new PipedriveError(403, "Pipedrive refused the request"), 35: pdf() } },
    );

    const groups = issuesOf(runId);
    expect(groups.filter((g) => startsNamed(g.message))).toHaveLength(30);
    expect(groups).toContainEqual({ phase: "files", message: MORE_TOO_BIG, count: 1, sampleIds: [34] });
    expect(groups).toContainEqual({ phase: "files", message: MORE_WRONG_TYPE, count: 2, sampleIds: [31, 32] });
    expect(groups).toContainEqual({ phase: "files", message: MORE_NOT_DOWNLOADED, count: 1, sampleIds: [33] });
    expect(groups).toContainEqual({ phase: "files", message: MORE_DEAL_FULL, count: 1, sampleIds: [35] });
    expect(groups).toHaveLength(34);
  });

  it("counts named lines saved by an earlier chunk too", async () => {
    const runId = seedRun();
    runRow(runId).issues = Array.from({ length: 29 }, (_, i) => ({
      phase: "files",
      message: `File "Old ${i}.pdf" on "Oak deal": ${TOO_BIG}`,
      count: 1,
      sampleIds: [900 + i],
    }));
    await carry(runId, [[listed(1, { file_size: 5 * MB }), listed(2, { file_size: 5 * MB })]]);
    const groups = issuesOf(runId);
    expect(groups.filter((g) => startsNamed(g.message))).toHaveLength(30);
    expect(groups).toContainEqual({ phase: "files", message: MORE_TOO_BIG, count: 1, sampleIds: [2] });
  });

  it("with no file storage: the one storage line is there too, next to the 30 names and the counted line", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const runId = seedRun();
    await carry(runId, [[...oversize(40), listed(41)]], { downloads: pdfsFor(41) });

    const groups = issuesOf(runId);
    expect(groups.filter((g) => startsNamed(g.message))).toHaveLength(30);
    expect(groups).toContainEqual({ phase: "files", message: MORE_TOO_BIG, count: 10, sampleIds: [31, 32, 33] });
    expect(groups.filter((g) => g.message === NO_STORAGE)).toEqual([{ phase: "files", message: NO_STORAGE, count: 1, sampleIds: [41] }]);
    expect(runRow(runId).status).toBe("DONE");
  });

  it("a practice run keeps to the same 30 names, then one counted line for the names it doubts", async () => {
    const runId = seedRun("DRY_RUN");
    const odd = Array.from({ length: 32 }, (_, i) => listed(i + 1, { name: `old ${i}.exe`, deal_name: "Oak deal" }));
    await carry(runId, [odd]);
    const groups = issuesOf(runId);
    expect(groups.filter((g) => startsNamed(g.message))).toHaveLength(30);
    expect(groups).toContainEqual({ phase: "files", message: MORE_DRY_WRONG_NAME, count: 2, sampleIds: [31, 32] });
  });
});

describe("paging, time and the rate limit", () => {
  it("pauses when the very first file of a chunk hits a rate limit, counts nothing for it, and retries it on the next chunk", async () => {
    const runId = seedRun();
    const page = [listed(11), listed(12)];
    const limited = new PipedriveError(429, "Pipedrive request failed (HTTP 429): Pipedrive is rate limiting this token.");

    const first = await carry(runId, [page], { downloads: { 11: limited, 12: pdf() } });

    expect(first.result).toMatchObject({ done: false, paused: true, phase: "files" });
    expect(first.downloads).toEqual(["/api/v1/files/11/download"]);
    expect(first.result.counts["files.seen"]).toBeUndefined();
    expect(first.result.counts["files.skipped"]).toBeUndefined();
    expect(issuesOf(runId)).toEqual([]);
    expect(store.salesFile).toHaveLength(0);
    expect(runRow(runId).status).toBe("RUNNING");

    const second = await carry(runId, [page], { downloads: pdfsFor(11, 12) });
    expect(second.downloads).toEqual(["/api/v1/files/11/download", "/api/v1/files/12/download"]);
    expect(second.result).toMatchObject({ done: true });
    expect(second.result.counts).toMatchObject({ "files.seen": 2, "files.created": 2 });
  });

  it("stops mid-page when time runs out, then resumes at the next file without redoing finished ones", async () => {
    const runId = seedRun();
    const page = [listed(11), listed(12), listed(13), listed(14), listed(15)];
    // Each download takes 20 seconds; the chunk is allowed 45.
    const slow = { downloads: pdfsFor(11, 12, 13, 14, 15), onDownload: () => void (clock.now = new Date(clock.now.getTime() + 20_000)) };

    const first = await carry(runId, [page], { ...slow, deadline: new Date(clock.now.getTime() + 45_000) });

    // Checked before each file: 0s, 20s and 40s are inside the chunk, 60s is not.
    expect(first.downloads).toEqual(["/api/v1/files/11/download", "/api/v1/files/12/download", "/api/v1/files/13/download"]);
    expect(first.result).toMatchObject({ done: false, paused: false, phase: "files" });
    expect(first.result.counts).toMatchObject({ "files.seen": 3, "files.created": 3 });
    expect(runRow(runId)).toMatchObject({ status: "RUNNING", cursor: expect.objectContaining({ page: { start: 3 } }) });

    const second = await carry(runId, [page], slow);

    expect(second.calls[0].resumeAt).toEqual({ start: 3 });
    expect(second.downloads).toEqual(["/api/v1/files/14/download", "/api/v1/files/15/download"]);
    expect(blob.put).toHaveBeenCalledTimes(5);
    expect(store.salesFile.map((f) => f.pipedriveId)).toEqual([11, 12, 13, 14, 15]);
    // Exact across both chunks: nothing counted twice, nothing counted unchanged.
    expect(second.result).toMatchObject({ done: true });
    expect(second.result.counts).toMatchObject({ "files.seen": 5, "files.created": 5 });
    expect(second.result.counts["files.unchanged"]).toBeUndefined();
  });

  it("always copies at least one file per chunk, even when listing the page used up the time", async () => {
    const runId = seedRun();
    const deadline = new Date(clock.now.getTime() + 45_000);
    const first = await carry(runId, [[listed(11), listed(12)]], {
      downloads: pdfsFor(11, 12),
      deadline,
      onPage: () => void (clock.now = new Date(clock.now.getTime() + 60_000)),
    });
    expect(first.downloads).toEqual(["/api/v1/files/11/download"]);
    expect(first.result).toMatchObject({ done: false });
    expect(runRow(runId).cursor).toMatchObject({ page: { start: 1 } });
  });

  it("saves the start of the next page once a whole page is done, and carries on from there", async () => {
    const runId = seedRun();
    const pages = [[listed(11), listed(12)], [listed(13)]];
    const deadline = new Date(clock.now.getTime() + 45_000);

    const first = await carry(runId, pages, {
      downloads: pdfsFor(11, 12, 13),
      deadline,
      onDownload: (path) => {
        // After the last file of page 1, the chunk is over.
        if (path.endsWith("/12/download")) clock.now = new Date(clock.now.getTime() + 60_000);
      },
    });
    expect(first.downloads).toEqual(["/api/v1/files/11/download", "/api/v1/files/12/download"]);
    expect(first.result).toMatchObject({ done: false });
    expect(runRow(runId).cursor).toMatchObject({ page: { start: 100 } });

    const second = await carry(runId, pages, { downloads: pdfsFor(11, 12, 13) });
    expect(second.calls[0].resumeAt).toEqual({ start: 100 });
    expect(second.downloads).toEqual(["/api/v1/files/13/download"]);
    expect(second.result.counts).toMatchObject({ "files.seen": 3, "files.created": 3 });
  });

  it("pauses on a rate limit while downloading, keeps the files already copied, and picks up at the same file", async () => {
    const runId = seedRun();
    const page = [listed(11), listed(12), listed(13)];
    const limited = new PipedriveError(429, "Pipedrive request failed (HTTP 429): Pipedrive is rate limiting this token.");

    const first = await carry(runId, [page], { downloads: { 11: pdf(), 12: limited, 13: pdf() } });

    expect(first.result).toMatchObject({ done: false, paused: true, phase: "files" });
    expect(first.downloads).toEqual(["/api/v1/files/11/download", "/api/v1/files/12/download"]);
    expect(runRow(runId)).toMatchObject({ status: "RUNNING", cursor: expect.objectContaining({ page: { start: 1 } }) });
    expect(issuesOf(runId)).toEqual([]);
    expect(store.salesFile.map((f) => f.pipedriveId)).toEqual([11]);

    const second = await carry(runId, [page], { downloads: pdfsFor(11, 12, 13) });
    expect(second.downloads).toEqual(["/api/v1/files/12/download", "/api/v1/files/13/download"]);
    expect(second.result).toMatchObject({ done: true });
    expect(second.result.counts).toMatchObject({ "files.seen": 3, "files.created": 3 });
  });

  it("pauses on a rate limit while listing, and fails the run on any other Pipedrive error while listing", async () => {
    const paused = seedRun();
    const rate = fakeClient({}, { failOn: { "/api/v1/files": new PipedriveError(429, "Pipedrive request failed (HTTP 429): Pipedrive is rate limiting this token.") } });
    expect(await continueImportRun({ runId: paused, client: rate.client, deadline: FAR, now })).toMatchObject({ paused: true, done: false });

    store.salesImportRun.length = 0;
    const failed = seedRun();
    const broken = fakeClient({}, { failOn: { "/api/v1/files": new PipedriveError(500, "Pipedrive had a server error") } });
    expect(await continueImportRun({ runId: failed, client: broken.client, deadline: FAR, now })).toMatchObject({ done: false, paused: false });
    expect(runRow(failed).status).toBe("FAILED");
    expect(messagesOf(failed)).toEqual(["The copy stopped: Pipedrive had a server error"]);
  });
});

describe("a practice run (DRY_RUN) with files", () => {
  it("downloads nothing, stores nothing, writes nothing, and flags likely problems from the list alone", async () => {
    seed("salesFile", { id: "f-old", pipedriveId: 11, dealId: "d1", name: "old.pdf", archivedAt: null });
    const runId = seedRun("DRY_RUN");
    writes.length = 0;

    // Nothing is copied yet, so the deal's name can only come from the list itself.
    const onOak = (id: number, over: Record<string, unknown> = {}) => listed(id, { deal_name: "Oak deal", ...over });
    const { result, downloads } = await carry(
      runId,
      [
        [
          onOak(11),
          onOak(12),
          onOak(13, { file_size: 5 * MB, name: "Big scan.pdf" }),
          onOak(14, { name: "setup.exe" }),
          onOak(15, { name: "Notes.DOCX" }),
          onOak(16, { name: "Mystery" }),
          onOak(17, { deal_id: null, org_id: 4 }),
          onOak(18, { active_flag: false }),
        ],
      ],
      { downloads: pdfsFor(11, 12, 13, 14, 15, 16, 17, 18) },
    );

    expect(downloads).toEqual([]);
    expect(blob.put).not.toHaveBeenCalled();
    expect(salesWrites()).toEqual([]);
    expect(store.salesFile).toHaveLength(1);
    // Would copy: 12, 15 (Word), 16 (no extension: the real copy decides). Unchanged: 11. Skipped: 13, 14, 17, 18.
    expect(result.counts).toMatchObject({ "files.seen": 8, "files.unchanged": 1, "files.created": 3, "files.skipped": 4 });

    const messages = messagesOf(runId);
    expect(messages).toContain(
      `File "Big scan.pdf" on "Oak deal": Too big to copy (over 4 MB). Attach it by hand. This is the size Pipedrive lists; the real copy checks the file itself.`,
    );
    expect(messages).toContain(
      'File "setup.exe" on "Oak deal": Its name does not end in .pdf, .docx, .xlsx, .png or .jpg, so it may not be copied. The real copy decides by looking inside the file, not at its name. Attach it by hand if it is not copied.',
    );
    expect(messages).toContain(PERSON_OR_ORG);
    expect(messages).toHaveLength(3);
  });

  it("does not look for deals (nothing is copied yet), so files on deals not copied are still counted as would-copy", async () => {
    store.salesDeal.length = 0;
    const runId = seedRun("DRY_RUN");
    const { result } = await carry(runId, [[listed(11, { deal_name: "Oak deal" })]]);
    expect(result.counts).toMatchObject({ "files.seen": 1, "files.created": 1 });
    expect(issuesOf(runId)).toEqual([]);
    expect(db.salesDeal.findMany).not.toHaveBeenCalled();
  });
});
