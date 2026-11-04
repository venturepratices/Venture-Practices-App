import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// deleteTeamMemberAction, run with a fake database, a fake admin check and fake
// Slack calls. Nothing here reaches a real database, session or Slack.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "admin1", name: "Ben T." } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));

const removeFromChannels = vi.fn();
vi.mock("@/lib/slack", () => ({
  removeTeamMemberFromAllClientChannels: (...args: unknown[]) => removeFromChannels(...args),
  syncTeamMemberClientChannels: vi.fn(),
}));

// The Sales tables that hold a Restrict link to a team member, and the column that holds it.
const SALES_LINKS = [
  ["salesDeal", "ownerId"],
  ["salesLead", "ownerId"],
  ["salesPerson", "ownerId"],
  ["salesOrganization", "ownerId"],
  ["salesActivity", "ownerId"],
  ["salesNote", "authorId"],
  ["salesFile", "uploadedById"],
] as const;
type SalesModel = (typeof SALES_LINKS)[number][0];

type CountMock = Mock<(args: unknown) => Promise<number>>;
const owned = new Map<SalesModel, number>();
const salesCounts = Object.fromEntries(
  SALES_LINKS.map(([model]) => [model, vi.fn<(args: unknown) => Promise<number>>(async () => owned.get(model) ?? 0)]),
) as Record<SalesModel, CountMock>;
const memberDelete = vi.fn();
const members = { target: { id: "m1", name: "Sarah K.", isAdmin: false }, adminCount: 2 };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teamMember: {
      findUnique: async () => members.target,
      findFirst: async () => null,
      count: async () => members.adminCount,
      delete: (...args: unknown[]) => memberDelete(...args),
    },
    ...Object.fromEntries(SALES_LINKS.map(([model]) => [model, { count: (args: unknown) => salesCounts[model](args) }])),
  },
}));

const { deleteTeamMemberAction, updateTeamMemberAction } = await import("@/lib/actions/team-members");
const { PermissionError } = await import("@/lib/permissions");

beforeEach(() => {
  owned.clear();
  members.target = { id: "m1", name: "Sarah K.", isAdmin: false };
  members.adminCount = 2;
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
  removeFromChannels.mockReset();
  memberDelete.mockReset();
  for (const count of Object.values(salesCounts)) count.mockClear();
});

describe("deleteTeamMemberAction and Sales records", () => {
  it.each(SALES_LINKS)("refuses while the person still has a %s row (%s), before touching Slack", async (model, column) => {
    owned.set(model, 1);

    await expect(deleteTeamMemberAction("m1")).resolves.toEqual({
      error: "This person still owns Sales records. Reassign them first.",
    });
    expect(salesCounts[model]).toHaveBeenCalledWith({ where: { [column]: "m1" } });
    expect(removeFromChannels).not.toHaveBeenCalled();
    expect(memberDelete).not.toHaveBeenCalled();
  });

  it("removes the person when they own no Sales records", async () => {
    await expect(deleteTeamMemberAction("m1")).resolves.toEqual({ error: null });

    for (const [model, column] of SALES_LINKS) {
      expect(salesCounts[model], model).toHaveBeenCalledWith({ where: { [column]: "m1" } });
    }
    expect(removeFromChannels).toHaveBeenCalledWith("m1");
    expect(memberDelete).toHaveBeenCalledWith({ where: { id: "m1" } });
  });
});

describe("deleteTeamMemberAction refusals come back as a message", () => {
  it("refuses to remove the only admin", async () => {
    members.target = { id: "m1", name: "Ben S.", isAdmin: true };
    members.adminCount = 1;

    await expect(deleteTeamMemberAction("m1")).resolves.toEqual({
      error: "This is the only admin. Promote someone else before removing them.",
    });
    expect(removeFromChannels).not.toHaveBeenCalled();
    expect(memberDelete).not.toHaveBeenCalled();
  });

  it("removes an admin while another admin remains", async () => {
    members.target = { id: "m1", name: "Ben S.", isAdmin: true };
    members.adminCount = 2;

    await expect(deleteTeamMemberAction("m1")).resolves.toEqual({ error: null });
    expect(memberDelete).toHaveBeenCalledWith({ where: { id: "m1" } });
  });

  it("still throws when the caller is not an admin", async () => {
    requireAdminMock.mockReset().mockRejectedValue(new PermissionError(403, "This action is for admins only."));

    await expect(deleteTeamMemberAction("m1")).rejects.toThrow(PermissionError);
    expect(memberDelete).not.toHaveBeenCalled();
  });
});

describe("updateTeamMemberAction last-admin message", () => {
  it("refuses to demote the only admin, without an em dash", async () => {
    members.target = { id: "m1", name: "Ben S.", isAdmin: true };
    members.adminCount = 1;
    const form = new FormData();
    form.set("name", "Ben S.");
    form.set("email", "ben@example.com");
    form.set("password", "");

    await expect(updateTeamMemberAction("m1", { error: null }, form)).resolves.toEqual({
      error: "This is the only admin. Promote someone else to admin first.",
    });
  });
});
