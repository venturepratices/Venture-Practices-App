import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteDealRequest,
  getActivitiesPage,
  getDealListPage,
  getDealTimeline,
  moveDealRequest,
  saveDefaultViewRequest,
  searchContactsRequest,
  setDealStatusRequest,
} from "@/lib/sales/api-client";
import type { BoardQuery } from "@/lib/sales/board-query";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const QUERY: BoardQuery = {
  pipeline: "direct-mail",
  view: "list",
  scope: "mine",
  status: "open",
  next: "any",
  q: "oak",
  cursor: "d50",
};

describe("api-client", () => {
  it("asks for the next list page with the page's filters and the cursor", async () => {
    fetchMock.mockResolvedValue(json(200, { rows: [], nextCursor: null }));
    const result = await getDealListPage(QUERY);
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/deals?pipeline=direct-mail&view=list&scope=mine&q=oak&cursor=d50", {
      method: "GET",
    });
    expect(result).toEqual({ ok: true, data: { rows: [], nextCursor: null } });
  });

  it("asks for the next Activities page with its filters and the cursor", async () => {
    fetchMock.mockResolvedValue(json(200, { rows: [], nextCursor: null }));
    await getActivitiesPage({ when: "overdue", type: "CALL", scope: "everyone", cursor: "a9" });
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/activities?when=overdue&type=CALL&cursor=a9", { method: "GET" });
  });

  it("leaves the cursor off the first page", async () => {
    fetchMock.mockResolvedValue(json(200, { rows: [], nextCursor: null }));
    await getActivitiesPage({ when: "open", type: "all", scope: "everyone", cursor: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/activities?", { method: "GET" });
  });

  it("sends a move as JSON and hands back the server's answer", async () => {
    const answer = { ok: true, changed: true, previousStageId: "s4", createdActivityIds: [] };
    fetchMock.mockResolvedValue(json(200, answer));
    const result = await moveDealRequest("d1", { stageId: "s5", valueCents: 1440000, mrrCents: 120000 });
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/deals/d1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: "s5", valueCents: 1440000, mrrCents: 120000 }),
    });
    expect(result).toEqual({ ok: true, data: answer });
  });

  it("passes a refusal's message and code through", async () => {
    fetchMock.mockResolvedValue(
      json(422, { error: "A deal in Proposal Sent needs a total value and a monthly value above $0.", code: "PROPOSAL_NEEDS_VALUE" }),
    );
    expect(await moveDealRequest("d1", { stageId: "s5" })).toEqual({
      ok: false,
      status: 422,
      error: "A deal in Proposal Sent needs a total value and a monthly value above $0.",
      code: "PROPOSAL_NEEDS_VALUE",
    });
  });

  it("turns a network failure into a calm message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await setDealStatusRequest("d1", { status: "WON" })).toEqual({
      ok: false,
      status: 0,
      error: "Could not reach the server. Check your connection and try again.",
    });
  });

  it("gives a plain message when the server answers without JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Internal Server Error</html>", { status: 500 }));
    expect(await deleteDealRequest("d1")).toEqual({ ok: false, status: 500, error: "Something went wrong. Try again." });
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/deals/d1", { method: "DELETE" });
  });

  it("escapes ids and search text in URLs", async () => {
    fetchMock.mockResolvedValue(json(200, { results: [] }));
    await searchContactsRequest("person", "Sarah & Co");
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/contacts?kind=person&q=Sarah+%26+Co", { method: "GET" });

    fetchMock.mockResolvedValue(json(200, { entries: [], nextCursor: null }));
    await getDealTimeline("d/1", { at: "2026-11-05T15:00:00.000Z", id: "h9" });
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/deals/d%2F1/timeline?at=2026-11-05T15%3A00%3A00.000Z&id=h9", {
      method: "GET",
    });
  });

  it("saves the remembered view with PUT", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await saveDefaultViewRequest({ pipeline: "direct-mail", view: "board", scope: "everyone" });
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/view", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: "direct-mail", view: "board", scope: "everyone" }),
    });
  });
});
