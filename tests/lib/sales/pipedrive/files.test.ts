import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipedriveError, type PipedriveClient } from "@/lib/sales/pipedrive/client";

// Copying ONE Pipedrive file into the private Blob store. A fake Pipedrive client,
// a fake Blob SDK and a fake database: nothing reaches a real store, network or
// database. The file's name must never reach a thrown error or a log line.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const blob = {
  put: vi.fn<(pathname: string, body: unknown, options: Record<string, unknown>) => Promise<unknown>>(),
  del: vi.fn<(pathname: string) => Promise<void>>(),
};
vi.mock("@vercel/blob", () => blob);

const db = {
  salesFile: { create: vi.fn<(args: { data: Record<string, unknown>; select?: unknown }) => Promise<unknown>>() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { copyPipedriveFile } = await import("@/lib/sales/pipedrive/files");
const { FILE_MAX_BYTES, FILE_PATH_PREFIX } = await import("@/lib/sales/constants");

const MB = 1024 * 1024;
const ADDED = new Date("2025-03-01T10:00:00.000Z");

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
/** A PDF of exactly `size` bytes. */
const pdf = (size = 1000) => {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(ascii("%PDF-1.7\n"));
  return bytes;
};
/** The start of a Windows program: "MZ", then padding. */
const exe = (size = 1000) => {
  const bytes = new Uint8Array(size).fill(0x90);
  bytes.set([0x4d, 0x5a]);
  return bytes;
};
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function fakeClient(serve: () => Promise<{ bytes: Uint8Array; contentType: string }>) {
  const download = vi.fn(serve);
  const client: PipedriveClient = {
    pages: () => {
      throw new Error("not used");
    },
    pageBatches: () => {
      throw new Error("not used");
    },
    download,
  };
  return { client, download };
}

const serving = (bytes: Uint8Array) => fakeClient(async () => ({ bytes, contentType: "application/octet-stream" }));

type FileArg = Parameters<typeof copyPipedriveFile>[0]["file"];

function copy(
  client: PipedriveClient,
  over: Partial<FileArg> = {},
  extra: Partial<Parameters<typeof copyPipedriveFile>[0]> = {},
) {
  return copyPipedriveFile({
    client,
    file: { id: 77, name: "Quote.pdf", dealId: "d1", leadId: null, size: 1000, ...over },
    uploadedById: "m1",
    stageName: "Proposal Sent",
    addedAt: ADDED,
    ...extra,
  });
}

const consoleLines = (spies: { mock: { calls: unknown[][] } }[]) => spies.flatMap((spy) => spy.mock.calls.flat().map((arg) => String(arg)));

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
  vi.stubEnv("BLOB_STORE_ID", "");
  blob.put.mockReset().mockResolvedValue({});
  blob.del.mockReset().mockResolvedValue(undefined);
  db.salesFile.create.mockReset().mockResolvedValue({ id: "f-new" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("copyPipedriveFile", () => {
  it("stores a 1 MB PDF in the private store and writes the row with the exact fields", async () => {
    const bytes = pdf(MB);
    const { client, download } = serving(bytes);

    const result = await copy(client, { size: MB });

    expect(result).toEqual({ ok: true });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith("/v1/files/77/download");

    expect(blob.put).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = blob.put.mock.calls[0];
    expect(pathname).toMatch(new RegExp(`^${FILE_PATH_PREFIX}[0-9a-f-]{36}\\.pdf$`));
    expect(Buffer.isBuffer(body)).toBe(true);
    expect((body as Buffer).byteLength).toBe(MB);
    // The SDK reads its own credential: no token option is ever passed.
    expect(options).toEqual({ access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/pdf" });

    expect(db.salesFile.create).toHaveBeenCalledTimes(1);
    expect(db.salesFile.create.mock.calls[0][0].data).toEqual({
      name: "Quote.pdf",
      blobPathname: pathname,
      contentType: "application/pdf",
      sizeBytes: MB,
      sha256: sha256(bytes),
      uploadedById: "m1",
      dealId: "d1",
      leadId: null,
      finalConfirmedAt: ADDED,
      stageName: "Proposal Sent",
      pipedriveId: 77,
    });
  });

  it("puts a lead's file on the lead, with no stage name", async () => {
    const { client } = serving(pdf());
    const result = await copy(client, { dealId: null, leadId: "l1" }, { stageName: null });
    expect(result).toEqual({ ok: true });
    expect(db.salesFile.create.mock.calls[0][0].data).toMatchObject({ dealId: null, leadId: "l1", stageName: null });
  });

  it("decides the type by the bytes: a PDF named .dat is stored as a PDF, with the real extension on the name", async () => {
    const { client } = serving(pdf());
    const result = await copy(client, { name: "scan.dat" });
    expect(result).toEqual({ ok: true });
    expect(blob.put.mock.calls[0][0]).toMatch(/\.pdf$/);
    expect(db.salesFile.create.mock.calls[0][0].data).toMatchObject({ name: "scan.dat.pdf", contentType: "application/pdf" });
  });

  it("returns too-big for a listed 5 MB file and never downloads it", async () => {
    const { client, download } = serving(pdf());
    const result = await copy(client, { size: 5 * MB });
    expect(result).toEqual({ ok: false, reason: "too-big" });
    expect(download).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
    expect(db.salesFile.create).not.toHaveBeenCalled();
  });

  it("takes a file of exactly 4 MB and refuses one byte more, by the real bytes when the listing was wrong", async () => {
    const exact = serving(pdf(FILE_MAX_BYTES));
    expect(await copy(exact.client, { size: 1000 })).toEqual({ ok: true });

    blob.put.mockClear();
    db.salesFile.create.mockClear();
    const over = serving(pdf(FILE_MAX_BYTES + 1));
    const result = await copy(over.client, { size: 1000 });
    expect(result).toEqual({ ok: false, reason: "too-big" });
    expect(over.download).toHaveBeenCalledTimes(1);
    expect(blob.put).not.toHaveBeenCalled();
    expect(db.salesFile.create).not.toHaveBeenCalled();
  });

  it("returns unsupported-type for a program named .exe and for a .pdf name over non-PDF bytes", async () => {
    const program = serving(exe());
    expect(await copy(program.client, { name: "setup.exe" })).toEqual({ ok: false, reason: "unsupported-type" });

    const liar = serving(exe());
    expect(await copy(liar.client, { name: "Quote.pdf" })).toEqual({ ok: false, reason: "unsupported-type" });

    const page = serving(ascii("<html>Sign in to Google</html>"));
    expect(await copy(page.client, { name: "Quote.pdf" })).toEqual({ ok: false, reason: "unsupported-type" });

    expect(blob.put).not.toHaveBeenCalled();
    expect(db.salesFile.create).not.toHaveBeenCalled();
  });

  it("returns no-storage without throwing and without downloading when there are no Blob credentials", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    const { client, download } = serving(pdf());

    await expect(copy(client)).resolves.toEqual({ ok: false, reason: "no-storage" });
    expect(download).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns too-big before no-storage: the listed size alone decides, nothing else is needed", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const { client } = serving(pdf());
    expect(await copy(client, { size: 5 * MB })).toEqual({ ok: false, reason: "too-big" });
  });

  it("takes the credential from BLOB_STORE_ID too", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "store_abc");
    const { client } = serving(pdf());
    expect(await copy(client)).toEqual({ ok: true });
  });

  it("returns download-failed for a Pipedrive error, any other failure, or an empty reply", async () => {
    const refused = fakeClient(async () => {
      throw new PipedriveError(403, "Pipedrive refused the request");
    });
    expect(await copy(refused.client)).toEqual({ ok: false, reason: "download-failed" });

    const broken = fakeClient(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await copy(broken.client)).toEqual({ ok: false, reason: "download-failed" });

    const empty = serving(new Uint8Array(0));
    expect(await copy(empty.client)).toEqual({ ok: false, reason: "download-failed" });

    expect(blob.put).not.toHaveBeenCalled();
  });

  it("lets a rate limit (429) through, so the run pauses instead of marking every file failed", async () => {
    const limited = fakeClient(async () => {
      throw new PipedriveError(429, "Pipedrive request failed (HTTP 429): Pipedrive is rate limiting this token.");
    });
    await expect(copy(limited.client)).rejects.toMatchObject({ name: "PipedriveError", status: 429 });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns save-failed when the store refuses the upload, and writes no row", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    blob.put.mockRejectedValue(new Error("store down"));
    const { client } = serving(pdf());
    expect(await copy(client)).toEqual({ ok: false, reason: "save-failed" });
    expect(db.salesFile.create).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
    // One fixed line, none of the store's own words.
    expect(errors.mock.calls).toEqual([["Pipedrive file copy: the file store refused an upload."]]);
  });

  it("removes the stored copy and returns save-failed when the row cannot be written", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    db.salesFile.create.mockRejectedValue(new Error("database down"));
    const { client } = serving(pdf());

    expect(await copy(client)).toEqual({ ok: false, reason: "save-failed" });
    expect(blob.put).toHaveBeenCalledTimes(1);
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect(blob.del).toHaveBeenCalledWith(blob.put.mock.calls[0][0]);
    expect(errors.mock.calls).toEqual([["Pipedrive file copy: saving a copied file's record failed; removing the stored copy."]]);
  });

  it("still answers save-failed when removing the stored copy fails too", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    db.salesFile.create.mockRejectedValue(new Error("database down"));
    blob.del.mockRejectedValue(new Error("store down"));
    const { client } = serving(pdf());
    await expect(copy(client)).resolves.toEqual({ ok: false, reason: "save-failed" });
    expect(errors.mock.calls).toEqual([
      ["Pipedrive file copy: saving a copied file's record failed; removing the stored copy."],
      ["Pipedrive file copy: could not remove a stored copy after a failed save."],
    ]);
  });

  it("treats a row another request just wrote (same Pipedrive id) as copied, and removes its own stored copy", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    db.salesFile.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const { client } = serving(pdf());

    expect(await copy(client)).toEqual({ ok: true });
    expect(blob.del).toHaveBeenCalledWith(blob.put.mock.calls[0][0]);
    // Not a failure, so nothing is logged.
    expect(errors).not.toHaveBeenCalled();
  });

  it.each([
    ["a path that climbs out", "../../etc/passwd", "passwd.pdf"],
    ["a Windows path", "C:\\Users\\Ann\\scan.pdf", "scan.pdf"],
    ["no name at all", "", "file.pdf"],
    ["only an extension", ".pdf", "pdf.pdf"],
    // The shared name rules drop a control character (a line break too) outright; a quote is kept.
    ["a quote and a line break", 'Invoice "Q3"\nfinal', 'Invoice "Q3"final.pdf'],
    ["300 characters", "a".repeat(300), `${"a".repeat(196)}.pdf`],
  ])("stores a safe name for %s", async (_label, listedName, stored) => {
    const { client } = serving(pdf());
    expect(await copy(client, { name: listedName })).toEqual({ ok: true });
    const name = String(db.salesFile.create.mock.calls[0][0].data.name);
    expect(name).toBe(stored);
    // However odd the listed name, what is stored has no folder part and no line break, and ends in the real type.
    expect(name).not.toMatch(/[\\/\r\n]/);
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(".pdf")).toBe(true);
    // The name is never part of where the bytes are stored.
    expect(blob.put.mock.calls[0][0]).toMatch(/^sales-files\/[0-9a-f-]{36}\.pdf$/);
  });

  it("keeps the file name and secret-looking text out of every thrown error and console line", async () => {
    const secret = "SECRET-sk_live_abc123";
    const name = `${secret} \u202Efdp.exe\u0007 "quoted" \ud83d\udcc4 ../x.pdf`;
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    const results: unknown[] = [];
    const run = async (client: PipedriveClient) => {
      try {
        results.push(await copy(client, { name }));
      } catch (error) {
        results.push(error);
      }
    };

    // Every failing path, each with an error that QUOTES the name, like a database error can.
    const quoting = new Error(`failed for ${name}`);
    await run(serving(pdf()).client);
    blob.put.mockRejectedValueOnce(quoting);
    await run(serving(pdf()).client);
    db.salesFile.create.mockRejectedValueOnce(quoting);
    blob.del.mockRejectedValueOnce(quoting);
    await run(serving(pdf()).client);
    await run(fakeClient(async () => { throw quoting; }).client);
    await run(serving(exe()).client);
    await run(serving(pdf()).client);

    for (const line of consoleLines(spies)) {
      expect(line).not.toContain(secret);
      expect(line).not.toContain("fdp.exe");
      expect(line).not.toContain("quoted");
    }
    for (const result of results) expect(result instanceof Error).toBe(false);
    // A real file name made it into the stored row (cleaned), and nowhere else.
    const stored = db.salesFile.create.mock.calls.map((c) => String(c[0].data.name));
    expect(stored.every((n) => !n.includes("\u202E") && !n.includes("\u0007"))).toBe(true);
  });
});
