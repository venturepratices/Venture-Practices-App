import { beforeEach, describe, expect, it, vi } from "vitest";

// Same harness as tests/lib/permissions.test.ts: React's cache() is an identity
// function here so every call re-reads the mocked session and database.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

const findUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { teamMember: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

const { requireSalesUser, dealOwnerWhere, canEditDeal, canDeleteSalesRecords, SALES_MEMBER_WHERE } = await import(
  "@/lib/sales/access"
);
const { PermissionError } = await import("@/lib/permissions");

function member(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u1",
    isAdmin: false,
    allClientsAccess: false,
    clientAccess: [],
    canUseSales: false,
    salesSeesAllDeals: true,
    ...overrides,
  };
}

function signIn(overrides: Partial<Record<string, unknown>> = {}) {
  authMock.mockResolvedValue({ user: { id: "u1" } });
  findUniqueMock.mockResolvedValue(member(overrides));
}

const actor = (overrides: Partial<import("@/lib/sales/access").SalesActor> = {}) => ({
  userId: "u1",
  isAdmin: false,
  seesAllDeals: true,
  via: "user" as const,
  ...overrides,
});

beforeEach(() => {
  authMock.mockReset();
  findUniqueMock.mockReset();
});

describe("requireSalesUser", () => {
  it("rejects a signed-in member without the Sales switch (403)", async () => {
    signIn({ canUseSales: false });
    const err = await requireSalesUser().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as InstanceType<typeof PermissionError>).status).toBe(403);
    expect((err as Error).message).toBe("You don't have access to Sales.");
  });

  it("rejects a signed-out request (401)", async () => {
    authMock.mockResolvedValue(null);
    const err = await requireSalesUser().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as InstanceType<typeof PermissionError>).status).toBe(401);
  });

  it("accepts a member with the Sales switch and reports their visibility", async () => {
    signIn({ canUseSales: true, salesSeesAllDeals: false });
    await expect(requireSalesUser()).resolves.toEqual({
      userId: "u1",
      isAdmin: false,
      seesAllDeals: false,
      via: "user",
    });
  });

  it("accepts an admin even with the switch off", async () => {
    signIn({ isAdmin: true, canUseSales: false });
    await expect(requireSalesUser()).resolves.toMatchObject({ userId: "u1", isAdmin: true, via: "user" });
  });
});

describe("dealOwnerWhere", () => {
  it("returns no filter for everyone when the user sees all deals", () => {
    expect(dealOwnerWhere(actor(), "everyone")).toEqual({});
  });

  it("limits to the user's own deals for mine", () => {
    expect(dealOwnerWhere(actor(), "mine")).toEqual({ ownerId: "u1" });
  });

  it("limits to the user's own deals for everyone when they cannot see all", () => {
    expect(dealOwnerWhere(actor({ seesAllDeals: false }), "everyone")).toEqual({ ownerId: "u1" });
  });

  it("lets an admin see everyone even when seesAllDeals is false", () => {
    expect(dealOwnerWhere(actor({ isAdmin: true, seesAllDeals: false }), "everyone")).toEqual({});
  });
});

describe("canEditDeal", () => {
  it("allows the owner", () => {
    expect(canEditDeal(actor(), { ownerId: "u1" })).toBe(true);
  });
  it("denies another non-admin", () => {
    expect(canEditDeal(actor(), { ownerId: "u2" })).toBe(false);
  });
  it("allows an admin", () => {
    expect(canEditDeal(actor({ isAdmin: true }), { ownerId: "u2" })).toBe(true);
  });
});

describe("canDeleteSalesRecords", () => {
  it("allows admin users", () => {
    expect(canDeleteSalesRecords(actor({ isAdmin: true }))).toBe(true);
  });
  it("denies non-admin users", () => {
    expect(canDeleteSalesRecords(actor())).toBe(false);
  });
  it("never allows a bot, even when admin", () => {
    expect(canDeleteSalesRecords(actor({ isAdmin: true, via: "bot" }))).toBe(false);
  });
});

describe("SALES_MEMBER_WHERE", () => {
  it("matches admins and anyone with the Sales switch", () => {
    expect(SALES_MEMBER_WHERE).toEqual({ OR: [{ isAdmin: true }, { canUseSales: true }] });
  });
});
