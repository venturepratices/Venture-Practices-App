import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route behind "+ Add name" on the Calls page. It needs the HighLevel
// permission, checks what was sent, and only saves for clients the person can
// see (that part is covered in tests/lib/calls-tracking-labels.test.ts).

class FakePermissionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const requireCapability = vi.hoisted(() => vi.fn());
vi.mock("@/lib/permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapability(...args),
  toErrorResponse: (error: unknown) => {
    if (error instanceof FakePermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  },
}));

const setTrackingLabel = vi.hoisted(() => vi.fn());
vi.mock("@/lib/calls/tracking-labels", async () => {
  const actual = await vi.importActual<typeof import("@/lib/calls/tracking-labels")>("@/lib/calls/tracking-labels");
  return { ...actual, setTrackingLabel: (...args: unknown[]) => setTrackingLabel(...args) };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const route = await import("@/app/api/calls/tracking-labels/route");

const post = (body: unknown, raw = false) =>
  route.POST(
    new Request("http://localhost/api/calls/tracking-labels", {
      method: "POST",
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

describe("POST /api/calls/tracking-labels", () => {
  beforeEach(() => {
    requireCapability.mockResolvedValue({ userId: "u1", isAdmin: true, allClientsAccess: false });
    setTrackingLabel.mockResolvedValue({ ok: true, clients: 1, removed: false });
  });

  afterEach(() => {
    requireCapability.mockReset();
    setTrackingLabel.mockReset();
  });

  it("asks for the HighLevel permission", async () => {
    await post({ number: "+17043973212", label: "Direct Mail" });
    expect(requireCapability).toHaveBeenCalledWith("canManageHighLevel");
  });

  it("not signed in is a 401 and nothing is saved", async () => {
    requireCapability.mockRejectedValue(new FakePermissionError(401, "You need to be signed in."));
    const res = await post({ number: "+17043973212", label: "x" });
    expect(res.status).toBe(401);
    expect(setTrackingLabel).not.toHaveBeenCalled();
  });

  it("no permission is a 403 and nothing is saved", async () => {
    requireCapability.mockRejectedValue(new FakePermissionError(403, "You don't have access to this."));
    const res = await post({ number: "+17043973212", label: "x" });
    expect(res.status).toBe(403);
    expect(setTrackingLabel).not.toHaveBeenCalled();
  });

  it("saves a name and answers ok", async () => {
    const res = await post({ number: "+17043973212", label: "Direct Mail" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, clients: 1, removed: false });
    expect(setTrackingLabel).toHaveBeenCalledWith({
      actor: { userId: "u1", isAdmin: true, allClientsAccess: false },
      number: "+17043973212",
      label: "Direct Mail",
    });
  });

  it("a body that is not JSON is a 400", async () => {
    const res = await post("not json", true);
    expect(res.status).toBe(400);
    expect(setTrackingLabel).not.toHaveBeenCalled();
  });

  it("a bad number or a too-long name is a 400 with a plain message", async () => {
    const badNumber = await post({ number: "hello", label: "x" });
    expect(badNumber.status).toBe(400);
    expect((await badNumber.json()).error).toMatch(/phone number/i);

    const longName = await post({ number: "+17043973212", label: "x".repeat(200) });
    expect(longName.status).toBe(400);
    expect((await longName.json()).error).toMatch(/60 characters/);
    expect(setTrackingLabel).not.toHaveBeenCalled();
  });

  it("a number with no calls is a 404", async () => {
    setTrackingLabel.mockResolvedValue({ ok: false, status: 404, error: "No calls found on that number." });
    const res = await post({ number: "+19999999999", label: "Ghost" });
    expect(res.status).toBe(404);
  });
});
