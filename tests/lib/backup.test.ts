import { beforeEach, describe, expect, it, vi } from "vitest";

// Every table read/write below is mocked — these tests never touch a real
// database or a real Vercel Blob store, live or otherwise.
const findManyMocks: Record<string, ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown[]>>>> = {};
const TABLE_MODELS = [
  "teamMember", "clientAccess", "account", "session", "verificationToken", "client", "clientIntake",
  "clientUser", "clientLink", "clientCredential", "clientHighLevelConnection", "conversationMessage",
  "clientNote", "planningFolder", "planningItem", "planningItemLink", "orderTemplate", "clientOrder",
  "meetingNote", "landingPage", "assetFolder", "asset", "assetVersion", "assetReviewer", "assetDecision",
  "assetComment", "assetShareLink", "programTemplate", "stageTemplate", "taskTemplate", "campaign",
  "workflowTemplate", "workflowStageTemplate", "workflowTaskTemplate", "workflowTaskTemplateLink",
  "workflowTaskTemplateAssignee", "workflowFolder", "workflowInstance", "task", "taskAssignee", "comment",
  "taskLink", "activityLog", "notification", "archivedTask",
];
const prismaMock: Record<string, { findMany: (...args: unknown[]) => Promise<unknown[]> }> = {};
for (const model of TABLE_MODELS) {
  findManyMocks[model] = vi.fn(async () => [] as unknown[]);
  prismaMock[model] = { findMany: (...args: unknown[]) => findManyMocks[model](...args) };
}
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const putMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: (...args: unknown[]) => listMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

const { createDatabaseSnapshot, backupDateKey, writeBackupToBlob, pruneOldBackups, BACKUP_VERSION } =
  await import("@/lib/backup");

beforeEach(() => {
  for (const mock of Object.values(findManyMocks)) mock.mockClear().mockResolvedValue([]);
  putMock.mockReset();
  listMock.mockReset();
  delMock.mockReset();
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
});

describe("createDatabaseSnapshot", () => {
  it("reads every table and stamps the current backup version", async () => {
    const now = new Date("2026-08-13T03:00:00.000Z");
    const snapshot = await createDatabaseSnapshot(now);

    expect(snapshot.version).toBe(BACKUP_VERSION);
    expect(snapshot.createdAt).toBe(now.toISOString());
    for (const model of TABLE_MODELS) {
      expect(findManyMocks[model]).toHaveBeenCalledTimes(1);
    }
  });

  it("computes counts that match each table's row array length", async () => {
    findManyMocks.task.mockResolvedValue([{ id: "1" }, { id: "2" }, { id: "3" }]);
    findManyMocks.client.mockResolvedValue([{ id: "c1" }]);

    const snapshot = await createDatabaseSnapshot();

    expect(snapshot.counts.tasks).toBe(3);
    expect(snapshot.tables.tasks).toHaveLength(3);
    expect(snapshot.counts.clients).toBe(1);
    // an untouched table stays at zero, not undefined — the count map must
    // cover every table, not just the ones with rows
    expect(snapshot.counts.notifications).toBe(0);
  });
});

describe("backupDateKey", () => {
  it("formats as a plain YYYY-MM-DD, independent of local timezone", () => {
    expect(backupDateKey(new Date("2026-01-05T23:59:59.000Z"))).toBe("2026-01-05");
  });
});

describe("writeBackupToBlob", () => {
  it("skips the write and reports written:false when no Blob credentials are configured", async () => {
    const result = await writeBackupToBlob({ version: 1, createdAt: "x", counts: {} as never, tables: {} as never }, "2026-08-13");
    expect(result).toEqual({ written: false, pathname: "backups/2026-08-13.json" });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("writes a private, overwritable blob at the dated path when a token is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "fake-token";
    const snapshot = { version: 1, createdAt: "x", counts: {} as never, tables: {} as never };
    const result = await writeBackupToBlob(snapshot, "2026-08-13");

    expect(result).toEqual({ written: true, pathname: "backups/2026-08-13.json" });
    expect(putMock).toHaveBeenCalledWith(
      "backups/2026-08-13.json",
      JSON.stringify(snapshot, null, 2),
      expect.objectContaining({ access: "private", allowOverwrite: true, contentType: "application/json" })
    );
  });

  it("also accepts BLOB_STORE_ID (the OIDC-integration credential shape) as sufficient to proceed", async () => {
    process.env.BLOB_STORE_ID = "store_123";
    const result = await writeBackupToBlob({ version: 1, createdAt: "x", counts: {} as never, tables: {} as never }, "2026-08-13");
    expect(result.written).toBe(true);
  });
});

describe("pruneOldBackups", () => {
  it("returns 0 and never calls the Blob API when unconfigured", async () => {
    const pruned = await pruneOldBackups();
    expect(pruned).toBe(0);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("deletes only blobs older than the retention window, keeping recent ones", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "fake-token";
    const now = new Date("2026-08-13T00:00:00.000Z");
    listMock.mockResolvedValue({
      blobs: [
        { url: "https://blob/old.json", uploadedAt: "2025-01-01T00:00:00.000Z" },
        { url: "https://blob/recent.json", uploadedAt: "2026-08-12T00:00:00.000Z" },
      ],
    });

    const pruned = await pruneOldBackups(365, now);

    expect(pruned).toBe(1);
    expect(delMock).toHaveBeenCalledWith(["https://blob/old.json"]);
  });

  it("skips the delete call entirely when nothing is stale", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "fake-token";
    listMock.mockResolvedValue({ blobs: [{ url: "https://blob/recent.json", uploadedAt: new Date().toISOString() }] });

    const pruned = await pruneOldBackups(365);

    expect(pruned).toBe(0);
    expect(delMock).not.toHaveBeenCalled();
  });
});
