import { beforeEach, describe, expect, it, vi } from "vitest";

import { createIssueLog, emptyContext, type ImportContext, type PhaseWork } from "@/lib/sales/pipedrive/import-state";

import { db, fakeClient, resetDb, salesWrites, seed, store } from "./import-fakes";

// The record steps, called directly with a hand-built run state: links that
// point at records that were not copied, leads and their custom values, and
// the guards on what a practice run may do.

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { runRowPhase, PAGE_LIMIT } = await import("@/lib/sales/pipedrive/import-rows");

const FALLBACK = new Date("2026-11-12T15:00:00Z");
const ZIP_KEY = "f".repeat(40);
const DEAL_ONLY_KEY = "9".repeat(40);

function context(): ImportContext {
  return {
    ...emptyContext(),
    users: [{ id: 1, name: "Ben", email: "ben@vp.test", memberId: "m1" }],
    fields: {
      [ZIP_KEY]: { name: "Practice ZIP", options: null, dealFieldId: null, leadFieldId: "f-zip" },
      [DEAL_ONLY_KEY]: { name: "Budget", options: null, dealFieldId: "f-budget", leadFieldId: null },
    },
  };
}

function work(lists: Record<string, unknown[][]>, live = true): PhaseWork & { saves: number } {
  const w = {
    client: fakeClient(lists).client,
    live,
    starterId: "starter",
    fallback: FALLBACK,
    cursor: { context: context(), source: 0, page: null },
    counts: {},
    issues: createIssueLog([]),
    outOfTime: () => false,
    saves: 0,
    save: async () => {
      w.saves += 1;
      return true;
    },
  };
  return w;
}

beforeEach(() => {
  resetDb();
  seed("salesOrganization", { id: "o1", pipedriveId: 100, name: "Oak Dental", ownerId: "m1" });
});

describe("links to records that were not copied", () => {
  it("keeps the row and drops only the link, with an issue", async () => {
    const w = work({
      "/api/v2/persons": [
        [
          { id: 200, name: "Ann P", org_id: 100, owner_id: 1, add_time: "2025-01-01T00:00:00Z" },
          { id: 201, name: "Bo T", org_id: 999, owner_id: 1, add_time: "2025-01-01T00:00:00Z" },
        ],
      ],
    });

    expect(await runRowPhase("persons", w)).toBe("finished");

    expect(store.salesPerson.map((p) => [p.pipedriveId, p.organizationId])).toEqual([
      [200, "o1"],
      [201, null],
    ]);
    expect(w.issues.groups).toEqual([
      { phase: "persons", message: "The person's organization was not copied, so the link was left out.", count: 1, sampleIds: [201] },
    ]);
    expect(w.counts).toEqual({ "persons.seen": 2, "persons.created": 2 });
  });

  it("skips a note that is on nothing that was copied", async () => {
    const w = work({ "/api/v1/notes": [[{ id: 500, content: "Hello", deal_id: 77, user_id: 1, add_time: "2025-01-01 00:00:00" }]] });

    await runRowPhase("notes", w);

    expect(store.salesNote).toEqual([]);
    expect(w.counts).toEqual({ "notes.seen": 1, "notes.skipped": 1 });
    expect(w.issues.groups.map((g) => g.message)).toEqual([
      "The note's deal was not copied, so the link was left out.",
      "The note was not on anything that was copied, so it was not copied.",
    ]);
  });

  it("puts a note on an organization, written by the person who started the run when the author is unknown", async () => {
    const w = work({ "/api/v1/notes": [[{ id: 501, content: "<b>Hi</b>", org_id: 100, user_id: 42, add_time: "2025-01-01 00:00:00" }]] });

    await runRowPhase("notes", w);

    expect(store.salesNote[0]).toMatchObject({ body: "Hi", organizationId: "o1", authorId: "starter", dealId: null });
    expect(w.issues.groups[0].message).toBe(
      "The author in Pipedrive matches no team member, so the person who started the import is shown as the author.",
    );
  });
});

describe("leads", () => {
  it("copies open and archived leads with their custom values, and reports a field the app has no lead field for", async () => {
    const w = work({
      "/api/v1/leads": [
        [{ id: "uuid-1", title: "Oak lead", owner_id: 1, organization_id: 100, add_time: "2025-01-01T00:00:00Z", [ZIP_KEY]: "28202", [DEAL_ONLY_KEY]: 500 }],
      ],
      "/api/v1/leads/archived": [[{ id: "uuid-2", title: "Old lead", owner_id: 1, update_time: "2025-05-01T00:00:00Z" }]],
    });

    expect(await runRowPhase("leads", w)).toBe("finished");

    const [open, archived] = store.salesLead;
    expect(open).toMatchObject({ pipedriveId: "uuid-1", organizationId: "o1", ownerId: "m1", status: "OPEN", source: "Added by hand" });
    expect(archived).toMatchObject({ pipedriveId: "uuid-2", status: "ARCHIVED", archivedAt: new Date("2025-05-01T00:00:00Z") });
    expect(store.salesCustomFieldValue.map((v) => [v.fieldId, v.leadId, v.value])).toEqual([["f-zip", open.id, "28202"]]);
    expect(w.issues.groups).toContainEqual({
      phase: "leads",
      message: 'The Pipedrive field "Budget" has no lead field in the app, so its values on leads were not copied.',
      count: 1,
      sampleIds: ["uuid-1"],
    });
    expect(store.salesAuditLog.map((a) => [a.entityType, a.action])).toEqual([
      ["SalesLead", "imported"],
      ["SalesLead", "imported"],
    ]);
    // One save per page: the open list, then the archived list.
    expect(w.saves).toBe(2);
    expect(w.cursor).toMatchObject({ source: 2, page: null });
  });

  it("updates a changed custom value on a re-run, and counts the lead as updated", async () => {
    const lists = { "/api/v1/leads": [[{ id: "uuid-1", title: "Oak lead", owner_id: 1, [ZIP_KEY]: "28202" }]], "/api/v1/leads/archived": [[]] };
    await runRowPhase("leads", work(lists));
    (lists["/api/v1/leads"][0][0] as Record<string, unknown>)[ZIP_KEY] = "28203";

    const again = work(lists);
    await runRowPhase("leads", again);

    expect(store.salesCustomFieldValue.map((v) => v.value)).toEqual(["28203"]);
    expect(again.counts).toEqual({ "leads.seen": 1, "leads.updated": 1 });
    expect(store.salesAuditLog.at(-1)).toMatchObject({ action: "import_updated", before: {}, after: { customFieldsChanged: 1 } });
  });
});

describe("paging", () => {
  it("warns when an offset list ends on a full page without saying whether more exist", async () => {
    const page = Array.from({ length: PAGE_LIMIT }, (_, i) => ({ id: 1000 + i, content: "x", org_id: 100 }));
    const w = work({ "/api/v1/notes": [page] });

    await runRowPhase("notes", w);

    expect(w.issues.groups.map((g) => g.message)).toContain(
      "Pipedrive sent a full page of notes and did not say whether more exist. If the app shows fewer notes than Pipedrive, some were not copied.",
    );
  });

  it("stops before a page when out of time, and leaves its place where it was", async () => {
    const w = work({ "/api/v2/organizations": [[{ id: 101, name: "New" }]] });
    w.outOfTime = () => true;

    expect(await runRowPhase("organizations", w)).toBe("stopped");
    expect(store.salesOrganization).toHaveLength(1);
    expect(w.cursor).toMatchObject({ source: 0, page: null });
  });

  it("stops at once when the run was taken over by another request", async () => {
    const w = work({ "/api/v2/organizations": [[{ id: 101, name: "New" }], [{ id: 102, name: "Newer" }]] });
    w.save = async () => false;

    expect(await runRowPhase("organizations", w)).toBe("stopped");
    expect(store.salesOrganization.map((o) => o.pipedriveId)).toEqual([100, 101]);
  });
});

describe("a practice run", () => {
  it("writes nothing, skips an activity on nothing at all, and does not check links", async () => {
    const w = work(
      {
        "/api/v2/activities": [
          [
            { id: 400, subject: "Call", type: "call", due_date: "2025-01-01", org_id: 555, add_time: "2025-01-01T00:00:00Z" },
            { id: 401, subject: "Floating", type: "task", due_date: "2025-01-01", add_time: "2025-01-01T00:00:00Z" },
          ],
        ],
      },
      false,
    );

    await runRowPhase("activities", w);

    expect(salesWrites()).toEqual([]);
    expect(w.counts).toEqual({ "activities.seen": 2, "activities.created": 1, "activities.skipped": 1, activitiesAtMidnightUtc: 0 });
    expect(w.issues.groups.map((g) => g.message)).toEqual([
      "The record had no owner in Pipedrive, so the person who started the import owns it.",
      "The activity was not on a deal, lead or person that was copied, so it was not copied.",
    ]);
  });
});
