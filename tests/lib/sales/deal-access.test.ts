import { describe, expect, it, vi } from "vitest";

// The shared "may this person open / change this deal" checks every deal write
// goes through, and the typed history writer for deals. The default `prisma`
// import is mocked only so loading the modules stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { DEAL_NOT_FOUND, NOT_YOUR_DEAL, findDealForEdit, visibleDealWhere } = await import("@/lib/sales/deal-access");
const { recordDealAudit } = await import("@/lib/sales/deal-audit");

type SalesActor = import("@/lib/sales/access").SalesActor;
type Row = Record<string, unknown>;

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "a", isAdmin: true, seesAllDeals: true, via: "user" };

describe("visibleDealWhere", () => {
  it("hides archived deals, and other people's deals from someone set to their own", () => {
    expect(visibleDealWhere(rep, "d1")).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
    expect(visibleDealWhere(seesAll, "d1")).toEqual({ id: "d1", archivedAt: null });
    expect(visibleDealWhere(admin, "d1")).toEqual({ id: "d1", archivedAt: null });
  });
});

describe("findDealForEdit", () => {
  const txWith = (row: Row | null) => ({ salesDeal: { findFirst: vi.fn<(args: Row) => Promise<Row | null>>(async () => row) } });
  const select = { ownerId: true, title: true } as const;

  it("looks the deal up through the who-can-see filter with the caller's select", async () => {
    const tx = txWith({ ownerId: "r", title: "Oak" });
    await findDealForEdit(tx as never, rep, "d1", select);

    expect(tx.salesDeal.findFirst).toHaveBeenCalledWith({ where: { id: "d1", archivedAt: null, ownerId: "r" }, select });
  });

  it("answers 404 when the deal is not visible", async () => {
    expect(await findDealForEdit(txWith(null) as never, rep, "d1", select)).toEqual({
      ok: false,
      status: 404,
      error: DEAL_NOT_FOUND,
    });
    expect(DEAL_NOT_FOUND).toBe("Deal not found.");
  });

  it("answers 403 when the person can see the deal but does not own it", async () => {
    expect(await findDealForEdit(txWith({ ownerId: "b", title: "Oak" }) as never, seesAll, "d1", select)).toEqual({
      ok: false,
      status: 403,
      error: NOT_YOUR_DEAL,
    });
    expect(NOT_YOUR_DEAL).toBe("Only the deal owner or an admin can change this deal.");
  });

  it("returns the deal to its owner or an admin", async () => {
    expect(await findDealForEdit(txWith({ ownerId: "r", title: "Oak" }) as never, seesAll, "d1", select)).toEqual({
      ok: true,
      deal: { ownerId: "r", title: "Oak" },
    });
    expect(await findDealForEdit(txWith({ ownerId: "b", title: "Oak" }) as never, admin, "d1", select)).toMatchObject({
      ok: true,
    });
  });
});

describe("recordDealAudit", () => {
  const capture = () => {
    const rows: Row[] = [];
    return { rows, tx: { salesAuditLog: { create: async (args: { data: Row }) => rows.push(args.data) } } };
  };

  it("writes the row against the deal with the event's action and payloads", async () => {
    const { rows, tx } = capture();
    await recordDealAudit(
      tx as never,
      rep,
      "d1",
      { action: "stage_changed", before: { stageId: "s1", stageName: "Lead In" }, after: { stageId: "s2", stageName: "Demo" } },
      { ipAddress: "198.51.100.4", userAgent: "Browser" },
    );

    expect(rows).toEqual([
      {
        actorType: "USER",
        actorId: "r",
        botTokenId: null,
        entityType: "SalesDeal",
        entityId: "d1",
        action: "stage_changed",
        before: { stageId: "s1", stageName: "Lead In" },
        after: { stageId: "s2", stageName: "Demo" },
        ipAddress: "198.51.100.4",
        userAgent: "Browser",
      },
    ]);
  });

  it("writes a refused delete as a row with no before or after", async () => {
    const { rows, tx } = capture();
    await recordDealAudit(tx as never, rep, "d1", { action: "delete_refused" }, { ipAddress: "198.51.100.4" });

    expect(rows[0]).toMatchObject({ action: "delete_refused", before: undefined, after: undefined, ipAddress: "198.51.100.4" });
  });

  it("writes a rule's change as SYSTEM", async () => {
    const { rows, tx } = capture();
    await recordDealAudit(tx as never, { system: "rule" }, "d1", {
      action: "activity_missed",
      after: { activityId: "a1", type: "MEETING", subject: "Demo" },
    });

    expect(rows[0]).toMatchObject({ actorType: "SYSTEM", actorId: null, action: "activity_missed", before: undefined });
  });
});
