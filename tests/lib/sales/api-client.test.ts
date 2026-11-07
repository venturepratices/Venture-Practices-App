import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addNoteFor,
  convertLeadRequest,
  convertLeadsRequest,
  createActivityFor,
  createContactRequest,
  createLeadRequest,
  deleteDealRequest,
  getActivitiesPage,
  getContactRowsPage,
  getConvertTargets,
  getDealListPage,
  getDealTimeline,
  getLeadPanel,
  getLeadRowsPage,
  getLeadTimeline,
  moveDealRequest,
  runLeadBulkRequest,
  saveDefaultViewRequest,
  searchContactsRequest,
  setDealStatusRequest,
  setLeadArchivedRequest,
  setLeadFieldRequest,
  updateLeadRequest,
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
  stage: null,
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

  it("schedules an activity on a lead or a deal by the parent's kind, with escaped ids", async () => {
    const body = { type: "CALL" as const, subject: "", dueDate: "2026-11-06", dueTime: null };
    fetchMock.mockResolvedValue(json(201, { activity: { id: "a1" } }));

    const result = await createActivityFor({ kind: "lead", id: "l 1" }, body);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l%201/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(result).toEqual({ ok: true, data: { activity: { id: "a1" } } });

    await createActivityFor({ kind: "deal", id: "d1" }, body);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/deals/d1/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("adds a note to a lead or a deal by the parent's kind, with escaped ids", async () => {
    fetchMock.mockResolvedValue(json(201, { note: { id: "n1" } }));

    await addNoteFor({ kind: "lead", id: "l 1" }, { body: "Prefers mornings" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l%201/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Prefers mornings" }),
    });

    await addNoteFor({ kind: "deal", id: "d/1" }, { body: "Prefers mornings" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/deals/d%2F1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Prefers mornings" }),
    });
  });

  describe("leads", () => {
    const sent = (method: string, body: unknown) => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    it("asks for the next Leads Inbox page with its filters and the cursor", async () => {
      fetchMock.mockResolvedValue(json(200, { rows: [], nextCursor: null }));
      const result = await getLeadRowsPage({ scope: "mine", q: "oak", cursor: "l50" });
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/leads?scope=mine&q=oak&cursor=l50", { method: "GET" });
      expect(result).toEqual({ ok: true, data: { rows: [], nextCursor: null } });
    });

    it("leaves the cursor and the defaults off the first Inbox page", async () => {
      fetchMock.mockResolvedValue(json(200, { rows: [], nextCursor: null }));
      await getLeadRowsPage({ scope: "everyone", q: "", cursor: null });
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/leads?", { method: "GET" });
    });

    it("reads the lead panel by its escaped id", async () => {
      fetchMock.mockResolvedValue(json(200, { lead: { id: "l1" } }));
      await getLeadPanel("l1");
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l1", { method: "GET" });

      await getLeadPanel("l/1");
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l%2F1", { method: "GET" });
    });

    it("reads a lead's History the way it reads a deal's", async () => {
      fetchMock.mockResolvedValue(json(200, { entries: [], nextCursor: null }));
      await getLeadTimeline("l1", { at: "2026-11-05T15:00:00.000Z", id: "h9" });
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l1/timeline?at=2026-11-05T15%3A00%3A00.000Z&id=h9", {
        method: "GET",
      });

      await getLeadTimeline("l1", null);
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l1/timeline", { method: "GET" });
    });

    it("adds a lead with POST", async () => {
      const body = {
        organization: { name: "Oak Creek Dental" },
        person: { id: "p1" },
        source: "Added by hand" as const,
        zip: "78704",
        ownerId: "auto",
        firstActivity: "call-today" as const,
      };
      fetchMock.mockResolvedValue(json(201, { lead: { id: "l1" } }));
      const result = await createLeadRequest(body);
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/leads", sent("POST", body));
      expect(result).toEqual({ ok: true, data: { lead: { id: "l1" } } });
    });

    it("edits a lead with PATCH", async () => {
      fetchMock.mockResolvedValue(json(200, { lead: { id: "l1" } }));
      await updateLeadRequest("l1", { title: "Oak Creek Dental", person: null });
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/leads/l1", sent("PATCH", { title: "Oak Creek Dental", person: null }));
    });

    it("archives or restores a lead", async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, changed: true }));
      await setLeadArchivedRequest("l1", true);
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l1/archive", sent("POST", { archived: true }));

      await setLeadArchivedRequest("l1", false);
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l1/archive", sent("POST", { archived: false }));
    });

    it("sets or clears one of a lead's fields with PUT", async () => {
      fetchMock.mockResolvedValue(json(200, { value: "78704" }));
      const result = await setLeadFieldRequest("l1", "practice-zip", "78704");
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l1/fields/practice-zip", sent("PUT", { value: "78704" }));
      expect(result).toEqual({ ok: true, data: { value: "78704" } });

      await setLeadFieldRequest("l 1", "practice zip", null);
      expect(fetchMock).toHaveBeenLastCalledWith("/api/sales/leads/l%201/fields/practice%20zip", sent("PUT", { value: null }));
    });

    it("runs a bulk action with POST and hands back each lead's result", async () => {
      const results = [
        { id: "l1", ok: true },
        { id: "l2", ok: false, error: "Lead not found." },
      ];
      fetchMock.mockResolvedValue(json(200, { results }));
      const result = await runLeadBulkRequest({ action: "assign", ids: ["l1", "l2"], ownerId: "u2" });
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/leads/bulk", sent("POST", { action: "assign", ids: ["l1", "l2"], ownerId: "u2" }));
      expect(result).toEqual({ ok: true, data: { results } });
    });

    it("reads where leads can be converted to", async () => {
      const targets = [{ id: "p1", key: "direct-mail", name: "Direct Mail", stages: [{ id: "s1", name: "New", requiresValue: false }] }];
      fetchMock.mockResolvedValue(json(200, { targets }));
      const result = await getConvertTargets();
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/leads/convert", { method: "GET" });
      expect(result).toEqual({ ok: true, data: { targets } });
    });

    it("converts one lead with POST", async () => {
      const deal = { id: "d1", pipelineKey: "direct-mail", pipelineName: "Direct Mail" };
      fetchMock.mockResolvedValue(json(201, { deal }));
      const result = await convertLeadRequest("l1", { pipelineId: "p1", stageId: "s1", valueCents: 1440000 });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sales/leads/l1/convert",
        sent("POST", { pipelineId: "p1", stageId: "s1", valueCents: 1440000 }),
      );
      expect(result).toEqual({ ok: true, data: { deal } });
    });

    it("converts many leads with POST", async () => {
      const answer = {
        results: [
          { id: "l1", ok: true, dealId: "d1" },
          { id: "l2", ok: false, error: "This lead was already converted." },
        ],
        pipeline: { key: "direct-mail", name: "Direct Mail" },
      };
      fetchMock.mockResolvedValue(json(200, answer));
      const result = await convertLeadsRequest({ ids: ["l1", "l2"], pipelineId: "p1", stageId: "s1" });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sales/leads/convert",
        sent("POST", { ids: ["l1", "l2"], pipelineId: "p1", stageId: "s1" }),
      );
      expect(result).toEqual({ ok: true, data: answer });
    });

    it("passes a convert refusal's message through", async () => {
      fetchMock.mockResolvedValue(json(409, { error: "This lead was already converted.", code: "LEAD_CONVERTED" }));
      expect(await convertLeadRequest("l1", { pipelineId: "p1", stageId: "s1" })).toEqual({
        ok: false,
        status: 409,
        error: "This lead was already converted.",
        code: "LEAD_CONVERTED",
      });
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

  describe("contacts", () => {
    const sent = (method: string, body: unknown) => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    it("asks for the next Contacts page with its tab, scope, search and cursor", async () => {
      fetchMock.mockResolvedValue(json(200, { rows: [], nextCursor: null }));
      const result = await getContactRowsPage({ tab: "organizations", scope: "mine", q: "oak", cursor: "o50" });
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/contacts/organizations?scope=mine&q=oak&cursor=o50", {
        method: "GET",
      });
      expect(result).toEqual({ ok: true, data: { rows: [], nextCursor: null } });
    });

    it("leaves the cursor and the defaults off the first People page", async () => {
      fetchMock.mockResolvedValue(json(200, { rows: [], nextCursor: null }));
      await getContactRowsPage({ tab: "people", scope: "everyone", q: "", cursor: null });
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/contacts/people?", { method: "GET" });
    });

    it("adds a person with POST to the people path", async () => {
      fetchMock.mockResolvedValue(json(201, { contact: { id: "p1", name: "Sarah K." } }));
      const result = await createContactRequest("person", { name: "Sarah K." });
      expect(fetchMock).toHaveBeenCalledWith("/api/sales/contacts/people", sent("POST", { name: "Sarah K." }));
      expect(result).toEqual({ ok: true, data: { contact: { id: "p1", name: "Sarah K." } } });
    });

    it("adds an organization with POST to the organizations path", async () => {
      fetchMock.mockResolvedValue(json(201, { contact: { id: "o1", name: "Oak Creek Dental" } }));
      await createContactRequest("organization", { name: "Oak Creek Dental", zip: "78704" });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sales/contacts/organizations",
        sent("POST", { name: "Oak Creek Dental", zip: "78704" }),
      );
    });
  });
});
