import { beforeEach, describe, expect, it, vi } from "vitest";

// Access rules for the task routes (old audit #7, #8, #9, #12): a task can
// only be read by staff who can see it, and can only be created in or moved
// into a client, campaign or project the caller can access. The real
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
  return {
    auth: fn(),
    db: {
      teamMember: { findUnique: fn(), findMany: fn() },
      task: { findUnique: fn(), update: fn(), create: fn(), aggregate: fn() },
      campaign: { findUnique: fn() },
      workflowInstance: { findUnique: fn() },
      privateProject: { findUnique: fn() },
      activityLog: { findMany: fn() },
      comment: { findMany: fn() },
    },
    notify: fn(),
    notifyChannel: fn(),
    logActivity: fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: h.notify, notifyChannel: h.notifyChannel }));
vi.mock("@/lib/activity-log", () => ({ logActivity: h.logActivity }));
vi.mock("@/lib/archive", () => ({ archiveTask: vi.fn() }));
vi.mock("@/lib/campaign-advance", () => ({ maybeAdvanceCampaignStage: vi.fn() }));
vi.mock("@/lib/workflow-advance", () => ({ maybeAdvanceWorkflowStage: vi.fn(), notifyNextTaskInStage: vi.fn() }));
vi.mock("@/lib/recurring-tasks", () => ({ maybeCreateNextOccurrence: vi.fn() }));
vi.mock("@/lib/task-status", () => ({
  getTaskStatusOptions: async () => [],
  isCompleteStatusId: async () => false,
  isValidStatusId: async () => true,
}));
vi.mock("@/lib/priority-level", () => ({
  getPriorityLevelOptions: async () => [],
  isValidPriorityLevelId: async () => true,
}));

const { CAPABILITIES } = await import("@/lib/permission-catalog");
const { taskVisibilityFilter } = await import("@/lib/permissions");
const taskRoute = await import("@/app/api/tasks/[taskId]/route");
const tasksRoute = await import("@/app/api/tasks/route");
const activityRoute = await import("@/app/api/tasks/[taskId]/activity/route");
const duplicateRoute = await import("@/app/api/tasks/[taskId]/duplicate/route");
const campaignRoute = await import("@/app/api/campaigns/[campaignId]/route");
const workflowRoute = await import("@/app/api/workflows/[instanceId]/route");

const STAFF_ID = "member-1";

function signInAsStaff(options: { clients?: string[]; caps?: string[]; isAdmin?: boolean } = {}) {
  const caps = Object.fromEntries(CAPABILITIES.map((cap) => [cap, (options.caps ?? []).includes(cap)]));
  h.auth.mockResolvedValue({ user: { id: STAFF_ID, name: "Staff Member" } });
  h.db.teamMember.findUnique.mockResolvedValue({
    id: STAFF_ID,
    isAdmin: options.isAdmin ?? false,
    allClientsAccess: false,
    clientAccess: (options.clients ?? []).map((clientId) => ({ clientId })),
    ...caps,
  });
}

// A client-portal login: a real session, but no TeamMember row behind it.
function signInAsPortalUser(clientId = "client-a") {
  h.auth.mockResolvedValue({ user: { id: "client-user-1", name: "Portal User", isClientUser: true, clientId } });
  h.db.teamMember.findUnique.mockResolvedValue(null);
}

function storedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Write the newsletter",
    description: null,
    clientId: "client-a",
    client: { id: "client-a", name: "Client A" },
    isPrivate: false,
    createdById: STAFF_ID,
    statusId: "NEXT_UP",
    priorityLevelId: null,
    occurrence: "NON_RECURRING",
    customRecurrenceInterval: null,
    customRecurrenceUnit: null,
    kind: "TASK",
    deadline: null,
    campaignId: null,
    campaignStage: null,
    workflowInstanceId: null,
    workflowStageNumber: null,
    workflowTaskOrder: null,
    workflowInstance: null,
    assignees: [],
    links: [],
    subtasks: [],
    comments: [],
    statusOption: { id: "NEXT_UP", label: "Next Up", tone: null, color: null, isComplete: false },
    ...overrides,
  };
}

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/tasks", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: Record<string, unknown>) {
  return taskRoute.PATCH(jsonRequest("PATCH", body), params({ taskId: "task-1" }));
}

function post(body: Record<string, unknown>) {
  return tasksRoute.POST(jsonRequest("POST", { title: "New task", ...body }));
}

const ID_AND_NAME_ONLY = { id: true, name: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockReset();
  for (const model of Object.values(h.db)) {
    for (const method of Object.values(model)) method.mockReset();
  }
  h.db.teamMember.findMany.mockResolvedValue([]);
  h.db.task.aggregate.mockResolvedValue({ _max: { workflowTaskOrder: null } });
  // The update echoes back the stored task with whichever links were changed.
  h.db.task.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    storedTask({
      ...(data.clientId !== undefined ? { clientId: data.clientId, client: null } : {}),
      ...(data.campaignId !== undefined ? { campaignId: data.campaignId } : {}),
      ...(data.workflowInstanceId !== undefined ? { workflowInstanceId: data.workflowInstanceId } : {}),
    })
  );
  h.db.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    storedTask({ id: "task-new", clientId: data.clientId, campaignId: data.campaignId, workflowInstanceId: data.workflowInstanceId, client: null })
  );
});

describe("GET /api/tasks/[taskId]", () => {
  it("refuses a client-portal login asking for an internal task, without looking the task up", async () => {
    signInAsPortalUser();
    h.db.task.findUnique.mockResolvedValue(storedTask({ clientId: null, client: null }));

    const response = await taskRoute.GET(new Request("http://localhost"), params({ taskId: "task-1" }));

    expect(response.status).toBe(401);
    expect(h.db.task.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a client-portal login asking for a client's task", async () => {
    signInAsPortalUser("client-a");
    h.db.task.findUnique.mockResolvedValue(storedTask());

    const response = await taskRoute.GET(new Request("http://localhost"), params({ taskId: "task-1" }));

    expect(response.status).toBe(401);
  });

  it("hides someone else's private task from staff", async () => {
    signInAsStaff({ clients: ["client-a"] });
    h.db.task.findUnique.mockResolvedValue(storedTask({ isPrivate: true, createdById: "someone-else" }));

    const response = await taskRoute.GET(new Request("http://localhost"), params({ taskId: "task-1" }));

    expect(response.status).toBe(404);
  });

  it("refuses staff without access to the task's client", async () => {
    signInAsStaff({ clients: ["client-b"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());

    const response = await taskRoute.GET(new Request("http://localhost"), params({ taskId: "task-1" }));

    expect(response.status).toBe(403);
  });

  it("gives staff an internal task, asking only for each assignee's id and name", async () => {
    signInAsStaff();
    h.db.task.findUnique.mockResolvedValue(storedTask({ clientId: null, client: null }));

    const response = await taskRoute.GET(new Request("http://localhost"), params({ taskId: "task-1" }));

    expect(response.status).toBe(200);
    const query = h.db.task.findUnique.mock.calls[0][0];
    expect(query.include.assignees.include.teamMember.select).toEqual(ID_AND_NAME_ONLY);
  });
});

describe("GET /api/tasks/[taskId]/activity", () => {
  it("refuses a client-portal login asking for an internal task's history", async () => {
    signInAsPortalUser();
    h.db.task.findUnique.mockResolvedValue({ isPrivate: false, createdById: STAFF_ID, clientId: null });
    h.db.activityLog.findMany.mockResolvedValue([]);
    h.db.comment.findMany.mockResolvedValue([]);

    const response = await activityRoute.GET(new Request("http://localhost"), params({ taskId: "task-1" }));

    expect(response.status).toBe(401);
    expect(h.db.task.findUnique).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/tasks/[taskId]", () => {
  it("still saves a plain status change", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());

    const response = await patch({ status: "IN_PROGRESS" });

    expect(response.status).toBe(200);
    expect(h.db.task.update).toHaveBeenCalledOnce();
  });

  it("refuses to move a task into a client the caller cannot access", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());

    const response = await patch({ clientId: "client-b" });

    expect(response.status).toBe(403);
    expect(h.db.task.update).not.toHaveBeenCalled();
  });

  it("moves a task into another client the caller can access", async () => {
    signInAsStaff({ clients: ["client-a", "client-b"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());

    const response = await patch({ clientId: "client-b" });

    expect(response.status).toBe(200);
    expect(h.db.task.update.mock.calls[0][0].data.clientId).toBe("client-b");
  });

  it("moves a task out of its client to internal", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());

    const response = await patch({ clientId: null });

    expect(response.status).toBe(200);
  });

  it("refuses to attach a task to a campaign of a client the caller cannot access", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask({ clientId: null, client: null }));
    h.db.campaign.findUnique.mockResolvedValue({ id: "campaign-b", clientId: "client-b" });

    const response = await patch({ campaignId: "campaign-b", campaignStage: "PLANNING" });

    expect(response.status).toBe(403);
    expect(h.db.task.update).not.toHaveBeenCalled();
  });

  it("refuses a campaign that belongs to a different client than the task", async () => {
    signInAsStaff({ clients: ["client-a", "client-b"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());
    h.db.campaign.findUnique.mockResolvedValue({ id: "campaign-b", clientId: "client-b" });

    const response = await patch({ campaignId: "campaign-b", campaignStage: "PLANNING" });

    expect(response.status).toBe(400);
    expect(h.db.task.update).not.toHaveBeenCalled();
  });

  it("accepts a campaign of the client the task moves to in the same save", async () => {
    signInAsStaff({ clients: ["client-a", "client-b"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());
    h.db.campaign.findUnique.mockResolvedValue({ id: "campaign-b", clientId: "client-b" });

    const response = await patch({ clientId: "client-b", campaignId: "campaign-b", campaignStage: "PLANNING" });

    expect(response.status).toBe(200);
  });

  it("refuses a campaign that does not exist", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());
    h.db.campaign.findUnique.mockResolvedValue(null);

    const response = await patch({ campaignId: "missing", campaignStage: "PLANNING" });

    expect(response.status).toBe(400);
    expect(h.db.task.update).not.toHaveBeenCalled();
  });

  it("refuses to attach a task to a project of a client the caller cannot access", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());
    h.db.workflowInstance.findUnique.mockResolvedValue({ id: "project-b", clientId: "client-b", name: "Project B" });

    const response = await patch({ workflowInstanceId: "project-b", kind: "PROJECT" });

    expect(response.status).toBe(403);
    expect(h.db.task.update).not.toHaveBeenCalled();
  });

  it("lets a client task join an internal project, as the project picker allows", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());
    h.db.workflowInstance.findUnique.mockResolvedValue({ id: "project-internal", clientId: null, name: "Internal project" });

    const response = await patch({ workflowInstanceId: "project-internal", kind: "PROJECT" });

    expect(response.status).toBe(200);
  });

  it("refuses a project that does not exist", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());
    h.db.workflowInstance.findUnique.mockResolvedValue(null);

    const response = await patch({ workflowInstanceId: "missing", kind: "PROJECT" });

    expect(response.status).toBe(400);
    expect(h.db.task.update).not.toHaveBeenCalled();
  });

  it("still @-mentions a newly added assignee in the channel, without sending emails or Slack ids back", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canEditTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask());
    h.db.task.update.mockResolvedValue(
      storedTask({ assignees: [{ teamMemberId: "member-2", teamMember: { id: "member-2", name: "Bob" } }] })
    );
    h.db.teamMember.findMany.mockResolvedValue([{ id: "member-2", email: "bob@example.com", slackUserId: "U0BOB" }]);

    const response = await patch({ assigneeIds: ["member-2"] });

    expect(response.status).toBe(200);
    expect(h.db.task.update.mock.calls[0][0].include.assignees.include.teamMember.select).toEqual(ID_AND_NAME_ONLY);
    expect(h.notifyChannel).toHaveBeenCalledOnce();
    expect(h.notifyChannel.mock.calls[0][0].lines[0]).toBe("Now assigned to: <@U0BOB>");
  });
});

describe("POST /api/tasks", () => {
  it("refuses a task on a campaign of a client the caller cannot access", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canManageDirectMail"] });
    h.db.campaign.findUnique.mockResolvedValue({ id: "campaign-b", clientId: "client-b" });

    const response = await post({ campaignId: "campaign-b", campaignStage: "PLANNING" });

    expect(response.status).toBe(403);
    expect(h.db.task.create).not.toHaveBeenCalled();
  });

  it("refuses a campaign that belongs to a different client than the task", async () => {
    signInAsStaff({ clients: ["client-a", "client-b"], caps: ["canManageDirectMail"] });
    h.db.campaign.findUnique.mockResolvedValue({ id: "campaign-b", clientId: "client-b" });

    const response = await post({ clientId: "client-a", campaignId: "campaign-b", campaignStage: "PLANNING" });

    expect(response.status).toBe(400);
    expect(h.db.task.create).not.toHaveBeenCalled();
  });

  it("refuses a campaign that does not exist", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canManageDirectMail"] });
    h.db.campaign.findUnique.mockResolvedValue(null);

    const response = await post({ clientId: "client-a", campaignId: "missing", campaignStage: "PLANNING" });

    expect(response.status).toBe(400);
    expect(h.db.task.create).not.toHaveBeenCalled();
  });

  it("adds a task from a campaign page, where the client and campaign match", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canManageDirectMail"] });
    h.db.campaign.findUnique.mockResolvedValue({ id: "campaign-a", clientId: "client-a" });

    const response = await post({ clientId: "client-a", campaignId: "campaign-a", campaignStage: "PLANNING" });

    expect(response.status).toBe(201);
  });

  it("refuses a task on a project of a client the caller cannot access", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canManageWorkflows"] });
    h.db.workflowInstance.findUnique.mockResolvedValue({ id: "project-b", clientId: "client-b" });

    const response = await post({ workflowInstanceId: "project-b", workflowStageNumber: 1 });

    expect(response.status).toBe(403);
    expect(h.db.task.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/tasks/[taskId]/duplicate", () => {
  it("still @-mentions the copied assignees in the channel, without sending emails or Slack ids back", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canCreateTasks"] });
    h.db.task.findUnique.mockResolvedValue(storedTask({ assignees: [{ teamMemberId: "member-2" }] }));
    h.db.task.create.mockResolvedValue(
      storedTask({ id: "task-copy", assignees: [{ teamMemberId: "member-2", teamMember: { id: "member-2", name: "Bob" } }] })
    );
    h.db.teamMember.findMany.mockResolvedValue([{ id: "member-2", email: "bob@example.com", slackUserId: "U0BOB" }]);

    const response = await duplicateRoute.POST(new Request("http://localhost"), params({ taskId: "task-1" }));

    expect(response.status).toBe(201);
    expect(h.db.task.create.mock.calls[0][0].include.assignees.include.teamMember.select).toEqual(ID_AND_NAME_ONLY);
    expect(h.notifyChannel).toHaveBeenCalledOnce();
    expect(h.notifyChannel.mock.calls[0][0].lines[0]).toBe("Assigned to: <@U0BOB>");
  });
});

describe("campaign and project detail routes", () => {
  it("leave other people's private tasks out of a campaign", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canViewDirectMail"] });
    h.db.campaign.findUnique.mockResolvedValue({ id: "campaign-a", clientId: "client-a", client: null, tasks: [] });

    const response = await campaignRoute.GET(new Request("http://localhost"), params({ campaignId: "campaign-a" }));

    expect(response.status).toBe(200);
    expect(h.db.campaign.findUnique.mock.calls[0][0].include.tasks.where).toEqual(taskVisibilityFilter(STAFF_ID));
  });

  it("leave other people's private tasks out of a project", async () => {
    signInAsStaff({ clients: ["client-a"], caps: ["canViewWorkflows"] });
    h.db.workflowInstance.findUnique.mockResolvedValue({ id: "project-a", clientId: "client-a", tasks: [] });

    const response = await workflowRoute.GET(new Request("http://localhost"), params({ instanceId: "project-a" }));

    expect(response.status).toBe(200);
    expect(h.db.workflowInstance.findUnique.mock.calls[0][0].include.tasks.where).toEqual(taskVisibilityFilter(STAFF_ID));
  });
});
