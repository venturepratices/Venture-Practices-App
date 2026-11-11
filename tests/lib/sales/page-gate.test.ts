import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate every Sales page runs. People without Sales access get a plain 404
// (the area's existence is not confirmed, Decision 22); signed-out visitors go
// to the login page. Next's notFound and redirect are faked to throw tagged
// errors, the way the real ones throw to stop rendering.

const nav = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("next:not-found");
  }),
  redirect: vi.fn((url: string): never => {
    throw new Error(`next:redirect ${url}`);
  }),
}));
vi.mock("next/navigation", () => nav);

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", () => ({ requireSalesUser: () => requireSalesUserMock() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { requireSalesPage } = await import("@/lib/sales/page-gate");
const { PermissionError } = await import("@/lib/permissions");
type SalesActor = import("@/lib/sales/access").SalesActor;

beforeEach(() => {
  requireSalesUserMock.mockReset();
  nav.notFound.mockClear();
  nav.redirect.mockClear();
});

describe("requireSalesPage", () => {
  it("returns the actor as is", async () => {
    const actor: SalesActor = { userId: "u1", isAdmin: false, seesAllDeals: true, via: "user" };
    requireSalesUserMock.mockResolvedValue(actor);

    await expect(requireSalesPage()).resolves.toBe(actor);
    expect(nav.notFound).not.toHaveBeenCalled();
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("answers 404 to someone without Sales access", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));

    await expect(requireSalesPage()).rejects.toThrow("next:not-found");
    expect(nav.notFound).toHaveBeenCalledTimes(1);
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to the login page", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(401, "You need to be signed in."));

    await expect(requireSalesPage()).rejects.toThrow("next:redirect /login");
    expect(nav.redirect).toHaveBeenCalledWith("/login");
    expect(nav.notFound).not.toHaveBeenCalled();
  });

  it("rethrows anything else", async () => {
    const failure = new Error("db down");
    requireSalesUserMock.mockRejectedValue(failure);

    await expect(requireSalesPage()).rejects.toBe(failure);
    expect(nav.notFound).not.toHaveBeenCalled();
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("rethrows a PermissionError with any other status", async () => {
    const failure = new PermissionError(400, "Bad request.");
    requireSalesUserMock.mockRejectedValue(failure);

    await expect(requireSalesPage()).rejects.toBe(failure);
    expect(nav.notFound).not.toHaveBeenCalled();
  });
});
