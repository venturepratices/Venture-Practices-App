import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The HighLevel lead webhook route (spec 9.1): who may call it, what it answers
// for each kind of request, and that a lead is only made for a caller with the
// shared secret. The lead-making itself is covered in lead-intake.test.ts, so
// it is mocked here. Nothing reaches a real database.

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  limitHit: vi.fn(),
  alertAdmins: vi.fn(),
}));

vi.mock("@/lib/sales/lead-intake", () => ({
  createLeadFromIntake: mocks.create,
  intakeLimitHit: mocks.limitHit,
  alertAdminsOfIntakeLimit: mocks.alertAdmins,
}));

import * as route from "@/app/api/webhooks/leads/intake/route";

const SECRET = "test-secret-value-0123456789abcdef";
const NEXT_SECRET = "next-secret-value-fedcba9876543210";
const HEADER = { "x-shared-secret": SECRET };
const PAYLOAD = {
  event: "opt_in",
  ghl_contact_id: "c1",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  phone: "(980) 203-4777",
  practice_name: "Oak Creek Dental",
  practice_zip: "28210",
};

function post(body: unknown, headers: Record<string, string> = {}, raw?: string): Request {
  return new Request("https://app.example/api/webhooks/leads/intake", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

async function answer(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const original = { main: process.env.WEBHOOK_INBOUND_SECRET, next: process.env.WEBHOOK_INBOUND_SECRET_NEXT };

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEBHOOK_INBOUND_SECRET = SECRET;
  delete process.env.WEBHOOK_INBOUND_SECRET_NEXT;
  mocks.limitHit.mockResolvedValue(null);
  mocks.alertAdmins.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ created: true, leadId: "lead-1", ownerId: "owner-1", title: "Oak Creek Dental" });
});

afterEach(() => {
  restore("WEBHOOK_INBOUND_SECRET", original.main);
  restore("WEBHOOK_INBOUND_SECRET_NEXT", original.next);
});

describe("the route", () => {
  it("answers only POST", () => {
    expect(Object.keys(route).filter((name) => ["GET", "PUT", "PATCH", "DELETE", "HEAD"].includes(name))).toEqual([]);
    expect(typeof route.POST).toBe("function");
  });
});

describe("who may call it", () => {
  it.each([[undefined], [""], ["   "]])("answers 503 and makes nothing when the secret is %j and there is no second one", async (value) => {
    if (value === undefined) delete process.env.WEBHOOK_INBOUND_SECRET;
    else process.env.WEBHOOK_INBOUND_SECRET = value;
    const { status } = await answer(await route.POST(post(PAYLOAD, HEADER)));
    expect(status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no secret at all", {}, PAYLOAD],
    ["a wrong header secret", { "x-shared-secret": "nope" }, PAYLOAD],
    ["the word undefined", { "x-shared-secret": "undefined" }, PAYLOAD],
    ["a wrong secret in custom data", {}, { ...PAYLOAD, customData: { secret: "nope" } }],
    ["an empty secret in custom data", {}, { ...PAYLOAD, customData: { secret: "" } }],
    ["the right secret with something added", { "x-shared-secret": `${SECRET}x` }, PAYLOAD],
    ["the right secret cut short", { "x-shared-secret": SECRET.slice(0, -1) }, PAYLOAD],
  ])("answers 401 and makes nothing with %s", async (_label, headers, body) => {
    const { status, body: json } = await answer(await route.POST(post(body, headers)));
    expect(status).toBe(401);
    expect(JSON.stringify(json)).not.toContain(SECRET);
    expect(mocks.limitHit).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("answers 401, not 400, to a caller with no secret whatever the body is", async () => {
    const { status } = await answer(await route.POST(post(null, {}, "this is not json")));
    expect(status).toBe(401);
  });

  it("refuses a wrong header secret without reading the body", async () => {
    const request = post(PAYLOAD, { "x-shared-secret": "nope" });
    const read = vi.spyOn(request, "text");
    const { status } = await answer(await route.POST(request));
    expect(status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts the secret in the x-shared-secret header", async () => {
    const { status } = await answer(await route.POST(post(PAYLOAD, HEADER)));
    expect(status).toBe(200);
  });

  it("accepts the secret in custom data, for a workflow that cannot set a header", async () => {
    const { status } = await answer(await route.POST(post({ ...PAYLOAD, customData: { secret: SECRET } })));
    expect(status).toBe(200);
  });

  it("accepts the second secret too while the secret is being changed, and the first keeps working", async () => {
    process.env.WEBHOOK_INBOUND_SECRET_NEXT = NEXT_SECRET;
    expect((await route.POST(post(PAYLOAD, { "x-shared-secret": NEXT_SECRET }))).status).toBe(200);
    expect((await route.POST(post(PAYLOAD, HEADER))).status).toBe(200);
    expect((await route.POST(post({ ...PAYLOAD, customData: { secret: NEXT_SECRET } }))).status).toBe(200);
    expect((await route.POST(post(PAYLOAD, { "x-shared-secret": "nope" }))).status).toBe(401);
  });

  it("works with only the second secret set", async () => {
    delete process.env.WEBHOOK_INBOUND_SECRET;
    process.env.WEBHOOK_INBOUND_SECRET_NEXT = NEXT_SECRET;
    expect((await route.POST(post(PAYLOAD, { "x-shared-secret": NEXT_SECRET }))).status).toBe(200);
    expect((await route.POST(post(PAYLOAD, HEADER))).status).toBe(401);
  });
});

describe("what it answers", () => {
  it("makes the lead and answers with the lead id, passing along where the call came from", async () => {
    const { status, body } = await answer(
      await route.POST(post(PAYLOAD, { ...HEADER, "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "HighLevel-Test" })),
    );
    expect(status).toBe(200);
    expect(body).toEqual({ lead_id: "lead-1", created: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [intake, meta, now] = mocks.create.mock.calls[0];
    expect(intake).toMatchObject({ ghlContactId: "c1", personName: "Jane Doe", email: "jane@example.com", practiceName: "Oak Creek Dental", practiceZip: "28210" });
    expect(meta).toEqual({ ipAddress: "203.0.113.9", userAgent: "HighLevel-Test" });
    expect(now).toBeInstanceOf(Date);
  });

  it("says when the lead was not new", async () => {
    mocks.create.mockResolvedValue({ created: false, leadId: "lead-9" });
    const { status, body } = await answer(await route.POST(post(PAYLOAD, HEADER)));
    expect(status).toBe(200);
    expect(body).toEqual({ lead_id: "lead-9", created: false });
  });

  it("acknowledges a text reply and makes nothing", async () => {
    const { status, body } = await answer(await route.POST(post({ ...PAYLOAD, event: "text_reply" }, HEADER)));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ignored: true });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("answers 200 with an error, so HighLevel does not retry, when there is nobody to name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { status, body } = await answer(await route.POST(post({ ghl_contact_id: "c1" }, HEADER)));
    expect(status).toBe(200);
    expect(typeof body.error).toBe("string");
    expect(mocks.create).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("answers 200 with an error for an event it does not know", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { status, body } = await answer(await route.POST(post({ ...PAYLOAD, event: "bogus" }, HEADER)));
    expect(status).toBe(200);
    expect(String(body.error)).toMatch(/opt_in/);
    warn.mockRestore();
  });

  it("answers 400 to a body that is not JSON, from a caller with the secret", async () => {
    const { status } = await answer(await route.POST(post(null, HEADER, "not json")));
    expect(status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("answers 413 to a body that is too large", async () => {
    const { status } = await answer(await route.POST(post(null, HEADER, JSON.stringify({ ...PAYLOAD, notes: "x".repeat(40_000) }))));
    expect(status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["burst", "daily"] as const)("answers 429, makes nothing and tells the admins when the %s limit is reached", async (limit) => {
    mocks.limitHit.mockResolvedValue(limit);
    const { status } = await answer(await route.POST(post(PAYLOAD, HEADER)));
    expect(status).toBe(429);
    expect(mocks.alertAdmins).toHaveBeenCalledTimes(1);
    expect(mocks.alertAdmins.mock.calls[0][0]).toBe(limit);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not check the limits or alert anyone for a caller without the secret", async () => {
    mocks.limitHit.mockResolvedValue("burst");
    await route.POST(post(PAYLOAD, { "x-shared-secret": "nope" }));
    expect(mocks.limitHit).not.toHaveBeenCalled();
    expect(mocks.alertAdmins).not.toHaveBeenCalled();
  });

  it("lets a database failure through, so the platform answers 500 and HighLevel retries", async () => {
    mocks.create.mockRejectedValue(new Error("connection lost"));
    await expect(route.POST(post(PAYLOAD, HEADER))).rejects.toThrow("connection lost");
  });

  it("never sends the secret or the body back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const responses = [
      await route.POST(post({ ...PAYLOAD, customData: { secret: SECRET } })),
      await route.POST(post({ ...PAYLOAD, event: "text_reply", customData: { secret: SECRET } })),
      await route.POST(post({ ghl_contact_id: "c1", customData: { secret: SECRET } })),
    ];
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("jane@example.com");
    }
    warn.mockRestore();
  });

  it("never writes the secret or the lead's details to the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await route.POST(post({ ghl_contact_id: "c1", email: "jane@example.com", customData: { secret: SECRET } }));
    await route.POST(post({ ghl_contact_id: "c1", email: "jane@example.com", customData: { secret: SECRET } }, { "x-shared-secret": "nope" }));
    const written = JSON.stringify([warn.mock.calls, error.mock.calls, log.mock.calls]);
    expect(written).not.toContain(SECRET);
    expect(written).not.toContain("jane@example.com");
    warn.mockRestore();
    error.mockRestore();
    log.mockRestore();
  });
});
