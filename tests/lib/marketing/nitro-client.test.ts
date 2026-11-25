import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getFlowEmail, saveFlowEmailDraft } from "@/lib/marketing/nitro-client";

const KEY = "nskey_live_SECRET_VALUE_123";
const RAW_BODY = "RAW-UPSTREAM-BODY-DO-NOT-LEAK";

const flow = {
  id: 19872,
  updated_at: "2026-11-25T10:00:00Z",
  draft_revision_id: 77,
  status: "live",
  steps: [
    { type: "wait", duration: 172800 },
    { type: "email", subject: "Old subject", body: "Old body", content_format: "plain" },
  ],
};

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NITROSEND_API_KEY", KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function assertNoLeak(result: unknown) {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(RAW_BODY);
}

const saveInput = {
  flowId: "19872",
  stepIndex: 1,
  before: { subject: "Old subject", body: "Old body" },
  after: { subject: "New subject", body: "New body" },
};

describe("missing key", () => {
  it("returns missing_key without calling fetch", async () => {
    vi.stubEnv("NITROSEND_API_KEY", "");
    const get = await getFlowEmail("19872", 1);
    const save = await saveFlowEmailDraft(saveInput);
    expect(get.error?.kind).toBe("missing_key");
    expect(save.error?.kind).toBe("missing_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getFlowEmail", () => {
  it("reads subject, body and updatedAt with a Bearer header", async () => {
    fetchMock.mockResolvedValueOnce(json(200, flow));
    const r = await getFlowEmail("19872", 1);
    expect(r.ok).toBe(true);
    expect(r.content).toEqual({
      flowId: "19872",
      stepIndex: 1,
      subject: "Old subject",
      body: "Old body",
      updatedAt: "2026-11-25T10:00:00Z",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.nitrosend.com/v1/my/flows/19872");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("rejects a non-email step", async () => {
    fetchMock.mockResolvedValueOnce(json(200, flow));
    const r = await getFlowEmail("19872", 0);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("unknown");
  });

  it("rejects a non-numeric flow id without calling fetch", async () => {
    const r = await getFlowEmail("../accounts", 1);
    expect(r.error?.kind).toBe("flow_not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("saveFlowEmailDraft", () => {
  it("sends a draft-only PATCH that changes just the one email", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, flow))
      .mockResolvedValueOnce(json(200, { ...flow, updated_at: "2026-11-25T11:00:00Z" }));
    const r = await saveFlowEmailDraft(saveInput);
    expect(r).toEqual({ ok: true, updatedAt: "2026-11-25T11:00:00Z" });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.nitrosend.com/v1/my/flows/19872");
    expect(init.method).toBe("PATCH");
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent).sort()).toEqual(["expected_draft_revision_id", "steps"]);
    expect(sent.expected_draft_revision_id).toBe(77);
    expect(sent.steps[0]).toEqual(flow.steps[0]);
    expect(sent.steps[1]).toMatchObject({ type: "email", subject: "New subject", body: "New body" });
    expect(init.body).not.toMatch(/publish|"status"|approval_state/);
  });

  it("maps a 409 stale-revision to unknown with a reopen message", async () => {
    fetchMock.mockResolvedValueOnce(json(200, flow)).mockResolvedValueOnce(json(409, RAW_BODY));
    const r = await saveFlowEmailDraft(saveInput);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("unknown");
    expect(r.error?.message).toMatch(/changed in NitroSend/);
    assertNoLeak(r);
  });
});

describe("error mapping", () => {
  const cases: Array<[number, string]> = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "flow_not_found"],
    [429, "rate_limited"],
    [500, "api_unreachable"],
    [503, "api_unreachable"],
    [400, "unknown"],
  ];

  it.each(cases)("GET %i -> %s", async (status, kind) => {
    fetchMock.mockResolvedValueOnce(json(status, RAW_BODY));
    const r = await getFlowEmail("19872", 1);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe(kind);
    assertNoLeak(r);
    for (const call of vi.mocked(console.error).mock.calls) {
      const logged = JSON.stringify(call);
      expect(logged).not.toContain(KEY);
      expect(logged).not.toContain(RAW_BODY);
    }
  });

  it.each(cases)("save PATCH %i -> %s", async (status, kind) => {
    fetchMock.mockResolvedValueOnce(json(200, flow)).mockResolvedValueOnce(json(status, RAW_BODY));
    const r = await saveFlowEmailDraft(saveInput);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe(kind);
    assertNoLeak(r);
  });

  it("network error -> api_unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error(`connect failed with ${KEY}`));
    const r = await getFlowEmail("19872", 1);
    expect(r.error?.kind).toBe("api_unreachable");
    assertNoLeak(r);
    for (const call of vi.mocked(console.error).mock.calls) {
      expect(JSON.stringify(call)).not.toContain(KEY);
    }
  });

  it("network error on save -> api_unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const r = await saveFlowEmailDraft(saveInput);
    expect(r.error?.kind).toBe("api_unreachable");
  });
});
