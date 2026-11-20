import { beforeEach, describe, expect, it, vi } from "vitest";

// Naming a tracking number ("Direct Mail") so the Calls page can show what a
// number is. Nothing here reaches a real database.

const prismaMock = vi.hoisted(() => ({
  clientAccess: { findMany: vi.fn() },
  highLevelCallSummary: { findMany: vi.fn() },
  highLevelTrackingNumber: { upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { parseTrackingLabelInput, setTrackingLabel, TRACKING_LABEL_MAX } = await import(
  "@/lib/calls/tracking-labels"
);

const admin = { userId: "u-admin", isAdmin: true, allClientsAccess: false };
const member = { userId: "u-member", isAdmin: false, allClientsAccess: false };

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  prismaMock.highLevelTrackingNumber.upsert.mockResolvedValue({});
  prismaMock.highLevelTrackingNumber.deleteMany.mockResolvedValue({ count: 1 });
});

describe("parseTrackingLabelInput", () => {
  it("accepts a number and a name, and trims the name", () => {
    expect(parseTrackingLabelInput({ number: " +17043973212 ", label: "  Direct   Mail " })).toEqual({
      ok: true,
      number: "+17043973212",
      label: "Direct Mail",
    });
  });

  it("an empty or missing name means remove the name", () => {
    expect(parseTrackingLabelInput({ number: "+17043973212", label: "" })).toMatchObject({ ok: true, label: "" });
    expect(parseTrackingLabelInput({ number: "+17043973212" })).toMatchObject({ ok: true, label: "" });
    expect(parseTrackingLabelInput({ number: "+17043973212", label: null })).toMatchObject({ ok: true, label: "" });
  });

  it("refuses a name that is too long", () => {
    const result = parseTrackingLabelInput({ number: "+17043973212", label: "x".repeat(TRACKING_LABEL_MAX + 1) });
    expect(result.ok).toBe(false);
  });

  it("allows a name of exactly the limit", () => {
    const result = parseTrackingLabelInput({ number: "+17043973212", label: "x".repeat(TRACKING_LABEL_MAX) });
    expect(result.ok).toBe(true);
  });

  it("turns line breaks and control characters into plain spaces", () => {
    const result = parseTrackingLabelInput({ number: "+17043973212", label: "Direct\nMail\u0000 Line" });
    expect(result).toEqual({ ok: true, number: "+17043973212", label: "Direct Mail Line" });
  });

  it("refuses things that are not phone numbers", () => {
    for (const number of ["", "abc", "(unknown)", "+1704; DROP TABLE", "a".repeat(40), 5, null, undefined]) {
      expect(parseTrackingLabelInput({ number, label: "x" }).ok, String(number)).toBe(false);
    }
  });

  it("refuses a body that is not an object, and a name that is not text", () => {
    expect(parseTrackingLabelInput(null).ok).toBe(false);
    expect(parseTrackingLabelInput("hello").ok).toBe(false);
    expect(parseTrackingLabelInput({ number: "+17043973212", label: 42 }).ok).toBe(false);
  });
});

describe("setTrackingLabel", () => {
  it("names the number for every client that has calls on it (admin)", async () => {
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([{ clientId: "c1" }, { clientId: "c2" }]);

    const result = await setTrackingLabel({ actor: admin, number: "+17043973212", label: "Direct Mail" });

    expect(result).toEqual({ ok: true, clients: 2, removed: false });
    expect(prismaMock.clientAccess.findMany).not.toHaveBeenCalled();
    expect(prismaMock.highLevelTrackingNumber.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.highLevelTrackingNumber.upsert).toHaveBeenCalledWith({
      where: { clientId_number: { clientId: "c1", number: "+17043973212" } },
      create: { clientId: "c1", number: "+17043973212", label: "Direct Mail" },
      update: { label: "Direct Mail" },
    });
  });

  it("only looks at clients a member can see", async () => {
    prismaMock.clientAccess.findMany.mockResolvedValue([{ clientId: "c1" }]);
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([{ clientId: "c1" }]);

    await setTrackingLabel({ actor: member, number: "+17043973212", label: "Direct Mail" });

    const where = prismaMock.highLevelCallSummary.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ trackingNumber: "+17043973212", clientId: { in: ["c1"] } });
  });

  it("a member with no client access cannot name anything", async () => {
    prismaMock.clientAccess.findMany.mockResolvedValue([]);
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([]);

    const result = await setTrackingLabel({ actor: member, number: "+17043973212", label: "Direct Mail" });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(prismaMock.highLevelTrackingNumber.upsert).not.toHaveBeenCalled();
  });

  it("a number with no calls anywhere is a 404 and saves nothing", async () => {
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([]);

    const result = await setTrackingLabel({ actor: admin, number: "+19999999999", label: "Ghost" });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("an empty name removes the name for those clients", async () => {
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([{ clientId: "c1" }]);

    const result = await setTrackingLabel({ actor: admin, number: "+17043973212", label: "" });

    expect(result).toEqual({ ok: true, clients: 1, removed: true });
    expect(prismaMock.highLevelTrackingNumber.deleteMany).toHaveBeenCalledWith({
      where: { number: "+17043973212", clientId: { in: ["c1"] } },
    });
    expect(prismaMock.highLevelTrackingNumber.upsert).not.toHaveBeenCalled();
  });

  it("a member with access to every client is not narrowed", async () => {
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([{ clientId: "c1" }]);

    await setTrackingLabel({
      actor: { userId: "u3", isAdmin: false, allClientsAccess: true },
      number: "+17043973212",
      label: "Direct Mail",
    });

    expect(prismaMock.clientAccess.findMany).not.toHaveBeenCalled();
  });
});
