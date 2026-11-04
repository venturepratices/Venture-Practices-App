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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teamMember: {
      findUnique: async () => ({ id: "m1", name: "Sarah K.", isAdmin: false }),
      count: async () => 2,
      delete: (...args: unknown[]) => memberDelete(...args),
    },
    ...Object.fromEntries(SALES_LINKS.map(([model]) => [model, { count: (args: unknown) => salesCounts[model](args) }])),
  },
}));

const { deleteTeamMemberAction } = await import("@/lib/actions/team-members");
const { PermissionError } = await import("@/lib/permissions");

beforeEach(() => {
  owned.clear();
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
  removeFromChannels.mockReset();
  memberDelete.mockReset();
  for (const count of Object.values(salesCounts)) count.mockClear();
});

describe("deleteTeamMemberAction and Sales records", () => {
  it.each(SALES_LINKS)("refuses while the person still has a %s row (%s), before touching Slack", async (model, column) => {
    owned.set(model, 1);

    const attempt = deleteTeamMemberAction("m1");

    await expect(attempt).rejects.toThrow(PermissionError);
    await expect(attempt).rejects.toMatchObject({
      status: 400,
      message: "This person still owns Sales records. Reassign them first.",
    });
    expect(salesCounts[model]).toHaveBeenCalledWith({ where: { [column]: "m1" } });
    expect(removeFromChannels).not.toHaveBeenCalled();
    expect(memberDelete).not.toHaveBeenCalled();
  });

  it("removes the person when they own no Sales records", async () => {
    await deleteTeamMemberAction("m1");

    for (const [model, column] of SALES_LINKS) {
      expect(salesCounts[model], model).toHaveBeenCalledWith({ where: { [column]: "m1" } });
    }
    expect(removeFromChannels).toHaveBeenCalledWith("m1");
    expect(memberDelete).toHaveBeenCalledWith({ where: { id: "m1" } });
  });
});
