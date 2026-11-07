import { beforeEach, describe, expect, it, vi } from "vitest";

// Access rules for the archive (audit H3, old #2, #10, #11): deleted work can
// only be read or restored by staff with archive rights who can see that
// client, and a private task stays visible only to its creator. The real
// permission helpers run against a mocked database, so these tests exercise
// the same checks production does.

// react's cache() only works inside React server rendering; outside of it,
// treat it as a plain pass-through so permissions are re-read every test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const archivedModel = () => ({ findUnique: fn(), findMany: fn() });
  return {
    auth: fn(),
    db: {
      teamMember: { findUnique: fn(), findMany: fn() },
      archivedTask: archivedModel(),
      archivedCampaign: archivedModel(),
      archivedWorkflowInstance: archivedModel(),
      archivedClientNote: archivedModel(),
      archivedMeetingNote: archivedModel(),
    },
    archive: {
      restoreArchivedTask: fn(),
      restoreArchivedCampaign: fn(),
      restoreArchivedWorkflowInstance: fn(),
      restoreArchivedClientNote: fn(),
      restoreArchivedMeetingNote: fn(),
    },
    logActivity: fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/archive", () => h.archive);
vi.mock("@/lib/activity-log", () => ({ logActivity: h.logActivity }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/archive",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { CAPABILITIES } = await import("@/lib/permission-catalog");
const { Prisma } = await import("@/generated/prisma/client");
const taskGet = await import("@/app/api/archived-tasks/[archivedTaskId]/route");
const campaignGet = await import("@/app/api/archived-campaigns/[archivedCampaignId]/route");
const instanceGet = await import("@/app/api/archived-workflow-instances/[archivedInstanceId]/route");
const taskRestore = await import("@/app/api/archived-tasks/[archivedTaskId]/restore/route");
const campaignRestore = await import("@/app/api/archived-campaigns/[archivedCampaignId]/restore/route");
const instanceRestore = await import("@/app/api/archived-workflow-instances/[archivedInstanceId]/restore/route");
const noteRestore = await import("@/app/api/archived-client-notes/[archivedNoteId]/restore/route");
const meetingRestore = await import("@/app/api/archived-meeting-notes/[archivedMeetingNoteId]/restore/route");
const { default: ArchivePage } = await import("@/app/(app)/archive/page");

const STAFF_ID = "member-1";
const VIEW = ["canViewArchive"];
const RESTORE = ["canRestoreArchive"];

function signInAsStaff(options: { clients?: string[]; caps?: string[]; isAdmin?: boolean; allClientsAccess?: boolean } = {}) {
  const caps = Object.fromEntries(CAPABILITIES.map((cap) => [cap, (options.caps ?? []).includes(cap)]));
  h.auth.mockResolvedValue({ user: { id: STAFF_ID, name: "Staff Member" } });
  h.db.teamMember.findUnique.mockResolvedValue({
    id: STAFF_ID,
    isAdmin: options.isAdmin ?? false,
    allClientsAccess: options.allClientsAccess ?? false,
    clientAccess: (options.clients ?? []).map((clientId) => ({ clientId })),
    ...caps,
  });
}

// A client-portal login: a real session, but no TeamMember row behind it.
function signInAsPortalUser(clientId = "client-a") {
  h.auth.mockResolvedValue({ user: { id: "client-user-1", name: "Portal User", isClientUser: true, clientId } });
  h.db.teamMember.findUnique.mockResolvedValue(null);
}

// A removed staff member whose session cookie has not expired yet.
function signInAsRemovedStaff() {
  h.auth.mockResolvedValue({ user: { id: "removed-1", name: "Former Staff" } });
  h.db.teamMember.findUnique.mockResolvedValue(null);
}

const DELETED_AT = new Date("2026-11-01T10:00:00.000Z");
// Snapshots taken before the archive stored privacy hold a plain assignee
// array. Owner decision (DJ, 2026-11-07): they are public, as they were before.
const OLD_SNAPSHOT_PEOPLE = [{ id: "m-1", name: "Ann" }];
const publicPeople = (createdById = "creator-1") => ({ list: [{ id: "m-1", name: "Ann" }], isPrivate: false, createdById });
const privatePeople = (createdById: string) => ({ list: [], isPrivate: true, createdById });

function archivedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "arch-task-1",
    title: "Deleted task",
    clientId: "client-a",
    clientName: "Client A",
    assigneeId: "m-1",
    assigneeName: "Ann",
    assignees: publicPeople(),
    deletedById: "someone-else",
    deletedAt: DELETED_AT,
    deletedBy: { name: "Someone Else" },
    ...overrides,
  };
}

const archivedCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: "arch-campaign-1",
  clientId: "client-a",
  clientName: "Client A",
  name: null,
  sequenceNumber: 1,
  deletedAt: DELETED_AT,
  deletedBy: null,
  ...overrides,
});
const archivedInstance = (overrides: Record<string, unknown> = {}) => ({
  id: "arch-instance-1",
  clientId: "client-a",
  clientName: "Client A",
  name: "Website rebuild",
  archivedTaskCount: 0,
  deletedAt: DELETED_AT,
  deletedBy: null,
  ...overrides,
});
const archivedNote = (overrides: Record<string, unknown> = {}) => ({
  id: "arch-note-1",
  clientId: "client-a",
  clientName: "Client A",
  body: "Note",
  deletedAt: DELETED_AT,
  deletedBy: null,
  ...overrides,
});
const archivedMeeting = (overrides: Record<string, unknown> = {}) => ({
  id: "arch-meeting-1",
  clientId: "client-a",
  clientName: "Client A",
  title: "Kickoff",
  deletedAt: DELETED_AT,
  deletedBy: null,
  ...overrides,
});

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const post = () => new Request("http://localhost/api/archived", { method: "POST" });
const get = () => new Request("http://localhost/api/archived");

const getTask = (id = "arch-task-1") => taskGet.GET(get(), params({ archivedTaskId: id }));
const getCampaign = () => campaignGet.GET(get(), params({ archivedCampaignId: "arch-campaign-1" }));
const getInstance = () => instanceGet.GET(get(), params({ archivedInstanceId: "arch-instance-1" }));

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockReset();
  for (const model of Object.values(h.db)) {
    for (const method of Object.values(model)) method.mockReset();
  }
  for (const method of Object.values(h.archive)) method.mockReset();
  h.db.teamMember.findMany.mockResolvedValue([]);
  for (const model of [h.db.archivedTask, h.db.archivedCampaign, h.db.archivedWorkflowInstance, h.db.archivedClientNote, h.db.archivedMeetingNote]) {
    model.findMany.mockResolvedValue([]);
  }
  h.archive.restoreArchivedTask.mockResolvedValue({ id: "task-new", title: "Deleted task", clientId: "client-a" });
  h.archive.restoreArchivedCampaign.mockResolvedValue({ id: "campaign-new", clientId: "client-a", name: null, sequenceNumber: 2 });
  h.archive.restoreArchivedWorkflowInstance.mockResolvedValue({ id: "instance-new", name: "Website rebuild", clientId: "client-a" });
  h.archive.restoreArchivedClientNote.mockResolvedValue({ id: "note-new", clientId: "client-a" });
  h.archive.restoreArchivedMeetingNote.mockResolvedValue({ id: "meeting-new", clientId: "client-a" });
});

describe("GET /api/archived-tasks/[archivedTaskId]", () => {
  it("refuses a client-portal login before looking anything up", async () => {
    signInAsPortalUser();
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask());

    expect((await getTask()).status).toBe(401);
    expect(h.db.archivedTask.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a removed staff member whose session is still alive", async () => {
    signInAsRemovedStaff();
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask());

    expect((await getTask()).status).toBe(401);
  });

  it("refuses staff without archive rights", async () => {
    signInAsStaff({ clients: ["client-a"] });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask());

    expect((await getTask()).status).toBe(403);
    expect(h.db.archivedTask.findUnique).not.toHaveBeenCalled();
  });

  it("refuses staff with archive rights but not that client", async () => {
    signInAsStaff({ clients: ["client-b"], caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask());

    expect((await getTask()).status).toBe(403);
  });

  it("refuses a client that was deleted to staff limited to specific clients", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ clientId: "deleted-client" }));

    expect((await getTask()).status).toBe(403);
  });

  it("returns the snapshot to staff with archive rights and that client", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask());

    const response = await getTask();
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("arch-task-1");
  });

  it("returns any client's snapshot to an admin", async () => {
    signInAsStaff({ isAdmin: true });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ clientId: "client-z" }));

    expect((await getTask()).status).toBe(200);
  });

  it("returns an internal (no client) snapshot to staff with archive rights, as live internal tasks are", async () => {
    signInAsStaff({ caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ clientId: null, clientName: null }));

    expect((await getTask()).status).toBe(200);
  });

  it("hides another person's private task, even from an admin", async () => {
    signInAsStaff({ isAdmin: true });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: privatePeople("owner-9"), deletedById: STAFF_ID }));

    expect((await getTask()).status).toBe(404);
  });

  it("shows a private task to its creator", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: privatePeople(STAFF_ID) }));

    expect((await getTask()).status).toBe(200);
  });

  it("shows an old snapshot (no privacy record) deleted by someone else to staff with archive rights and that client", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: OLD_SNAPSHOT_PEOPLE }));
    expect((await getTask()).status).toBe(200);

    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: null, deletedById: null }));
    expect((await getTask()).status).toBe(200);
  });

  it("still refuses an old snapshot to staff without that client", async () => {
    signInAsStaff({ clients: ["client-b"], caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: OLD_SNAPSHOT_PEOPLE }));

    expect((await getTask()).status).toBe(403);
  });

  it("answers 404 for an unknown id", async () => {
    signInAsStaff({ caps: VIEW });
    h.db.archivedTask.findUnique.mockResolvedValue(null);

    expect((await getTask("missing")).status).toBe(404);
  });
});

describe.each([
  { label: "GET /api/archived-campaigns/[id]", model: () => h.db.archivedCampaign, row: archivedCampaign, call: getCampaign },
  { label: "GET /api/archived-workflow-instances/[id]", model: () => h.db.archivedWorkflowInstance, row: archivedInstance, call: getInstance },
])("$label", ({ model, row, call }) => {
  it("refuses a client-portal login before looking anything up", async () => {
    signInAsPortalUser();
    model().findUnique.mockResolvedValue(row());

    expect((await call()).status).toBe(401);
    expect(model().findUnique).not.toHaveBeenCalled();
  });

  it("refuses a removed staff member whose session is still alive", async () => {
    signInAsRemovedStaff();
    model().findUnique.mockResolvedValue(row());

    expect((await call()).status).toBe(401);
  });

  it("refuses staff without archive rights", async () => {
    signInAsStaff({ clients: ["client-a"] });
    model().findUnique.mockResolvedValue(row());

    expect((await call()).status).toBe(403);
  });

  it("refuses staff with archive rights but not that client", async () => {
    signInAsStaff({ clients: ["client-b"], caps: VIEW });
    model().findUnique.mockResolvedValue(row());

    expect((await call()).status).toBe(403);
  });

  it("returns the snapshot to staff with archive rights and that client", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });
    model().findUnique.mockResolvedValue(row());

    expect((await call()).status).toBe(200);
  });

  it("answers 404 for an unknown id", async () => {
    signInAsStaff({ caps: VIEW, isAdmin: true });
    model().findUnique.mockResolvedValue(null);

    expect((await call()).status).toBe(404);
  });
});

describe("GET /api/archived-workflow-instances/[id] for an internal project", () => {
  it("returns it to staff with archive rights, as live internal projects are", async () => {
    signInAsStaff({ caps: VIEW });
    h.db.archivedWorkflowInstance.findUnique.mockResolvedValue(archivedInstance({ clientId: null, clientName: null }));

    expect((await getInstance()).status).toBe(200);
  });
});

describe.each([
  {
    label: "task",
    model: () => h.db.archivedTask,
    row: archivedTask,
    restore: () => h.archive.restoreArchivedTask,
    call: () => taskRestore.POST(post(), params({ archivedTaskId: "arch-task-1" })),
  },
  {
    label: "campaign",
    model: () => h.db.archivedCampaign,
    row: archivedCampaign,
    restore: () => h.archive.restoreArchivedCampaign,
    call: () => campaignRestore.POST(post(), params({ archivedCampaignId: "arch-campaign-1" })),
  },
  {
    label: "project",
    model: () => h.db.archivedWorkflowInstance,
    row: archivedInstance,
    restore: () => h.archive.restoreArchivedWorkflowInstance,
    call: () => instanceRestore.POST(post(), params({ archivedInstanceId: "arch-instance-1" })),
  },
  {
    label: "client note",
    model: () => h.db.archivedClientNote,
    row: archivedNote,
    restore: () => h.archive.restoreArchivedClientNote,
    call: () => noteRestore.POST(post(), params({ archivedNoteId: "arch-note-1" })),
  },
  {
    label: "meeting note",
    model: () => h.db.archivedMeetingNote,
    row: archivedMeeting,
    restore: () => h.archive.restoreArchivedMeetingNote,
    call: () => meetingRestore.POST(post(), params({ archivedMeetingNoteId: "arch-meeting-1" })),
  },
])("restoring an archived $label", ({ model, row, restore, call }) => {
  it("refuses staff with restore rights but not that client, and restores nothing", async () => {
    signInAsStaff({ clients: ["client-b"], caps: RESTORE });
    model().findUnique.mockResolvedValue(row());

    expect((await call()).status).toBe(403);
    expect(restore()).not.toHaveBeenCalled();
  });

  it("refuses a client-portal login", async () => {
    signInAsPortalUser();
    model().findUnique.mockResolvedValue(row());

    expect((await call()).status).toBe(401);
    expect(restore()).not.toHaveBeenCalled();
  });

  it("restores for staff with restore rights and that client", async () => {
    signInAsStaff({ clients: ["client-a"], caps: RESTORE });
    model().findUnique.mockResolvedValue(row({ deletedById: STAFF_ID }));

    expect((await call()).status).toBe(201);
    expect(restore()).toHaveBeenCalledTimes(1);
  });

  it("restores any client's work for an admin", async () => {
    signInAsStaff({ isAdmin: true });
    model().findUnique.mockResolvedValue(row({ clientId: "client-z", deletedById: STAFF_ID }));

    expect((await call()).status).toBe(201);
  });
});

describe("restoring an archived task's privacy", () => {
  const restoreTask = () => taskRestore.POST(post(), params({ archivedTaskId: "arch-task-1" }));

  it("hides another person's private task, even from an admin, and restores nothing", async () => {
    signInAsStaff({ isAdmin: true });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: privatePeople("owner-9"), deletedById: STAFF_ID }));

    expect((await restoreTask()).status).toBe(404);
    expect(h.archive.restoreArchivedTask).not.toHaveBeenCalled();
  });

  it("lets staff with restore rights and that client restore an old snapshot (no privacy record) someone else deleted", async () => {
    signInAsStaff({ clients: ["client-a"], caps: RESTORE });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: OLD_SNAPSHOT_PEOPLE }));

    expect((await restoreTask()).status).toBe(201);
    expect(h.archive.restoreArchivedTask).toHaveBeenCalledWith("arch-task-1", STAFF_ID);
  });

  it("lets an admin restore a teammate's old snapshot", async () => {
    signInAsStaff({ isAdmin: true });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: OLD_SNAPSHOT_PEOPLE }));

    expect((await restoreTask()).status).toBe(201);
  });

  it("still refuses an old snapshot to staff with restore rights but not that client", async () => {
    signInAsStaff({ clients: ["client-b"], caps: RESTORE });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ assignees: OLD_SNAPSHOT_PEOPLE }));

    expect((await restoreTask()).status).toBe(403);
    expect(h.archive.restoreArchivedTask).not.toHaveBeenCalled();
  });

  it("restores a public task deleted by someone else, passing who restored it", async () => {
    signInAsStaff({ clients: ["client-a"], caps: RESTORE });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask());

    expect((await restoreTask()).status).toBe(201);
    expect(h.archive.restoreArchivedTask).toHaveBeenCalledWith("arch-task-1", STAFF_ID);
  });

  it("restores an internal task for staff with restore rights", async () => {
    signInAsStaff({ caps: RESTORE });
    h.db.archivedTask.findUnique.mockResolvedValue(archivedTask({ clientId: null, clientName: null }));

    expect((await restoreTask()).status).toBe(201);
  });
});

// --- The /archive page lists ---

type Element = { type: unknown; props: Record<string, unknown> };
const PAGE_SECTIONS = new Set(["TasksTab", "CampaignsTab", "ProjectsTab", "ClientNotesTab", "MeetingNotesTab"]);

/** Runs the page's own async sections and returns every element in the tree. */
async function renderPage(tab?: string, searchParams: Record<string, string> = {}): Promise<Element[]> {
  const found: Element[] = [];
  async function walk(node: unknown): Promise<void> {
    if (Array.isArray(node)) {
      for (const child of node) await walk(child);
      return;
    }
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as Element;
    if (typeof element.type === "function" && PAGE_SECTIONS.has(element.type.name)) {
      await walk(await (element.type as (props: unknown) => Promise<unknown>)(element.props));
      return;
    }
    found.push(element);
    await walk(element.props.children);
  }
  await walk(await ArchivePage({ searchParams: Promise.resolve({ ...searchParams, ...(tab ? { tab } : {}) }) }));
  return found;
}

const named = (elements: Element[], name: string) =>
  elements.filter((e) => typeof e.type === "function" && (e.type as { name: string }).name === name);
const listedTaskIds = (elements: Element[]) => named(elements, "ArchivedTaskRow").map((e) => (e.props.task as { id: string }).id);
const restoreUrls = (elements: Element[]) => named(elements, "RestoreArchivedEntityButton").map((e) => e.props.restoreUrl);

const SCOPED_TO_CLIENT_A = [{ clientId: null }, { clientId: { in: ["client-a"] } }];

// The privacy rule, asked of the database: no privacy record (an old
// snapshot: the stored value has no isPrivate), public, or created by the
// viewer. Checked against the SQL Prisma compiles it to: the first branch is
// "IS NULL" on the JSON path, so old snapshots are not lost to SQL's NULL rules.
const VISIBLE_TO_STAFF = {
  OR: [
    { assignees: { path: ["isPrivate"], equals: Prisma.DbNull } },
    { assignees: { path: ["isPrivate"], equals: false } },
    { assignees: { path: ["createdById"], equals: STAFF_ID } },
  ],
};

describe("/archive page", () => {
  it("is not found for staff without archive rights", async () => {
    signInAsStaff({ isAdmin: false });
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lists only archived tasks in the viewer's clients, plus internal ones, and scopes the client filter the same way", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });

    await renderPage();

    const [rowsQuery, namesQuery] = h.db.archivedTask.findMany.mock.calls.map((call) => call[0]);
    expect(rowsQuery.where.OR).toEqual(SCOPED_TO_CLIENT_A);
    expect(namesQuery.where.OR).toEqual(SCOPED_TO_CLIENT_A);
    expect(namesQuery.where.clientName).toEqual({ not: null });
  });

  it("keeps the viewer's own filters alongside the client scope", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });

    await renderPage(undefined, { q: "invoice", clientName: "INTERNAL" });

    const where = h.db.archivedTask.findMany.mock.calls[0][0].where;
    expect(where.title).toEqual({ contains: "invoice", mode: "insensitive" });
    expect(where.clientName).toBeNull();
    expect(where.OR).toEqual(SCOPED_TO_CLIENT_A);
  });

  it("does not scope admins or all-clients staff", async () => {
    signInAsStaff({ isAdmin: true });
    await renderPage();
    expect(h.db.archivedTask.findMany.mock.calls[0][0].where.OR).toBeUndefined();

    h.db.archivedTask.findMany.mockClear();
    signInAsStaff({ allClientsAccess: true, caps: VIEW });
    await renderPage();
    expect(h.db.archivedTask.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it("asks the database only for tasks the viewer may see, so others' private tasks cannot crowd out the 100 rows", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });

    await renderPage(undefined, { q: "invoice" });

    const [rowsQuery, namesQuery] = h.db.archivedTask.findMany.mock.calls.map((call) => call[0]);
    expect(rowsQuery.where.AND).toStrictEqual([VISIBLE_TO_STAFF]);
    expect(rowsQuery.where.OR).toEqual(SCOPED_TO_CLIENT_A);
    expect(rowsQuery.where.title).toEqual({ contains: "invoice", mode: "insensitive" });
    expect(rowsQuery.take).toBe(100);
    // The client filter offers only clients that have a task this viewer can see.
    expect(namesQuery.where.AND).toStrictEqual([VISIBLE_TO_STAFF]);
  });

  it("applies the privacy rule to admins too, as it does to live tasks", async () => {
    signInAsStaff({ isAdmin: true });

    await renderPage();

    expect(h.db.archivedTask.findMany.mock.calls[0][0].where.AND).toStrictEqual([VISIBLE_TO_STAFF]);
  });

  it("says there is nothing to show, not that nothing was ever deleted, when the list is empty", async () => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });

    const titles = named(await renderPage(), "EmptyState").map((e) => e.props.title);

    expect(titles).toEqual(["No deleted tasks to show."]);
  });

  it("leaves out other people's private tasks but lists every old snapshot", async () => {
    signInAsStaff({ isAdmin: true });
    h.db.archivedTask.findMany.mockImplementation(async (args: { distinct?: unknown }) =>
      args.distinct
        ? []
        : [
            archivedTask({ id: "public" }),
            archivedTask({ id: "mine-private", assignees: privatePeople(STAFF_ID) }),
            archivedTask({ id: "their-private", assignees: privatePeople("owner-9"), deletedById: STAFF_ID }),
            archivedTask({ id: "old-mine", assignees: [], deletedById: STAFF_ID }),
            archivedTask({ id: "old-theirs", assignees: [{ id: "m-1", name: "Ann" }] }),
            archivedTask({ id: "old-unknown-deleter", assignees: null, deletedById: null }),
          ]
    );

    expect(listedTaskIds(await renderPage())).toEqual(["public", "mine-private", "old-mine", "old-theirs", "old-unknown-deleter"]);
  });

  it.each([
    { tab: "campaigns", model: () => h.db.archivedCampaign, row: archivedCampaign, url: "/api/archived-campaigns/arch-campaign-1/restore" },
    { tab: "projects", model: () => h.db.archivedWorkflowInstance, row: archivedInstance, url: "/api/archived-workflow-instances/arch-instance-1/restore" },
    { tab: "notes", model: () => h.db.archivedClientNote, row: archivedNote, url: "/api/archived-client-notes/arch-note-1/restore" },
    { tab: "meetings", model: () => h.db.archivedMeetingNote, row: archivedMeeting, url: "/api/archived-meeting-notes/arch-meeting-1/restore" },
  ])("scopes the $tab tab to the viewer's clients, plus internal ones", async ({ tab, model, row, url }) => {
    signInAsStaff({ clients: ["client-a"], caps: VIEW });
    model().findMany.mockResolvedValue([row()]);

    const elements = await renderPage(tab);

    expect(model().findMany.mock.calls[0][0].where.OR).toEqual(SCOPED_TO_CLIENT_A);
    expect(restoreUrls(elements)).toEqual([url]);
  });

  it.each([
    { tab: "campaigns", model: () => h.db.archivedCampaign },
    { tab: "projects", model: () => h.db.archivedWorkflowInstance },
    { tab: "notes", model: () => h.db.archivedClientNote },
    { tab: "meetings", model: () => h.db.archivedMeetingNote },
  ])("does not scope the $tab tab for admins", async ({ tab, model }) => {
    signInAsStaff({ isAdmin: true });

    await renderPage(tab);

    expect(model().findMany.mock.calls[0][0].where?.OR).toBeUndefined();
  });
});
