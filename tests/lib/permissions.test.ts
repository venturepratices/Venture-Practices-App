import { beforeEach, describe, expect, it, vi } from "vitest";

// react's cache() memoizes across calls using a request-scoped context that
// only exists inside real React Server rendering — outside of that, treating
// it as a plain identity function is what makes loadPermissions() re-run
// (and re-read the mocked session/DB) on every test instead of leaking state
// between them.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

const findUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { teamMember: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } } }));

const {
  requireUser,
  requireAdmin,
  requireCapability,
  requireClientAccess,
  accessibleClientFilter,
  taskVisibilityFilter,
  toErrorResponse,
  PermissionError,
} = await import("@/lib/permissions");

function member(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "member-1",
    isAdmin: false,
    allClientsAccess: false,
    clientAccess: [],
    canCreateClients: false,
    canEditClients: false,
    canDeleteClients: false,
    canCreateTasks: false,
    canEditTasks: false,
    canDeleteTasks: false,
    canCommentOnTasks: false,
    canManageTaskLinks: false,
    canCreateClientNotes: false,
    canEditClientNotes: false,
    canDeleteClientNotes: false,
    canCreateMeetingNotes: false,
    canDeleteMeetingNotes: false,
    canManageClientLinks: false,
    canViewCredentials: false,
    canManageCredentials: false,
    canRevealCredentials: false,
    canViewConversations: false,
    canManageHighLevel: false,
    canViewActivity: false,
    canViewArchive: false,
    canRestoreArchive: false,
    canViewAssets: false,
    canUploadAssets: false,
    canCommentOnAssets: false,
    canDecideOnAssets: false,
    canManageAssetReviewers: false,
    canShareAssetsExternally: false,
    canDeleteAssets: false,
    canManageClientUsers: false,
    canViewDirectMail: false,
    canManageDirectMail: false,
    canViewWorkflows: false,
    canManageWorkflows: false,
    canViewPlanning: false,
    canManagePlanning: false,
    canViewOrders: false,
    canManageOrders: false,
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  findUniqueMock.mockReset();
});

describe("requireUser", () => {
  it("throws 401 when there's no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 when the session's user no longer exists in the DB (e.g. deleted mid-session)", async () => {
    authMock.mockResolvedValue({ user: { id: "ghost" } });
    findUniqueMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it("resolves for a real signed-in member", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member());
    const p = await requireUser();
    expect(p.userId).toBe("member-1");
  });
});

describe("requireAdmin", () => {
  it("throws 403 for a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ isAdmin: false }));
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("passes for an admin", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ isAdmin: true }));
    await expect(requireAdmin()).resolves.toMatchObject({ isAdmin: true });
  });
});

describe("requireCapability", () => {
  it("throws 403 when the specific capability is off", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ canDeleteClients: false }));
    await expect(requireCapability("canDeleteClients")).rejects.toMatchObject({ status: 403 });
  });

  it("passes when the specific capability is on", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ canDeleteClients: true }));
    await expect(requireCapability("canDeleteClients")).resolves.toBeDefined();
  });

  it("an admin passes every capability check regardless of the underlying flags", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ isAdmin: true, canDeleteClients: false }));
    await expect(requireCapability("canDeleteClients")).resolves.toBeDefined();
  });
});

describe("requireClientAccess", () => {
  it("throws 403 for a client the member has no grant for", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ clientAccess: [{ clientId: "client-A" }] }));
    await expect(requireClientAccess("client-B")).rejects.toMatchObject({ status: 403 });
  });

  it("passes for a client the member has a specific grant for", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ clientAccess: [{ clientId: "client-A" }] }));
    await expect(requireClientAccess("client-A")).resolves.toBeDefined();
  });

  it("allClientsAccess grants every client with no per-client rows needed", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ allClientsAccess: true }));
    await expect(requireClientAccess("client-anything")).resolves.toBeDefined();
  });

  it("an admin bypasses client scoping entirely", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ isAdmin: true }));
    await expect(requireClientAccess("client-anything")).resolves.toBeDefined();
  });
});

describe("accessibleClientFilter", () => {
  it("returns an impossible filter for a signed-out caller (never leaks all rows)", async () => {
    authMock.mockResolvedValue(null);
    expect(await accessibleClientFilter()).toEqual({ id: { in: [] } });
  });

  it("returns an unscoped filter for an admin", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ isAdmin: true }));
    expect(await accessibleClientFilter()).toEqual({});
  });

  it("scopes a regular member to exactly their granted client ids", async () => {
    authMock.mockResolvedValue({ user: { id: "member-1" } });
    findUniqueMock.mockResolvedValue(member({ clientAccess: [{ clientId: "client-A" }, { clientId: "client-B" }] }));
    const filter = await accessibleClientFilter("clientId");
    expect(filter).toHaveProperty("clientId.in");
    expect((filter as { clientId: { in: string[] } }).clientId.in.sort()).toEqual(["client-A", "client-B"]);
  });
});

describe("taskVisibilityFilter", () => {
  it("only matches non-private tasks for an anonymous/no-session viewer", () => {
    expect(taskVisibilityFilter(null)).toEqual({ isPrivate: false });
  });

  it("matches non-private tasks OR the viewer's own private tasks — never someone else's private task", () => {
    const filter = taskVisibilityFilter("viewer-1");
    expect(filter).toEqual({ OR: [{ isPrivate: false }, { isPrivate: true, createdById: "viewer-1" }] });
  });
});

describe("toErrorResponse", () => {
  it("maps a PermissionError to its declared status code", async () => {
    const res = toErrorResponse(new PermissionError(403, "nope"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("rethrows anything that isn't a PermissionError — an unexpected bug should never look like a clean 4xx", () => {
    const boom = new Error("unexpected");
    expect(() => toErrorResponse(boom)).toThrow(boom);
  });
});
