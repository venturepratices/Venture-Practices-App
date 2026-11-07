import { beforeEach, describe, expect, it, vi } from "vitest";

// Old audit #11: archiving a private task used to drop isPrivate and
// createdById, so restoring it brought it back visible to everyone. The real
// archive.ts runs here against a mocked database transaction.

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const tx = {
    task: { findUniqueOrThrow: fn(), delete: fn(), create: fn() },
    archivedTask: { create: fn(), findUniqueOrThrow: fn(), delete: fn() },
    teamMember: { findMany: fn() },
    client: { findUnique: fn() },
    taskStatusOption: { findFirst: fn(), findUnique: fn() },
    comment: { createMany: fn() },
    taskLink: { createMany: fn() },
    taskSubtask: { createMany: fn() },
  };
  return { tx, put: fn() };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (callback: (tx: typeof h.tx) => unknown) => callback(h.tx) },
}));
vi.mock("@vercel/blob", () => ({ put: h.put }));

const { archiveTask, restoreArchivedTask } = await import("@/lib/archive");

const NOW = new Date("2026-11-01T10:00:00.000Z");

function liveTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Plan my week",
    description: null,
    clientId: "client-a",
    client: { name: "Client A" },
    occurrence: "NON_RECURRING",
    status: "NEXT_UP",
    statusOption: { label: "Next Up" },
    deadline: null,
    createdAt: NOW,
    updatedAt: NOW,
    isPrivate: false,
    createdById: "creator-1",
    assignees: [{ teamMemberId: "m-1", teamMember: { id: "m-1", name: "Ann" } }],
    comments: [],
    links: [],
    subtasks: [],
    ...overrides,
  };
}

function archivedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "arch-1",
    originalTaskId: "task-1",
    title: "Plan my week",
    description: null,
    assigneeId: "m-1",
    assigneeName: "Ann",
    assignees: { list: [{ id: "m-1", name: "Ann" }], isPrivate: false, createdById: "creator-1" },
    clientId: "client-a",
    clientName: "Client A",
    occurrence: "NON_RECURRING",
    status: "NEXT_UP",
    statusLabel: "Next Up",
    deadline: null,
    taskCreatedAt: NOW,
    taskUpdatedAt: NOW,
    deletedAt: NOW,
    deletedById: "creator-1",
    comments: [],
    links: [],
    subtasks: [],
    ...overrides,
  };
}

/** Team members that still exist; findMany answers with the requested ids found among them. */
function membersThatExist(ids: string[]) {
  h.tx.teamMember.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => ids.includes(id)).map((id) => ({ id }))
  );
}

function createdTaskData() {
  expect(h.tx.task.create).toHaveBeenCalledTimes(1);
  return h.tx.task.create.mock.calls[0][0].data as Record<string, unknown>;
}

beforeEach(() => {
  for (const model of Object.values(h.tx)) {
    for (const method of Object.values(model)) method.mockReset();
  }
  h.put.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;

  h.tx.archivedTask.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "arch-1", ...data }));
  h.tx.client.findUnique.mockResolvedValue({ id: "client-a" });
  h.tx.taskStatusOption.findFirst.mockResolvedValue({ id: "NEXT_UP" });
  h.tx.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "task-new", ...data }));
  membersThatExist(["m-1", "creator-1", "owner-1", "restorer-1"]);
});

describe("archiveTask", () => {
  it("stores a private task's privacy and creator with the snapshot", async () => {
    h.tx.task.findUniqueOrThrow.mockResolvedValue(liveTask({ isPrivate: true, createdById: "owner-1" }));

    await archiveTask("task-1", "owner-1");

    const data = h.tx.archivedTask.create.mock.calls[0][0].data;
    expect(data.assignees).toEqual({ list: [{ id: "m-1", name: "Ann" }], isPrivate: true, createdById: "owner-1" });
    expect(data.assigneeId).toBe("m-1");
    expect(data.assigneeName).toBe("Ann");
  });

  it("stores that a public task is public, with its creator", async () => {
    h.tx.task.findUniqueOrThrow.mockResolvedValue(liveTask({ createdById: null, assignees: [] }));

    await archiveTask("task-1", "someone");

    const data = h.tx.archivedTask.create.mock.calls[0][0].data;
    expect(data.assignees).toEqual({ list: [], isPrivate: false, createdById: null });
  });
});

describe("restoreArchivedTask", () => {
  it("brings a private task back private to its creator", async () => {
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(
      archivedRow({ assignees: { list: [{ id: "m-1", name: "Ann" }], isPrivate: true, createdById: "owner-1" } })
    );

    await restoreArchivedTask("arch-1", "owner-1");

    const data = createdTaskData();
    expect(data.isPrivate).toBe(true);
    expect(data.createdById).toBe("owner-1");
    expect(data.assignees).toEqual({ create: [{ teamMemberId: "m-1" }] });
  });

  it("brings a public task back public with its original creator", async () => {
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(archivedRow());

    await restoreArchivedTask("arch-1", "restorer-1");

    const data = createdTaskData();
    expect(data.isPrivate).toBe(false);
    expect(data.createdById).toBe("creator-1");
  });

  it("leaves the creator empty when that person no longer exists", async () => {
    membersThatExist(["m-1", "restorer-1"]);
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(archivedRow());

    await restoreArchivedTask("arch-1", "restorer-1");

    const data = createdTaskData();
    expect(data.isPrivate).toBe(false);
    expect(data.createdById).toBeNull();
  });

  it("keeps a private task private, to the person restoring it, when its creator no longer exists", async () => {
    membersThatExist(["m-1", "restorer-1"]);
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(
      archivedRow({ assignees: { list: [], isPrivate: true, createdById: "gone-1" } })
    );

    await restoreArchivedTask("arch-1", "restorer-1");

    const data = createdTaskData();
    expect(data.isPrivate).toBe(true);
    expect(data.createdById).toBe("restorer-1");
  });

  it("brings an old snapshot (no privacy record) back private to the person restoring it", async () => {
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(archivedRow({ assignees: [{ id: "m-1", name: "Ann" }] }));

    await restoreArchivedTask("arch-1", "restorer-1");

    const data = createdTaskData();
    expect(data.isPrivate).toBe(true);
    expect(data.createdById).toBe("restorer-1");
    expect(data.assignees).toEqual({ create: [{ teamMemberId: "m-1" }] });
  });

  it("brings an old snapshot deleted before private tasks existed back public, with its assignees", async () => {
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(
      archivedRow({ assignees: [{ id: "m-1", name: "Ann" }], deletedAt: new Date("2026-07-20T09:00:00.000Z") })
    );

    await restoreArchivedTask("arch-1", "restorer-1");

    const data = createdTaskData();
    expect(data.isPrivate).toBe(false);
    // Tasks had no recorded creator before private tasks arrived.
    expect(data.createdById).toBeNull();
    expect(data.assignees).toEqual({ create: [{ teamMemberId: "m-1" }] });
  });

  it("still brings an old snapshot deleted while private tasks were being built back private", async () => {
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(
      archivedRow({ assignees: [{ id: "m-1", name: "Ann" }], deletedAt: new Date("2026-07-30T12:00:00.000Z") })
    );

    await restoreArchivedTask("arch-1", "restorer-1");

    const data = createdTaskData();
    expect(data.isPrivate).toBe(true);
    expect(data.createdById).toBe("restorer-1");
  });

  it("still restores the single legacy assignee of the oldest snapshots", async () => {
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(archivedRow({ assignees: null }));

    await restoreArchivedTask("arch-1", "restorer-1");

    expect(createdTaskData().assignees).toEqual({ create: [{ teamMemberId: "m-1" }] });
  });

  it("still cleans comment text on restore", async () => {
    h.tx.archivedTask.findUniqueOrThrow.mockResolvedValue(
      archivedRow({
        comments: [{ authorName: "Ann", body: '<p>hi</p><img src=x onerror="alert(1)">', createdAt: NOW.toISOString() }],
      })
    );

    await restoreArchivedTask("arch-1", "restorer-1");

    const body = h.tx.comment.createMany.mock.calls[0][0].data[0].body as string;
    expect(body).toContain("<p>hi</p>");
    expect(body).not.toContain("onerror");
  });
});
