import { describe, expect, it, vi } from "vitest";

import { createPipedriveClient, PipedriveError, pipedriveTokenInfo, requestTimeoutMs } from "@/lib/sales/pipedrive/client";

// The read-only Pipedrive client. Every test hands it a fake fetch that records
// what the client sent, so these check real requests: which URL, which method,
// where the token went, and what an error says. Nothing here touches the network.

const TOKEN = "tok_9f8e7d6c5b4a39281716abcd";

type Call = { url: string; init: RequestInit };
type Step = Response | Error | (() => Response);

/** More calls than any test here needs: past it the fake refuses, so a client that loops forever fails a test instead of hanging the run. */
const RUNAWAY_CALLS = 100;

/** A fake fetch that plays `steps` in order (the last one repeats) and records every call. */
function fakeFetch(steps: Step[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (calls.length > RUNAWAY_CALLS) return json({ success: false, error: "runaway" }, 400);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step() : step.clone();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function makeClient(steps: Step[]) {
  const fake = fakeFetch(steps);
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const client = createPipedriveClient({ token: TOKEN, fetchImpl: fake.fetchImpl, sleep });
  return { ...fake, sleep, client };
}

async function collect<T>(pages: AsyncGenerator<T[], void, void>): Promise<T[][]> {
  const out: T[][] = [];
  for await (const page of pages) out.push(page);
  return out;
}

function paramsOf(call: Call): URLSearchParams {
  return new URL(call.url).searchParams;
}

describe("cursor pages (API v2)", () => {
  it("follows additional_data.next_cursor until it is null and yields each page", async () => {
    const { client, calls } = makeClient([
      json({ success: true, data: [{ id: 1 }, { id: 2 }], additional_data: { next_cursor: "c2" } }),
      json({ success: true, data: [{ id: 3 }], additional_data: { next_cursor: null } }),
    ]);

    const pages = await collect(client.pages<{ id: number }>("/api/v2/deals", { limit: 2 }));

    expect(pages).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).origin).toBe("https://api.pipedrive.com");
    expect(new URL(calls[0].url).pathname).toBe("/api/v2/deals");
    expect(paramsOf(calls[0]).get("limit")).toBe("2");
    expect(paramsOf(calls[0]).has("cursor")).toBe(false);
    expect(paramsOf(calls[1]).get("cursor")).toBe("c2");
    expect(paramsOf(calls[1]).get("limit")).toBe("2");
  });

  it("is the default style, and passes the caller's params through", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [{ id: 1 }], additional_data: {} })]);

    await collect(client.pages("/api/v2/activities", { params: { done: "false", owner_id: 7 } }));

    expect(paramsOf(calls[0]).get("done")).toBe("false");
    expect(paramsOf(calls[0]).get("owner_id")).toBe("7");
    // No limit given means none sent: Pipedrive's own default (100) applies.
    expect(paramsOf(calls[0]).has("limit")).toBe(false);
  });

  it("stops at once when the cursor is missing, not only when it is null", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [{ id: 1 }] })]);

    expect(await collect(client.pages("/api/v2/stages"))).toEqual([[{ id: 1 }]]);
    expect(calls).toHaveLength(1);
  });

  it("also finds the cursor under additional_data.pagination, which one Pipedrive guide shows", async () => {
    // The docs disagree on where the cursor sits. Reading both means a response
    // shaped the other way cannot silently cut an import short after page one.
    const { client, calls } = makeClient([
      json({ success: true, data: [{ id: 1 }], additional_data: { pagination: { next_cursor: "n2" } } }),
      json({ success: true, data: [{ id: 2 }], additional_data: { pagination: { next_cursor: null } } }),
    ]);

    expect(await collect(client.pages("/api/v2/persons"))).toEqual([[{ id: 1 }], [{ id: 2 }]]);
    expect(paramsOf(calls[1]).get("cursor")).toBe("n2");
  });

  it("yields nothing for an empty or null data array", async () => {
    const empty = makeClient([json({ success: true, data: [], additional_data: { next_cursor: null } })]);
    expect(await collect(empty.client.pages("/api/v2/deals"))).toEqual([]);

    const nothing = makeClient([json({ success: true, data: null, additional_data: { next_cursor: null } })]);
    expect(await collect(nothing.client.pages("/api/v2/deals"))).toEqual([]);
  });

  it("skips an empty page that still names a next cursor, and keeps going", async () => {
    const { client } = makeClient([
      json({ success: true, data: [], additional_data: { next_cursor: "c2" } }),
      json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: null } }),
    ]);

    expect(await collect(client.pages("/api/v2/deals"))).toEqual([[{ id: 1 }]]);
  });

  it("throws, not loops, when the server hands back a cursor it already gave", async () => {
    const same = json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: "same" } });
    const { client, calls } = makeClient([same]);

    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(200);
    expect((failure as PipedriveError).message).toBe(
      "Pipedrive repeated a page cursor, so the copy stopped instead of looping.",
    );
    // First page names "same", the second page names it again: stop there.
    expect(calls).toHaveLength(2);
  });

  it("throws on a cursor loop of A, B, A even when every page is empty", async () => {
    // With no rows to hand back, the caller could never break out of this on its own.
    const a = json({ success: true, data: [], additional_data: { next_cursor: "A" } });
    const b = json({ success: true, data: [], additional_data: { next_cursor: "B" } });
    const { client, calls } = makeClient([a, b, a]);

    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).toContain("repeated a page cursor");
    expect(calls).toHaveLength(3);
  });

  it("throws, not ends early, when next_cursor is present but not a usable string", async () => {
    for (const bad of [123, "", {}, false]) {
      const { client, calls } = makeClient([
        json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: bad } }),
      ]);

      const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(PipedriveError);
      expect((failure as PipedriveError).status).toBe(200);
      expect((failure as PipedriveError).message).toContain("not usable");
      expect(calls).toHaveLength(1);
    }
  });

  it("reports a 200 reply that is not JSON as a PipedriveError", async () => {
    const { client } = makeClient([new Response("<html>maintenance</html>", { status: 200 })]);

    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).toContain("not JSON");
  });

  it("does not follow a redirect on a list call, so the token never leaves Pipedrive", async () => {
    const { client, calls } = makeClient([
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example/x" } }),
    ]);

    await expect(collect(client.pages("/api/v2/deals"))).rejects.toBeInstanceOf(PipedriveError);
    expect(calls).toHaveLength(1);
  });
});

describe("offset pages (API v1)", () => {
  it("follows next_start while more_items_in_collection is true", async () => {
    const { client, calls } = makeClient([
      json({
        success: true,
        data: [{ id: 1 }, { id: 2 }],
        additional_data: { pagination: { start: 0, limit: 2, more_items_in_collection: true, next_start: 2 } },
      }),
      json({
        success: true,
        data: [{ id: 3 }],
        additional_data: { pagination: { start: 2, limit: 2, more_items_in_collection: false } },
      }),
    ]);

    const pages = await collect(client.pages<{ id: number }>("/v1/notes", { style: "offset", limit: 2 }));

    expect(pages).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).pathname).toBe("/v1/notes");
    expect(paramsOf(calls[0]).get("start")).toBe("0");
    expect(paramsOf(calls[0]).get("limit")).toBe("2");
    expect(paramsOf(calls[1]).get("start")).toBe("2");
  });

  it("stops when the pagination block is missing", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [{ id: 1 }] })]);

    expect(await collect(client.pages("/v1/users", { style: "offset" }))).toEqual([[{ id: 1 }]]);
    expect(calls).toHaveLength(1);
  });

  it("throws, not ends early, when Pipedrive says there is more but gives no usable next_start", async () => {
    // A quiet stop here would look like a finished import with rows missing.
    const unusable = [
      { more_items_in_collection: true },
      { more_items_in_collection: true, next_start: "2" },
      { more_items_in_collection: true, next_start: null },
      // Does not move forward from the start of 0 it was asked for: it would loop forever.
      { more_items_in_collection: true, next_start: 0 },
    ];
    for (const pagination of unusable) {
      const { client, calls } = makeClient([
        json({ success: true, data: [{ id: 1 }], additional_data: { pagination } }),
      ]);

      const failure = await collect(client.pages("/v1/leads", { style: "offset" })).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(PipedriveError);
      expect((failure as PipedriveError).status).toBe(200);
      expect((failure as PipedriveError).message).toContain("no usable place to continue");
      expect(calls).toHaveLength(1);
    }
  });
});

describe("retries", () => {
  it("waits Retry-After seconds on a 429, retries, then succeeds", async () => {
    const { client, calls, sleep } = makeClient([
      json({ success: false, error: "Rate limit" }, 429, { "retry-after": "2" }),
      json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: null } }),
    ]);

    expect(await collect(client.pages("/api/v2/deals"))).toEqual([[{ id: 1 }]]);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("backs off 1s, 2s, 4s, 8s without a Retry-After, and gives up after 4 retries", async () => {
    // Pipedrive does not document Retry-After, so the backoff has to stand alone.
    const { client, calls, sleep } = makeClient([json({ success: false, error: "Rate limit" }, 429)]);

    await expect(collect(client.pages("/api/v2/deals"))).rejects.toMatchObject({ status: 429 });

    expect(calls).toHaveLength(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000, 8000]);
  });

  it("throws a PipedriveError after repeated 5xx replies", async () => {
    const { client, calls } = makeClient([json({ success: false, error: "Bad gateway" }, 502)]);

    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(502);
    expect(calls).toHaveLength(5);
  });

  it("recovers when a 5xx is followed by a good reply", async () => {
    const { client, sleep } = makeClient([
      json({}, 503),
      json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: null } }),
    ]);

    expect(await collect(client.pages("/api/v2/deals"))).toEqual([[{ id: 1 }]]);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("caps an absurd Retry-After so one reply cannot park the import for an hour", async () => {
    const { client, sleep } = makeClient([
      json({}, 429, { "retry-after": "3600" }),
      json({ success: true, data: [], additional_data: { next_cursor: null } }),
    ]);

    await collect(client.pages("/api/v2/deals"));

    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("retries a dropped connection, then reports it without the underlying error text", async () => {
    const dropped = new TypeError(`fetch failed for https://api.pipedrive.com/api/v2/deals?api_token=${TOKEN}`);
    const { client, calls } = makeClient([dropped]);

    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(0);
    expect((failure as PipedriveError).message).not.toContain(TOKEN);
    expect((failure as PipedriveError).message).not.toContain("api_token");
    expect(calls).toHaveLength(5);
  });

  it.each([
    // Zero is a wait of zero. Anything Pipedrive sends that is not a plain
    // non-negative number of seconds (its docs promise none) uses the backoff.
    ["0", 0],
    ["-5", 1000],
    ["soon", 1000],
    ["Wed, 21 Oct 2026 07:28:00 GMT", 1000],
  ])("treats a Retry-After of %j as a wait of %i ms", async (header, expected) => {
    const { client, sleep } = makeClient([
      json({}, 429, { "retry-after": header }),
      json({ success: true, data: [], additional_data: { next_cursor: null } }),
    ]);

    await collect(client.pages("/api/v2/deals"));

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(expected);
  });

  it("gives every request a 60 second timeout", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [], additional_data: {} })]);
    await collect(client.pages("/api/v2/deals"));

    const dl = makeClient([new Response(new Uint8Array([1]), { status: 200 })]);
    await dl.client.download("/v1/files/9/download");

    for (const call of [...calls, ...dl.calls]) {
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(call.init.signal?.aborted).toBe(false);
    }
  });

  it("treats a timed out request like a dropped connection: status 0, retried within the same bounds", async () => {
    const timedOut = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const { client, calls, sleep } = makeClient([timedOut]);

    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(0);
    expect(calls).toHaveLength(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("recovers when one attempt is aborted and the next answers", async () => {
    const aborted = new DOMException("This operation was aborted", "AbortError");
    const { client, calls } = makeClient([
      aborted,
      json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: null } }),
    ]);

    expect(await collect(client.pages("/api/v2/deals"))).toEqual([[{ id: 1 }]]);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 401, 403 or 404, which would only fail again", async () => {
    for (const status of [401, 403, 404]) {
      const { client, calls, sleep } = makeClient([json({ success: false, error: "nope" }, status)]);
      await expect(collect(client.pages("/api/v2/deals"))).rejects.toMatchObject({ status });
      expect(calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });
});

describe("read-only by construction", () => {
  it("sends only GET, with no body, on every kind of call", async () => {
    const cursor = makeClient([json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: null } })]);
    await collect(cursor.client.pages("/api/v2/deals"));

    const offset = makeClient([json({ success: true, data: [{ id: 1 }] })]);
    await collect(offset.client.pages("/v1/notes", { style: "offset" }));

    const download = makeClient([new Response(new Uint8Array([1, 2, 3]), { status: 200 })]);
    await download.client.download("/v1/files/9/download");

    const retried = makeClient([json({}, 503), json({ success: true, data: [], additional_data: {} })]);
    await collect(retried.client.pages("/api/v2/deals"));

    const all = [...cursor.calls, ...offset.calls, ...download.calls, ...retried.calls];
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const call of all) {
      expect(call.init.method).toBe("GET");
      expect(call.init.body).toBeUndefined();
    }
  });

  it("exposes only pages, pageBatches and download", () => {
    const { client } = makeClient([json({})]);
    expect(Object.keys(client).sort()).toEqual(["download", "pageBatches", "pages"]);
  });
});

describe("offset lists that send no pagination block (Pipedrive leads)", () => {
  async function batchesOf(steps: Step[], limit?: number) {
    const { client, calls } = makeClient(steps);
    const out: { items: unknown[]; resumeAt: unknown }[] = [];
    for await (const batch of client.pageBatches("/v1/leads", { style: "offset", limit })) out.push(batch);
    return { out, starts: calls.map((c) => paramsOf(c).get("start")) };
  }

  it("keeps paging after a full page and ends cleanly after a short one", async () => {
    const { out, starts } = await batchesOf(
      [json({ success: true, data: [{ id: 1 }, { id: 2 }] }), json({ success: true, data: [{ id: 3 }] })],
      2,
    );
    expect(out).toEqual([
      { items: [{ id: 1 }, { id: 2 }], resumeAt: { start: 2 } },
      { items: [{ id: 3 }], resumeAt: null },
    ]);
    expect(starts).toEqual(["0", "2"]);
  });

  it("ends on an empty page after a full one", async () => {
    const { out } = await batchesOf([json({ success: true, data: [{ id: 1 }, { id: 2 }] }), json({ success: true, data: [] })], 2);
    expect(out.map((b) => b.resumeAt)).toEqual([{ start: 2 }, null]);
  });

  it("ends after a short first page", async () => {
    const { out, starts } = await batchesOf([json({ success: true, data: [{ id: 1 }] })], 2);
    expect(out).toEqual([{ items: [{ id: 1 }], resumeAt: null }]);
    expect(starts).toEqual(["0"]);
  });

  it("uses Pipedrive's default page size of 100 when no limit is sent", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const { out, starts } = await batchesOf([json({ success: true, data: full }), json({ success: true, data: [] })]);
    expect(out.map((b) => b.resumeAt)).toEqual([{ start: 100 }, null]);
    expect(starts).toEqual(["0", "100"]);
  });

  it("still obeys a pagination block that says there is no more, even after a full page", async () => {
    const { out } = await batchesOf(
      [json({ success: true, data: [{ id: 1 }, { id: 2 }], additional_data: { pagination: { more_items_in_collection: false } } })],
      2,
    );
    expect(out.map((b) => b.resumeAt)).toEqual([null]);
  });

  it("stops with an error when the same full page comes back again and again", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [{ id: 1 }, { id: 2 }] })]);
    const failure = await (async () => {
      for await (const batch of client.pageBatches("/v1/leads", { style: "offset", limit: 2 })) void batch;
    })().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).toContain("sent the same page twice");
    expect(calls).toHaveLength(2);
  });

  it("stops with an error at the page ceiling when pages never repeat and never end", async () => {
    let n = 0;
    const { client } = makeClient([() => json({ success: true, data: [{ id: ++n }, { id: ++n }] })]);
    const failure = await (async () => {
      for await (const batch of client.pageBatches("/v1/leads", { style: "offset", limit: 2, maxPages: 5 })) void batch;
    })().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).toContain("more pages than any real list");
  });
});

describe("pageBatches (resumable pages)", () => {
  async function collectBatches<T>(gen: AsyncGenerator<{ items: T[]; resumeAt: unknown }>) {
    const out: { items: T[]; resumeAt: unknown }[] = [];
    for await (const batch of gen) out.push(batch);
    return out;
  }

  it("gives each cursor page with where the next page starts, null after the last", async () => {
    const { client, calls } = makeClient([
      json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: "c2" } }),
      json({ success: true, data: [{ id: 2 }], additional_data: { next_cursor: null } }),
    ]);

    const batches = await collectBatches(client.pageBatches<{ id: number }>("/api/v2/deals", { limit: 1 }));

    expect(batches).toEqual([
      { items: [{ id: 1 }], resumeAt: { cursor: "c2" } },
      { items: [{ id: 2 }], resumeAt: null },
    ]);
    expect(paramsOf(calls[0]).get("cursor")).toBeNull();
    expect(paramsOf(calls[1]).get("cursor")).toBe("c2");
  });

  it("starts at a saved cursor and never re-reads the pages before it", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [{ id: 2 }], additional_data: { next_cursor: null } })]);

    const batches = await collectBatches(client.pageBatches("/api/v2/deals", { resumeAt: { cursor: "c2" } }));

    expect(calls).toHaveLength(1);
    expect(paramsOf(calls[0]).get("cursor")).toBe("c2");
    expect(batches).toEqual([{ items: [{ id: 2 }], resumeAt: null }]);
  });

  it("refuses a cursor that sends it back to the page it resumed at", async () => {
    const { client } = makeClient([json({ success: true, data: [{ id: 2 }], additional_data: { next_cursor: "c2" } })]);

    const failure = await collectBatches(client.pageBatches("/api/v2/deals", { resumeAt: { cursor: "c2" } })).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).toContain("repeated a page cursor");
  });

  it("gives each offset page with the next start, and starts at a saved start", async () => {
    const { client, calls } = makeClient([
      json({ success: true, data: [{ id: 3 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 3 } } }),
      json({ success: true, data: [{ id: 4 }], additional_data: { pagination: { more_items_in_collection: false } } }),
    ]);

    const batches = await collectBatches(
      client.pageBatches("/v1/notes", { style: "offset", limit: 1, resumeAt: { start: 2 } }),
    );

    expect(batches).toEqual([
      { items: [{ id: 3 }], resumeAt: { start: 3 } },
      { items: [{ id: 4 }], resumeAt: null },
    ]);
    expect(paramsOf(calls[0]).get("start")).toBe("2");
    expect(paramsOf(calls[1]).get("start")).toBe("3");
  });

  it("refuses an offset that does not move past the saved start", async () => {
    const { client } = makeClient([
      json({ success: true, data: [{ id: 3 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 2 } } }),
    ]);

    const failure = await collectBatches(client.pageBatches("/v1/notes", { style: "offset", resumeAt: { start: 2 } })).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(PipedriveError);
  });

  it("gives an empty page too, so its place can still be saved", async () => {
    const { client } = makeClient([json({ success: true, data: [], additional_data: { next_cursor: null } })]);

    expect(await collectBatches(client.pageBatches("/api/v2/deals"))).toEqual([{ items: [], resumeAt: null }]);
  });

  it("refuses a saved place of the wrong kind for the paging style", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [] })]);

    const failure = await collectBatches(client.pageBatches("/api/v2/deals", { resumeAt: { start: 5 } })).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(calls).toHaveLength(0);
  });

  it("refuses a bad saved place as a PipedriveError, so the import can close the run", async () => {
    const { client } = makeClient([json({ success: true, data: [] })]);
    const failure = await collectBatches(client.pageBatches("/v1/leads", { style: "offset", resumeAt: { cursor: "c1" } })).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).toBe("The saved page position does not fit this list.");
  });

  it("sends only GET with the token in the header", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: null } })]);

    await collectBatches(client.pageBatches("/api/v2/deals", { resumeAt: { cursor: "c9" } }));

    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>)["x-api-token"]).toBe(TOKEN);
    expect(calls[0].url).not.toContain(TOKEN);
  });
});

describe("the token", () => {
  it("goes in the x-api-token header and never in a URL", async () => {
    const { client, calls } = makeClient([
      json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: "c2" } }),
      json({ success: true, data: [{ id: 2 }], additional_data: { next_cursor: null } }),
    ]);
    await collect(client.pages("/api/v2/deals", { params: { status: "open" } }));

    const dl = makeClient([new Response(new Uint8Array([1]), { status: 200 })]);
    await dl.client.download("/v1/files/9/download");

    for (const call of [...calls, ...dl.calls]) {
      expect(new Headers(call.init.headers).get("x-api-token")).toBe(TOKEN);
      expect(call.url).not.toContain(TOKEN);
      expect(call.url).not.toContain("api_token");
    }
  });

  it("is trimmed, so a pasted trailing newline cannot break the header", async () => {
    const fake = fakeFetch([json({ success: true, data: [], additional_data: {} })]);
    const client = createPipedriveClient({ token: `  ${TOKEN}\n`, fetchImpl: fake.fetchImpl });
    await collect(client.pages("/api/v2/deals"));
    expect(new Headers(fake.calls[0].init.headers).get("x-api-token")).toBe(TOKEN);
  });

  it("must not be blank", () => {
    expect(() => createPipedriveClient({ token: "   " })).toThrow(/token/i);
  });

  it("never reaches an error message, even when Pipedrive echoes it back", async () => {
    const echoes = makeClient([json({ success: false, error: `Invalid api_token ${TOKEN} supplied` }, 401)]);
    const failure = await collect(echoes.client.pages("/api/v2/deals?cursor=zzz", { params: { q: "x" } })).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(PipedriveError);
    const message = (failure as PipedriveError).message;
    expect(message).toContain("401");
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("api_token");
    // Nor the request URL or its query string.
    expect(message).not.toContain("pipedrive.com");
    expect(message).not.toContain("cursor=zzz");
    expect(message).not.toContain("q=x");
  });

  it("is absent from the error of every failing status", async () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const { client } = makeClient([json({ success: false, error: `bad ${TOKEN}` }, status)]);
      const failure = await collect(client.pages("/api/v2/deals", { params: { x: 1 } })).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(PipedriveError);
      expect((failure as PipedriveError).status).toBe(status);
      expect((failure as PipedriveError).message).not.toContain(TOKEN);
      expect((failure as PipedriveError).message).not.toContain("api_token");
    }
  });

  it("still gives a clean message when the error body is HTML, as Cloudflare's 403 is", async () => {
    const html = new Response("<html><body>Blocked</body></html>", { status: 403, headers: { "content-type": "text/html" } });
    const { client } = makeClient([html]);

    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).toContain("403");
    expect((failure as PipedriveError).message).not.toContain("<html>");
  });

  it("names the path of the request that failed, so a stop on one list can be told from another", async () => {
    // Real case: a 404 "Unknown method ." on the leads list that the old message
    // could not place, so nobody could tell which of a dozen lists had stopped.
    const { client } = makeClient([json({ success: false, error: "Unknown method ." }, 404)]);

    const failure = await collect(client.pages("/v1/leads", { style: "offset", limit: 100 })).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(404);
    expect((failure as PipedriveError).message).toBe(
      'Pipedrive request failed (HTTP 404) for /v1/leads: not found in Pipedrive. Pipedrive said: "Unknown method ."',
    );
  });

  it("names the path for a dropped connection too, and for a v2 list", async () => {
    const down = makeClient([new TypeError("fetch failed")]);
    const failure = await collect(down.client.pages("/api/v2/deals")).catch((e: unknown) => e);
    expect((failure as PipedriveError).status).toBe(0);
    expect((failure as PipedriveError).message).toBe(
      "Pipedrive request failed (no reply) for /api/v2/deals: could not reach Pipedrive.",
    );
  });

  it("shows the path only: no host, no query string, no token, even when the caller put them in the path", async () => {
    const { client } = makeClient([json({ success: false, error: "nope" }, 404)]);

    const failure = await collect(
      client.pages(`/v1/leads/archived?api_token=${TOKEN}&q=x`, { style: "offset", params: { start: 5, filter_id: 9 } }),
    ).catch((e: unknown) => e);

    const message = (failure as PipedriveError).message;
    expect(message).toContain("for /v1/leads/archived:");
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("api_token");
    expect(message).not.toContain("pipedrive.com");
    expect(message).not.toContain("q=x");
    expect(message).not.toContain("filter_id");
    expect(message).not.toContain("?");
  });

  it("names no path for a failure on the file host, where the path of a signed link can be a secret", async () => {
    const { client } = makeClient([
      new Response(null, { status: 302, headers: { location: "https://files.example-storage.com/signed-secret-path/abc" } }),
      json({ error: "expired" }, 403),
    ]);

    const failure = await client.download("/v1/files/5/download").catch((e: unknown) => e);

    const message = (failure as PipedriveError).message;
    expect(message).toContain("file host");
    expect(message).not.toContain("signed-secret-path");
    expect(message).not.toContain("/v1/files");
  });

  it("refuses a path that would send the token to another host", async () => {
    const { client, calls } = makeClient([json({ success: true, data: [], additional_data: {} })]);

    await expect(collect(client.pages("https://evil.example/steal"))).rejects.toThrow();
    await expect(collect(client.pages("//evil.example/steal"))).rejects.toThrow();
    await expect(client.download("https://evil.example/steal")).rejects.toThrow();

    expect(calls).toHaveLength(0);
  });
});

describe("download", () => {
  it("returns the raw bytes and the content type", async () => {
    const { client, calls } = makeClient([
      new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } }),
    ]);

    const file = await client.download("/v1/files/42/download");

    expect(Array.from(file.bytes)).toEqual([37, 80, 68, 70]);
    expect(file.contentType).toBe("application/pdf");
    expect(new URL(calls[0].url).pathname).toBe("/v1/files/42/download");
  });

  it("falls back to octet-stream when Pipedrive names no type", async () => {
    const bare = new Response(new Uint8Array([1]), { status: 200 });
    bare.headers.delete("content-type");
    const { client } = makeClient([bare]);

    expect((await client.download("/v1/files/1/download")).contentType).toBe("application/octet-stream");
  });

  it("follows a redirect to the file store without sending the token there", async () => {
    // The docs do not say whether the download answers with bytes or a redirect.
    // If it redirects to a storage host, that host must not get the token.
    const { client, calls } = makeClient([
      new Response(null, { status: 302, headers: { location: "https://files.example-storage.com/abc?sig=1" } }),
      new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "image/png" } }),
    ]);

    const file = await client.download("/v1/files/5/download");

    expect(Array.from(file.bytes)).toEqual([9]);
    expect(file.contentType).toBe("image/png");
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0].init.headers).get("x-api-token")).toBe(TOKEN);
    expect(new Headers(calls[1].init.headers).has("x-api-token")).toBe(false);
    expect(calls[1].url).toBe("https://files.example-storage.com/abc?sig=1");
    expect(calls.every((c) => c.init.method === "GET")).toBe(true);
  });

  it("keeps the token on a redirect that stays on Pipedrive's own host", async () => {
    const { client, calls } = makeClient([
      new Response(null, { status: 301, headers: { location: "/v1/files/5/download?x=1" } }),
      new Response(new Uint8Array([9]), { status: 200 }),
    ]);

    await client.download("/v1/files/5/download");

    expect(new Headers(calls[1].init.headers).get("x-api-token")).toBe(TOKEN);
  });

  it("gives up on a redirect loop with a clean error", async () => {
    const loop = new Response(null, { status: 302, headers: { location: "/v1/files/5/download" } });
    const { client } = makeClient([loop]);

    const failure = await client.download("/v1/files/5/download").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).message).not.toContain(TOKEN);
  });

  it("throws a PipedriveError when the file is gone", async () => {
    const { client } = makeClient([json({ success: false, error: "File not found" }, 404)]);

    await expect(client.download("/v1/files/404/download")).rejects.toMatchObject({ status: 404 });
  });

  it("sends the token again when a redirect through the file host comes back to Pipedrive", async () => {
    const { client, calls } = makeClient([
      new Response(null, { status: 302, headers: { location: "https://files.example-storage.com/abc" } }),
      new Response(null, { status: 302, headers: { location: "https://api.pipedrive.com/v1/files/5/final" } }),
      new Response(new Uint8Array([7]), { status: 200 }),
    ]);

    const file = await client.download("/v1/files/5/download");

    expect(Array.from(file.bytes)).toEqual([7]);
    expect(calls).toHaveLength(3);
    expect(new Headers(calls[0].init.headers).get("x-api-token")).toBe(TOKEN);
    expect(new Headers(calls[1].init.headers).has("x-api-token")).toBe(false);
    expect(new Headers(calls[2].init.headers).get("x-api-token")).toBe(TOKEN);
  });

  it("refuses a redirect off Pipedrive that is not https, before sending anything there", async () => {
    const { client, calls } = makeClient([
      new Response(null, { status: 302, headers: { location: "http://files.example-storage.com/abc" } }),
    ]);

    const failure = await client.download("/v1/files/5/download").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(302);
    expect((failure as PipedriveError).message).toContain("not secure");
    expect(calls).toHaveLength(1);
  });

  it("turns a redirect with an unreadable Location into a PipedriveError, not a raw TypeError", async () => {
    const { client, calls } = makeClient([new Response(null, { status: 302, headers: { location: "http://" } })]);

    const failure = await client.download("/v1/files/5/download").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(302);
    expect((failure as PipedriveError).message).toContain("no usable destination");
    expect((failure as PipedriveError).message).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
  });

  it("words a failure from the file host as the file host's, not Pipedrive's, and still keeps the token out", async () => {
    // An expired signed link looks like a bad token if the message blames Pipedrive.
    const { client, calls } = makeClient([
      new Response(null, { status: 302, headers: { location: "https://files.example-storage.com/abc?sig=1" } }),
      json({ error: `SignatureDoesNotMatch for ${TOKEN}` }, 403),
    ]);

    const failure = await client.download("/v1/files/5/download").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(403);
    const message = (failure as PipedriveError).message;
    expect(message).toContain("file host");
    expect(message).not.toContain("Pipedrive");
    expect(message).not.toContain("token");
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("files.example-storage.com");
    expect(message).not.toContain("sig=1");
    expect(calls).toHaveLength(2);
  });

  it("also words an unreachable file host as the file host's", async () => {
    const { client } = makeClient([
      new Response(null, { status: 302, headers: { location: "https://files.example-storage.com/abc" } }),
      new TypeError("fetch failed"),
    ]);

    const failure = await client.download("/v1/files/5/download").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PipedriveError);
    expect((failure as PipedriveError).status).toBe(0);
    expect((failure as PipedriveError).message).toContain("file host");
    expect((failure as PipedriveError).message).not.toContain("Pipedrive");
  });
});

describe("base URL", () => {
  const make = (baseUrl: string) => createPipedriveClient({ token: TOKEN, baseUrl });

  it("must be https, so the token never goes over plain HTTP", () => {
    expect(() => make("http://api.pipedrive.com")).toThrow(/https/);
    expect(() => make("ftp://api.pipedrive.com")).toThrow(/https/);
  });

  it("allows https, and plain http only for localhost and 127.0.0.1 (for tests)", () => {
    expect(() => make("https://api.pipedrive.com")).not.toThrow();
    expect(() => make("https://example.pipedrive.com")).not.toThrow();
    expect(() => make("http://localhost:4010")).not.toThrow();
    expect(() => make("http://127.0.0.1:4010")).not.toThrow();
  });

  it("does not let a look-alike host pass as localhost", () => {
    expect(() => make("http://localhost.evil.example")).toThrow(/https/);
    expect(() => make("http://localhost@evil.example")).toThrow(/https/);
  });

  it("defaults to the real Pipedrive host", async () => {
    const fake = fakeFetch([json({ success: true, data: [], additional_data: {} })]);
    const client = createPipedriveClient({ token: TOKEN, fetchImpl: fake.fetchImpl });
    await collect(client.pages("/api/v2/deals"));
    expect(new URL(fake.calls[0].url).origin).toBe("https://api.pipedrive.com");
  });
});

describe("pipedriveTokenInfo", () => {
  it("reports a set token by its last four characters only", () => {
    expect(pipedriveTokenInfo({ PIPEDRIVE_API_TOKEN: "abcd1234" })).toEqual({ set: true, last4: "1234" });
  });

  it("reports an unset or blank token as not set", () => {
    expect(pipedriveTokenInfo({})).toEqual({ set: false, last4: null });
    expect(pipedriveTokenInfo({ PIPEDRIVE_API_TOKEN: "" })).toEqual({ set: false, last4: null });
    expect(pipedriveTokenInfo({ PIPEDRIVE_API_TOKEN: "   \n" })).toEqual({ set: false, last4: null });
  });

  it("ignores whitespace around the value", () => {
    expect(pipedriveTokenInfo({ PIPEDRIVE_API_TOKEN: "  abcd1234\n" })).toEqual({ set: true, last4: "1234" });
  });

  it("shows no characters of a token too short to hide half of", () => {
    expect(pipedriveTokenInfo({ PIPEDRIVE_API_TOKEN: "abc123" })).toEqual({ set: true, last4: null });
  });
});

describe("a chunk deadline", () => {
  const T0 = new Date("2026-11-13T15:00:00.000Z");
  const PAUSE = "Pipedrive is slow right now. The copy will continue in a minute.";

  function deadlineClient(steps: Step[], secondsLeft: number) {
    const fake = fakeFetch(steps);
    let clock = T0.getTime();
    const sleep = vi.fn<(ms: number) => Promise<void>>(async (ms) => {
      clock += ms;
    });
    const client = createPipedriveClient({
      token: TOKEN,
      fetchImpl: fake.fetchImpl,
      sleep,
      deadline: new Date(T0.getTime() + secondsLeft * 1000),
      now: () => new Date(clock),
    });
    return { ...fake, sleep, client };
  }

  it("pauses at once, without sleeping, when the wait would cross the deadline", async () => {
    const { client, calls, sleep } = deadlineClient([json({ error: "slow down" }, 429, { "retry-after": "10" })], 12);
    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PipedriveError);
    expect(failure).toMatchObject({ status: 429, message: PAUSE });
    expect(sleep).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect((failure as Error).message).not.toContain(TOKEN);
  });

  it("still retries when the wait fits before the deadline", async () => {
    const { client, sleep } = deadlineClient(
      [json({ error: "slow down" }, 429), json({ success: true, data: [{ id: 1 }], additional_data: { next_cursor: null } })],
      40,
    );
    expect(await collect(client.pages("/api/v2/deals"))).toEqual([[{ id: 1 }]]);
    expect(sleep.mock.calls).toEqual([[1000]]);
  });

  it("pauses before sending when fewer than 3 seconds are left", async () => {
    const { client, calls } = deadlineClient([json({ success: true, data: [] })], 7);
    const failure = await collect(client.pages("/api/v2/deals")).catch((e: unknown) => e);
    expect(failure).toMatchObject({ status: 429, message: PAUSE });
    expect(calls).toHaveLength(0);
  });

  it("keeps the old retry sequence when there is no deadline", async () => {
    const { client, sleep } = makeClient([json({ error: "down" }, 503)]);
    await collect(client.pages("/api/v2/deals")).catch(() => undefined);
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000], [8000]]);
  });
});

describe("requestTimeoutMs", () => {
  const now = new Date("2026-11-13T15:00:00.000Z");
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  it("is 20 seconds with no deadline or plenty of time, shrinks near the deadline, and is null under 3 seconds", () => {
    expect(requestTimeoutMs(undefined, now)).toBe(20_000);
    expect(requestTimeoutMs(at(45), now)).toBe(20_000);
    expect(requestTimeoutMs(at(15), now)).toBe(10_000);
    expect(requestTimeoutMs(at(8), now)).toBe(3_000);
    expect(requestTimeoutMs(at(7.9), now)).toBeNull();
  });
});
