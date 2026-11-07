import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A deal's final-version files: the upload (server-side, into the PRIVATE Blob
// store, under a name the server makes), the download (only through the app,
// as an attachment, after the deal's who-can-see check) and the soft remove.
// Run against a fake database whose delegates record every call, a fake Blob
// SDK and a fake Sales gate. Nothing reaches a real database, store or session.
// Review Focus 4: a file that lies about itself, and a file link that points
// elsewhere.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

const blob = {
  put: vi.fn<(pathname: string, body: unknown, options: Row) => Promise<unknown>>(),
  get: vi.fn<(pathname: string, options: Row) => Promise<unknown>>(),
  del: vi.fn<(pathname: string) => Promise<void>>(),
};
vi.mock("@vercel/blob", () => blob);

const state = {
  deal: null as Row | null,
  liveFiles: 0,
  todayCount: 0,
  todayBytes: null as number | null,
  file: null as Row | null,
  audits: [] as Row[],
};

/** Whether the deal fixture passes a deal `where` (the who-can-see filter). */
const dealMatches = (deal: Row, where: Row) =>
  deal.archivedAt === where.archivedAt && (where.ownerId === undefined || deal.ownerId === where.ownerId);

const db = {
  salesDeal: {
    findFirst: vi.fn(async (args: Args) => {
      const deal = state.deal;
      if (!deal || deal.id !== args.where.id || !dealMatches(deal, args.where)) return null;
      return deal;
    }),
  },
  salesFile: {
    count: vi.fn<(args: Args) => Promise<number>>(async () => state.liveFiles),
    aggregate: vi.fn<(args: Args) => Promise<unknown>>(async () => ({
      _count: { _all: state.todayCount },
      _sum: { sizeBytes: state.todayBytes },
    })),
    create: vi.fn(async (args: Args) => ({ id: "f-new", createdAt: now, uploadedBy: { name: "Rachel P." }, ...args.data })),
    findFirst: vi.fn(async (args: Args) => {
      const file = state.file;
      const where = args.where;
      if (!file || file.id !== where.id) return null;
      if ("archivedAt" in where && file.archivedAt !== where.archivedAt) return null;
      if (file.dealId === null) return null;
      if (!dealMatches(file.deal as Row, where.deal as Row)) return null;
      return file;
    }),
    updateMany: vi.fn(async (args: Args) => {
      const file = state.file;
      if (!file || file.id !== args.where.id || file.archivedAt !== args.where.archivedAt) return { count: 0 };
      state.file = { ...file, ...args.data };
      return { count: 1 };
    }),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { findFileForDownload, removeDealFile, uploadDealFile } = await import("@/lib/sales/files");
const uploadRoute = await import("@/app/api/sales/deals/[dealId]/files/route");
const fileRoute = await import("@/app/api/sales/files/[fileId]/route");
const { PermissionError } = await import("@/lib/permissions");
const { FILE_MAX_BYTES, FORM_OVERHEAD_BYTES } = await import("@/lib/sales/constants");
const { startOfDay } = await import("@/lib/utils");

const BASE = "http://localhost/api/sales";
const HEADERS = { host: "localhost", "x-forwarded-for": "203.0.113.9" };
const META = { ipAddress: "203.0.113.9", userAgent: null };
const MB = 1024 * 1024;

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
/** A PDF of exactly `size` bytes. */
const pdf = (size = 1000) => {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(ascii("%PDF-1.7\n"));
  return bytes;
};
const zip = (...names: string[]) => ascii(`PK\x03\x04\x14\x00${names.map((name) => `${name}\x00\x00PK\x01\x02`).join("")}`);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const TICK = "Tick the box to confirm this is the final version the client received.";
const WRONG_TYPE = "Only PDF, Word, Excel, PNG or JPG files can be added.";
const STORE_FAILED = "Could not store the file. Try again.";

const dealRow = (extra: Row = {}): Row => ({
  id: "d1",
  ownerId: "r",
  archivedAt: null,
  stage: { name: "Proposal Sent" },
  ...extra,
});
const fileRow = (extra: Row = {}): Row => ({
  id: "f1",
  name: "Signed contract.pdf",
  blobPathname: "sales-files/abc.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  archivedAt: null,
  dealId: "d1",
  deal: { id: "d1", ownerId: "r", archivedAt: null },
  ...extra,
});

const upload = (actor: SalesActor, input: Partial<{ name: string; bytes: Uint8Array; confirmedFinal: boolean }> = {}) =>
  uploadDealFile(actor, "d1", { name: "Signed contract.pdf", bytes: pdf(), confirmedFinal: true, ...input }, META, now);

const writes = () => [
  ...db.salesFile.create.mock.calls,
  ...db.salesFile.updateMany.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];
const errorLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.flat().map((arg) => String(arg));

/** File names must never reach a log line (Sentry reads the server logs). */
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.salesFile.count.mockImplementation(async () => state.liveFiles);
  blob.put.mockReset().mockImplementation(async (pathname: string) => ({
    pathname,
    url: `https://store.private.blob.vercel-storage.com/${pathname}`,
  }));
  blob.get.mockReset().mockResolvedValue(null);
  blob.del.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_only");
  vi.stubEnv("BLOB_STORE_ID", undefined);
  state.deal = dealRow();
  state.liveFiles = 0;
  state.todayCount = 0;
  state.todayBytes = null;
  state.file = fileRow();
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
  consoleError.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("uploadDealFile", () => {
  it("stores a final version privately under a name the server makes", async () => {
    const bytes = pdf(1000);
    const result = await upload(rep, { bytes });

    expect(blob.put).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = blob.put.mock.calls[0];
    expect(pathname).toMatch(/^sales-files\/[0-9a-f-]{36}\.pdf$/);
    expect(new Uint8Array(body as Uint8Array)).toEqual(bytes);
    // Exactly these options: no `token` key, so only the store's own credential is used.
    expect(options).toStrictEqual({ access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/pdf" });

    expect(db.salesFile.create).toHaveBeenCalledTimes(1);
    expect(db.salesFile.create.mock.calls[0][0].data).toEqual({
      name: "Signed contract.pdf",
      blobPathname: pathname,
      contentType: "application/pdf",
      sizeBytes: 1000,
      sha256: sha256(bytes),
      uploadedById: "r",
      dealId: "d1",
      finalConfirmedAt: now,
      stageName: "Proposal Sent",
    });
    expect(state.audits).toEqual([
      {
        actorType: "USER",
        actorId: "r",
        botTokenId: null,
        entityType: "SalesDeal",
        entityId: "d1",
        action: "file_added",
        before: undefined,
        after: { fileId: "f-new", name: "Signed contract.pdf", sizeBytes: 1000, stageName: "Proposal Sent" },
        ipAddress: "203.0.113.9",
        userAgent: null,
      },
    ]);
    expect(result).toEqual({
      ok: true,
      file: {
        id: "f-new",
        name: "Signed contract.pdf",
        sizeBytes: 1000,
        contentType: "application/pdf",
        stageName: "Proposal Sent",
        uploadedBy: "Rachel P.",
        createdAt: "2026-11-05T15:00:00.000Z",
        canRemove: true,
      },
    });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("names a stored file by what its bytes are, cleaning the name it came with", async () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
    await upload(rep, { name: "..\\..\\backups\\logo", bytes: png });

    const [pathname, , options] = blob.put.mock.calls[0];
    expect(pathname).toMatch(/^sales-files\/[0-9a-f-]{36}\.png$/);
    expect(options).toMatchObject({ contentType: "image/png" });
    expect(db.salesFile.create.mock.calls[0][0].data).toMatchObject({ name: "logo.png", contentType: "image/png", sizeBytes: 12 });
  });

  it("asks for the final-version tick", async () => {
    expect(await upload(rep, { confirmedFinal: false })).toEqual({ ok: false, status: 400, error: TICK });
    expect(blob.put).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("refuses a file that lies about its type", async () => {
    const refused = { ok: false, status: 415, error: WRONG_TYPE };

    expect(await upload(rep, { name: "contract.pdf", bytes: ascii("MZ\x90\x00\x03\x00\x00\x00") })).toEqual(refused);
    expect(await upload(rep, { name: "contract.docx", bytes: zip("word/document.xml", "word/vbaProject.bin") })).toEqual(refused);
    expect(await upload(rep, { name: "logo.png", bytes: ascii('<svg xmlns="http://www.w3.org/2000/svg">') })).toEqual(refused);
    expect(blob.put).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("refuses a file over 4 MB even when the route let it through", async () => {
    expect(await upload(rep, { bytes: pdf(FILE_MAX_BYTES + 1) })).toEqual({
      ok: false,
      status: 413,
      error: "Files can be up to 4 MB.",
    });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("keeps to the limits", async () => {
    state.liveFiles = 50;
    expect(await upload(rep)).toEqual({ ok: false, status: 400, error: "This deal already has 50 files. Remove one first." });
    expect(db.salesFile.count.mock.calls[0][0]).toEqual({ where: { dealId: "d1", archivedAt: null } });

    state.liveFiles = 49;
    state.todayCount = 30;
    expect(await upload(rep)).toEqual({ ok: false, status: 400, error: "You can add up to 30 files a day. Try again tomorrow." });

    state.todayCount = 29;
    state.todayBytes = 99 * MB;
    expect(await upload(rep, { bytes: pdf(2 * MB) })).toEqual({
      ok: false,
      status: 400,
      error: "You can add up to 100 MB of files a day. Try again tomorrow.",
    });

    // The day is the app-time day, and removed files count too (no archivedAt filter).
    expect(db.salesFile.aggregate.mock.calls[0][0]).toEqual({
      where: { uploadedById: "r", createdAt: { gte: startOfDay("2026-11-05") } },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    expect(blob.put).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);

    // Exactly at the line still fits: 99 MB today plus a 1 MB file.
    expect(await upload(rep, { bytes: pdf(1 * MB) })).toMatchObject({ ok: true });
  });

  it("cleans up when the database says no after the upload", async () => {
    // A file added a moment earlier fills the deal between the check and the save.
    db.salesFile.count.mockResolvedValueOnce(49).mockResolvedValueOnce(50);
    expect(await upload(rep)).toEqual({ ok: false, status: 400, error: "This deal already has 50 files. Remove one first." });
    const stored = blob.put.mock.calls[0][0];
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect(blob.del).toHaveBeenCalledWith(stored);
    expect(writes()).toEqual([]);

    blob.put.mockClear();
    blob.del.mockClear();
    db.$transaction.mockRejectedValueOnce(new Error('Invalid `prisma.salesFile.create()` invocation: name "Signed contract.pdf"'));
    await expect(upload(rep)).resolves.toEqual({ ok: false, status: 503, error: STORE_FAILED });
    expect(blob.del).toHaveBeenCalledWith(blob.put.mock.calls[0][0]);
    expect(consoleError).toHaveBeenCalled();
    expect(errorLines(consoleError).filter((line) => line.includes("Signed contract"))).toEqual([]);
  });

  it("still answers when removing the orphaned upload fails too", async () => {
    db.$transaction.mockRejectedValueOnce(new Error("connection lost"));
    blob.del.mockRejectedValueOnce(new Error("store unavailable for Signed contract.pdf"));

    await expect(upload(rep)).resolves.toEqual({ ok: false, status: 503, error: STORE_FAILED });
    expect(errorLines(consoleError).filter((line) => line.includes("Signed contract"))).toEqual([]);
  });

  it("says so when storage is missing or failing, without naming the file", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", undefined);
    vi.stubEnv("BLOB_STORE_ID", undefined);
    expect(await upload(rep)).toEqual({ ok: false, status: 503, error: "File storage is not set up yet." });
    expect(blob.put).not.toHaveBeenCalled();

    // A store connected through Vercel's OIDC integration names only its id.
    vi.stubEnv("BLOB_STORE_ID", "store_test_only");
    expect(await upload(rep)).toMatchObject({ ok: true });

    blob.put.mockClear();
    db.salesFile.create.mockClear();
    blob.put.mockRejectedValueOnce(new Error("Vercel Blob: upload of Signed contract.pdf failed"));
    expect(await upload(rep)).toEqual({ ok: false, status: 503, error: STORE_FAILED });
    expect(db.salesFile.create).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    expect(errorLines(consoleError).filter((line) => line.includes("Signed contract"))).toEqual([]);
  });

  it("only the deal owner or an admin adds files", async () => {
    state.deal = dealRow({ ownerId: "b" });
    expect(await upload(seesAll)).toEqual({ ok: false, status: 403, error: "Only the deal owner or an admin can change this deal." });
    expect(await upload(rep)).toEqual({ ok: false, status: 404, error: "Deal not found." });
    expect(db.salesDeal.findFirst.mock.calls.at(-1)?.[0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
    expect(blob.put).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);

    // An admin may add a file to anyone's deal; it counts against the admin's own day.
    expect(await upload(admin)).toMatchObject({ ok: true, file: { canRemove: true } });
    expect(db.salesFile.create.mock.calls[0][0].data).toMatchObject({ uploadedById: "z", dealId: "d1" });
  });

  it("re-checks the edit right inside the save", async () => {
    // The deal is given to someone else between the check and the save.
    db.salesDeal.findFirst.mockResolvedValueOnce(dealRow()).mockResolvedValueOnce(null);

    expect(await upload(rep)).toEqual({ ok: false, status: 404, error: "Deal not found." });
    expect(blob.del).toHaveBeenCalledWith(blob.put.mock.calls[0][0]);
    expect(writes()).toEqual([]);
  });
});

describe("POST /api/sales/deals/[dealId]/files", () => {
  const ctx = { params: Promise.resolve({ dealId: "d1" }) };

  function formRequest(fields: { file?: { bytes: Uint8Array; name: string }; confirmedFinal?: string }, headers: Row = {}) {
    const form = new FormData();
    if (fields.file) form.set("file", new File([fields.file.bytes as BlobPart], fields.file.name, { type: "application/pdf" }));
    if (fields.confirmedFinal !== undefined) form.set("confirmedFinal", fields.confirmedFinal);
    return new Request(`${BASE}/deals/d1/files`, { method: "POST", body: form, headers: { ...HEADERS, ...(headers as Record<string, string>) } });
  }
  const goodForm = (headers: Row = {}) =>
    formRequest({ file: { bytes: pdf(), name: "Signed contract.pdf" }, confirmedFinal: "true" }, headers);

  it("adds the file and answers 201 with it", async () => {
    const request = goodForm();
    const formData = vi.spyOn(request, "formData");
    const res = await uploadRoute.POST(request, ctx);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      file: {
        id: "f-new",
        name: "Signed contract.pdf",
        sizeBytes: 1000,
        contentType: "application/pdf",
        stageName: "Proposal Sent",
        uploadedBy: "Rachel P.",
        createdAt: "2026-11-05T15:00:00.000Z",
        canRemove: true,
      },
    });
    expect(formData).not.toHaveBeenCalled();
    expect(state.audits).toEqual([expect.objectContaining({ action: "file_added", ipAddress: "203.0.113.9" })]);
  });

  it("runs on Node", () => {
    expect(uploadRoute.runtime).toBe("nodejs");
  });

  it("refuses someone without Sales access before reading the body", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const request = goodForm();
    const res = await uploadRoute.POST(request, ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(request.bodyUsed).toBe(false);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("refuses another site's request before reading the body", async () => {
    const request = goodForm({ origin: "https://evil.example" });
    const res = await uploadRoute.POST(request, ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(request.bodyUsed).toBe(false);
    expect(blob.put).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("refuses a body that says it is too big without reading it", async () => {
    const request = goodForm({ "content-length": "6000000" });
    const formData = vi.spyOn(request, "formData");
    const res = await uploadRoute.POST(request, ctx);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Files can be up to 4 MB." });
    expect(formData).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("stops reading a body with no length once it passes the cap", async () => {
    const CHUNK = 64 * 1024;
    let enqueued = 0;
    let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        enqueued += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK));
        if (enqueued >= 5 * MB) controller.close();
      },
      cancel() {
        cancelled += 1;
      },
    });
    const request = new Request(`${BASE}/deals/d1/files`, {
      method: "POST",
      body: stream,
      headers: { ...HEADERS, "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const formData = vi.spyOn(request, "formData");
    const res = await uploadRoute.POST(request, ctx);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Files can be up to 4 MB." });
    expect(cancelled).toBe(1);
    // Read up to the cap and at most a chunk or two past it, never the whole 5 MB.
    expect(enqueued).toBeGreaterThan(FILE_MAX_BYTES + FORM_OVERHEAD_BYTES);
    expect(enqueued).toBeLessThanOrEqual(FILE_MAX_BYTES + FORM_OVERHEAD_BYTES + 2 * CHUNK);
    expect(formData).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("asks for a file when there is none", async () => {
    const res = await uploadRoute.POST(formRequest({ confirmedFinal: "true" }), ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a file first." });
    // A form a browser sends with no file picked carries an empty, nameless entry.
    const empty = new FormData();
    empty.set("file", new File([], ""));
    empty.set("confirmedFinal", "true");
    const res2 = await uploadRoute.POST(
      new Request(`${BASE}/deals/d1/files`, { method: "POST", body: empty, headers: HEADERS }),
      ctx,
    );
    expect(res2.status).toBe(400);
    expect(await res2.json()).toEqual({ error: "Choose a file first." });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("asks for the tick, and refuses a body that is not a form", async () => {
    const res = await uploadRoute.POST(formRequest({ file: { bytes: pdf(), name: "Signed contract.pdf" } }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: TICK });

    const notForm = await uploadRoute.POST(
      new Request(`${BASE}/deals/d1/files`, {
        method: "POST",
        body: "--x\r\nbroken",
        headers: { ...HEADERS, "content-type": "multipart/form-data; boundary=x" },
      }),
      ctx,
    );
    expect(notForm.status).toBe(400);
    expect(await notForm.json()).toEqual({ error: "Choose a file first." });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("refuses a file over 4 MB that fits inside the form allowance", async () => {
    const res = await uploadRoute.POST(
      formRequest({ file: { bytes: pdf(FILE_MAX_BYTES + 10), name: "big.pdf" }, confirmedFinal: "true" }),
      ctx,
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Files can be up to 4 MB." });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("answers a refusal from the service as is", async () => {
    const res = await uploadRoute.POST(
      formRequest({ file: { bytes: ascii("MZ\x90\x00"), name: "contract.pdf" }, confirmedFinal: "true" }),
      ctx,
    );

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: WRONG_TYPE });
  });
});

describe("GET /api/sales/files/[fileId]", () => {
  const ctx = { params: Promise.resolve({ fileId: "f1" }) };
  const download = () => fileRoute.GET(new Request(`${BASE}/files/f1`, { headers: HEADERS }), ctx);
  const stored = (bytes: Uint8Array) => ({
    statusCode: 200,
    stream: new Response(bytes as BlobPart).body,
    headers: new Headers(),
    blob: { contentType: "application/pdf", size: bytes.length, pathname: "sales-files/abc.pdf" },
  });

  it("downloads only through the app, as an attachment", async () => {
    const bytes = pdf();
    blob.get.mockResolvedValue(stored(bytes));
    const res = await download();

    expect(blob.get).toHaveBeenCalledTimes(1);
    expect(blob.get).toHaveBeenCalledWith("sales-files/abc.pdf", { access: "private" });
    expect(db.salesFile.findFirst.mock.calls[0][0].where).toEqual({
      id: "f1",
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null, ownerId: "r" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename=\"Signed contract.pdf\"; filename*=UTF-8''Signed%20contract.pdf",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("an admin's lookup is not narrowed to an owner", async () => {
    requireSalesUserMock.mockResolvedValue(admin);
    blob.get.mockResolvedValue(stored(pdf()));
    state.file = fileRow({ deal: { id: "d1", ownerId: "b", archivedAt: null } });

    expect((await download()).status).toBe(200);
    expect(db.salesFile.findFirst.mock.calls[0][0].where).toEqual({
      id: "f1",
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null },
    });
  });

  it.each([
    ["a removed file", () => (state.file = fileRow({ archivedAt: now }))],
    ["a file on another rep's deal", () => (state.file = fileRow({ deal: { id: "d1", ownerId: "b", archivedAt: null } }))],
    ["a file on a deleted deal", () => (state.file = fileRow({ deal: { id: "d1", ownerId: "r", archivedAt: now } }))],
    ["a lead's file", () => (state.file = fileRow({ dealId: null }))],
  ])("answers 404 for %s, without asking the store", async (_name, arrange) => {
    arrange();
    blob.get.mockResolvedValue(stored(pdf()));
    const res = await download();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found." });
    expect(blob.get).not.toHaveBeenCalled();
  });

  it("answers 404 when the store has no such file", async () => {
    blob.get.mockResolvedValue(null);
    const res = await download();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found." });
  });

  it("never fetches a stored path outside sales-files/", async () => {
    state.file = fileRow({ blobPathname: "backups/2026-11-05.json" });
    blob.get.mockResolvedValue(stored(pdf()));
    const res = await download();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found." });
    expect(blob.get).not.toHaveBeenCalled();
    expect(await findFileForDownload(rep, "f1", db as never)).toBeNull();
  });

  it("says so when storage is not set up", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", undefined);
    const res = await download();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "File storage is not set up yet." });
    expect(blob.get).not.toHaveBeenCalled();
  });

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await download();

    expect(res.status).toBe(403);
    expect(db.salesFile.findFirst).not.toHaveBeenCalled();
    expect(blob.get).not.toHaveBeenCalled();
  });
});

describe("removeDealFile", () => {
  it("removes a file softly", async () => {
    expect(await removeDealFile(rep, "f1", META, now)).toEqual({ ok: true, changed: true });
    expect(db.salesFile.updateMany).toHaveBeenCalledTimes(1);
    expect(db.salesFile.updateMany.mock.calls[0][0]).toEqual({ where: { id: "f1", archivedAt: null }, data: { archivedAt: now } });
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesDeal",
        entityId: "d1",
        action: "file_removed",
        before: { fileId: "f1", name: "Signed contract.pdf" },
        after: undefined,
        actorId: "r",
        ipAddress: "203.0.113.9",
      }),
    ]);

    // Again: already removed, so nothing changes and no second row.
    expect(await removeDealFile(rep, "f1", META, now)).toEqual({ ok: true, changed: false });
    expect(state.audits).toHaveLength(1);
    // The stored bytes stay (a later cleanup removes them).
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("writes no row when another remove wins the race", async () => {
    db.salesFile.updateMany.mockResolvedValueOnce({ count: 0 });

    expect(await removeDealFile(rep, "f1", META, now)).toEqual({ ok: true, changed: false });
    expect(state.audits).toEqual([]);
  });

  it("only the deal owner or an admin removes files", async () => {
    state.file = fileRow({ deal: { id: "d1", ownerId: "b", archivedAt: null } });
    expect(await removeDealFile(seesAll, "f1", META, now)).toEqual({
      ok: false,
      status: 403,
      error: "Only the deal owner or an admin can change this deal.",
    });
    expect(await removeDealFile(rep, "f1", META, now)).toEqual({ ok: false, status: 404, error: "File not found." });
    expect(db.salesFile.findFirst.mock.calls.at(-1)?.[0].where).toEqual({
      id: "f1",
      dealId: { not: null },
      deal: { archivedAt: null, ownerId: "r" },
    });
    expect(db.salesFile.updateMany).not.toHaveBeenCalled();
    expect(state.audits).toEqual([]);

    expect(await removeDealFile(admin, "f1", META, now)).toEqual({ ok: true, changed: true });
    expect(blob.del).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/sales/files/[fileId]", () => {
  const ctx = { params: Promise.resolve({ fileId: "f1" }) };
  const remove = (headers: Row = {}) =>
    fileRoute.DELETE(
      new Request(`${BASE}/files/f1`, { method: "DELETE", headers: { ...HEADERS, ...(headers as Record<string, string>) } }),
      ctx,
    );

  it("removes the file and says whether anything changed", async () => {
    const res = await remove();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });
    expect(state.audits).toEqual([expect.objectContaining({ action: "file_removed", ipAddress: "203.0.113.9" })]);
  });

  it("refuses another site's request and changes nothing", async () => {
    const res = await remove({ origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(writes()).toEqual([]);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("answers 404 for a file the person may not see", async () => {
    state.file = fileRow({ deal: { id: "d1", ownerId: "b", archivedAt: null } });
    const res = await remove();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found." });
    expect(writes()).toEqual([]);
  });
});
