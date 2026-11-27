import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipedriveError } from "@/lib/sales/pipedrive/client";
import { PAGE_LIMIT } from "@/lib/sales/pipedrive/import-rows";

import { fakeClient } from "./import-fakes";

// The check report: Pipedrive's counts (read through a fake client) against the
// app's counts and a few sample deals (read through a small fake database).
// Every number below is exact.

type SpotRow = { title: string; valueCents: number; status: string; pipedriveId: number | null; stage: { name: string }; owner: { name: string } };

const mocks = vi.hoisted(() => {
  const appCounts: Record<string, number> = {};
  const spotRows: unknown[] = [];
  const count = (table: string) => vi.fn<(args: { where: unknown }) => Promise<number>>(async () => appCounts[table] ?? 0);
  return {
    appCounts,
    spotRows,
    db: {
      salesOrganization: { count: count("organizations") },
      salesPerson: { count: count("persons") },
      salesDeal: {
        count: count("deals"),
        // One row per call, by position, the way skip and take 1 would give it.
        findMany: vi.fn(async (args: { skip: number; take: number }) => (spotRows[args.skip] ? [spotRows[args.skip]] : [])),
      },
      salesLead: { count: count("leads") },
      salesActivity: { count: count("activities") },
      salesNote: { count: count("notes") },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { buildCheckReport } = await import("@/lib/sales/pipedrive/verify");

const IMPORTED = { pipedriveId: { not: null } };

/** n records with ids 1..n. */
function records(n: number, make: (id: number) => Record<string, unknown> = (id) => ({ id })): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => make(i + 1));
}

/** A list cut into pages of 100, the way Pipedrive sends it. */
function paged(items: Record<string, unknown>[]): Record<string, unknown>[][] {
  const pages: Record<string, unknown>[][] = [];
  for (let start = 0; start < items.length; start += 100) pages.push(items.slice(start, start + 100));
  return pages.length > 0 ? pages : [[]];
}

/** Pipedrive's deals as one list with `n` live ones (the open list). */
function dealsList(n: number, extra: Record<string, unknown>[] = []) {
  return paged([...records(n, (id) => ({ id, title: `Deal ${id}`, status: "open" })), ...extra]);
}

function rowOf(report: Awaited<ReturnType<typeof buildCheckReport>>, label: string) {
  const row = report.rows.find((r) => r.label === label);
  if (!row) throw new Error(`No row called ${label}`);
  return row;
}

const noSpot = () => [];

beforeEach(() => {
  for (const key of Object.keys(mocks.appCounts)) delete mocks.appCounts[key];
  mocks.spotRows.length = 0;
  vi.clearAllMocks();
});

describe("buildCheckReport rows", () => {
  it("gives one row per kind in a fixed order, with Pipedrive's count, the app's count and the entity", async () => {
    const { client } = fakeClient({
      "/api/v2/organizations": paged(records(3)),
      "/api/v2/persons": paged(records(4)),
      "/api/v2/deals": dealsList(5),
      "/v1/leads": paged(records(6, (id) => ({ id: `lead-${id}` }))),
      "/api/v2/activities": paged(records(8)),
      "/v1/notes": paged(records(9, (id) => ({ id, content: `<p>Note ${id}</p>` }))),
    });
    Object.assign(mocks.appCounts, { organizations: 3, persons: 4, deals: 5, leads: 6, activities: 8, notes: 9 });

    const report = await buildCheckReport(client, noSpot);

    expect(report.rows).toEqual([
      { label: "Organizations", entity: "organizations", pipedrive: 3, app: 3, skipped: 0, ok: true },
      { label: "People", entity: "persons", pipedrive: 4, app: 4, skipped: 0, ok: true },
      { label: "Deals", entity: "deals", pipedrive: 5, app: 5, skipped: 0, ok: true },
      { label: "Leads", entity: "leads", pipedrive: 6, app: 6, skipped: 0, ok: true },
      { label: "Activities", entity: "activities", pipedrive: 8, app: 8, skipped: 0, ok: true },
      { label: "Notes", entity: "notes", pipedrive: 9, app: 9, skipped: 0, ok: true },
    ]);
  });

  it("counts only rows that came from Pipedrive, never ones made by hand in the app", async () => {
    const { client } = fakeClient({});

    await buildCheckReport(client, noSpot);

    for (const table of ["salesOrganization", "salesPerson", "salesDeal", "salesLead", "salesActivity", "salesNote"] as const) {
      expect(mocks.db[table].count).toHaveBeenCalledTimes(1);
      expect(mocks.db[table].count).toHaveBeenCalledWith({ where: IMPORTED });
    }
  });

  it("reads the same lists the engine copies", async () => {
    const { client, calls } = fakeClient({});

    await buildCheckReport(client, noSpot);

    expect(calls.map((c) => `${c.path} ${c.style}`)).toEqual([
      "/api/v2/organizations cursor",
      "/api/v2/persons cursor",
      "/api/v2/deals cursor",
      "/v1/leads offset",
      "/api/v2/activities cursor",
      "/v1/notes offset",
    ]);
  });

  it("asks for the biggest page on cursor lists and the engine's page size on offset lists", async () => {
    const { client, calls } = fakeClient({});

    await buildCheckReport(client, noSpot);

    expect(calls.filter((c) => c.style === "cursor").map((c) => c.limit)).toEqual([500, 500, 500, 500]);
    expect(calls.filter((c) => c.style === "offset").map((c) => c.limit)).toEqual([PAGE_LIMIT, PAGE_LIMIT]);
  });

  it("does not count records the mapper skips: a deleted deal, a deleted activity, a removed or empty note", async () => {
    const { client } = fakeClient({
      "/api/v2/deals": dealsList(2, [
        { id: 50, title: "Gone", status: "deleted" },
        { id: 51, title: "Gone too", status: "open", is_deleted: true },
      ]),
      "/api/v2/activities": paged([{ id: 1 }, { id: 2, is_deleted: true }]),
      "/v1/notes": paged([
        { id: 1, content: "<p>Kept</p>" },
        { id: 2, content: "<p>Removed</p>", active_flag: false },
        { id: 3, content: "<p> </p>" },
      ]),
    });
    Object.assign(mocks.appCounts, { deals: 2, activities: 1, notes: 1 });

    const report = await buildCheckReport(client, noSpot);

    expect(rowOf(report, "Deals")).toMatchObject({ pipedrive: 2, app: 2, ok: true });
    expect(rowOf(report, "Activities")).toMatchObject({ pipedrive: 1, app: 1, ok: true });
    expect(rowOf(report, "Notes")).toMatchObject({ pipedrive: 1, app: 1, ok: true });
  });
});

describe("buildCheckReport tolerance", () => {
  it("is ok when the counts are equal", async () => {
    const { client } = fakeClient({ "/api/v2/deals": dealsList(250) });
    mocks.appCounts.deals = 250;

    expect(rowOf(await buildCheckReport(client, noSpot), "Deals")).toMatchObject({ pipedrive: 250, app: 250, ok: true });
  });

  it("is ok when the app is 1% under (1000 against 990)", async () => {
    const { client } = fakeClient({ "/api/v2/deals": dealsList(1000) });
    mocks.appCounts.deals = 990;

    expect(rowOf(await buildCheckReport(client, noSpot), "Deals")).toMatchObject({ pipedrive: 1000, app: 990, ok: true });
  });

  it("is not ok when the app is 3% under (1000 against 970)", async () => {
    const { client } = fakeClient({ "/api/v2/deals": dealsList(1000) });
    mocks.appCounts.deals = 970;

    expect(rowOf(await buildCheckReport(client, noSpot), "Deals")).toMatchObject({ pipedrive: 1000, app: 970, ok: false });
  });

  it("is not ok when the app is just past 1% under (1000 against 989)", async () => {
    const { client } = fakeClient({ "/api/v2/deals": dealsList(1000) });
    mocks.appCounts.deals = 989;

    expect(rowOf(await buildCheckReport(client, noSpot), "Deals").ok).toBe(false);
  });

  it("is not ok when the app has 3% more than Pipedrive (1000 against 1030)", async () => {
    const { client } = fakeClient({ "/api/v2/deals": dealsList(1000) });
    mocks.appCounts.deals = 1030;

    expect(rowOf(await buildCheckReport(client, noSpot), "Deals").ok).toBe(false);
  });

  it("needs an exact match under 100 (99 against 98 is not ok, 99 against 99 is)", async () => {
    const { client } = fakeClient({ "/api/v2/deals": dealsList(99) });

    mocks.appCounts.deals = 98;
    expect(rowOf(await buildCheckReport(client, noSpot), "Deals")).toMatchObject({ pipedrive: 99, app: 98, ok: false });

    mocks.appCounts.deals = 99;
    expect(rowOf(await buildCheckReport(client, noSpot), "Deals")).toMatchObject({ pipedrive: 99, app: 99, ok: true });
  });

  it("is ok when both are empty, and not ok when the app has rows Pipedrive does not", async () => {
    const { client } = fakeClient({});

    expect(rowOf(await buildCheckReport(client, noSpot), "Leads")).toMatchObject({ pipedrive: 0, app: 0, ok: true });

    mocks.appCounts.leads = 1;
    expect(rowOf(await buildCheckReport(client, noSpot), "Leads")).toMatchObject({ pipedrive: 0, app: 1, ok: false });
  });
});

describe("buildCheckReport skipped rows", () => {
  it("lets rows the engine left out on purpose make up the difference (120 against 118 and 2 skipped)", async () => {
    const { client } = fakeClient({ "/api/v2/activities": paged(records(120)) });
    mocks.appCounts.activities = 118;

    const without = await buildCheckReport(client, noSpot);
    expect(rowOf(without, "Activities")).toMatchObject({ pipedrive: 120, app: 118, skipped: 0, ok: false });

    const withSkips = await buildCheckReport(client, noSpot, { activities: 2 });
    expect(rowOf(withSkips, "Activities")).toEqual({
      label: "Activities",
      entity: "activities",
      pipedrive: 120,
      app: 118,
      skipped: 2,
      ok: true,
    });
  });

  it("does not count a skip twice when it was a record the mapper refuses (the run's skipped count includes those)", async () => {
    // 100 live deals, 3 deleted ones, and 1 live deal the engine left out on purpose: the run said "4 skipped".
    const { client } = fakeClient({
      "/api/v2/deals": dealsList(100, [
        { id: 900, status: "deleted" },
        { id: 901, status: "deleted" },
        { id: 902, status: "deleted" },
      ]),
    });
    mocks.appCounts.deals = 99;

    const report = await buildCheckReport(client, noSpot, { deals: 4 });

    expect(rowOf(report, "Deals")).toEqual({ label: "Deals", entity: "deals", pipedrive: 100, app: 99, skipped: 1, ok: true });
  });

  it("gives no credit when the run's skips were all records the mapper refuses", async () => {
    const { client } = fakeClient({ "/api/v2/deals": dealsList(100, [{ id: 900, status: "deleted" }]) });
    mocks.appCounts.deals = 100;

    const report = await buildCheckReport(client, noSpot, { deals: 1 });

    expect(rowOf(report, "Deals")).toMatchObject({ pipedrive: 100, app: 100, skipped: 0, ok: true });
  });

  it("does not let skips hide a real gap", async () => {
    const { client } = fakeClient({ "/api/v2/activities": paged(records(200)) });
    mocks.appCounts.activities = 150;

    expect(rowOf(await buildCheckReport(client, noSpot, { activities: 10 }), "Activities")).toMatchObject({
      pipedrive: 200,
      app: 150,
      skipped: 10,
      ok: false,
    });
  });
});

describe("buildCheckReport spot check", () => {
  function seedSpotRows(n: number): void {
    for (let i = 0; i < n; i++) {
      mocks.spotRows.push({
        title: `Deal ${i}`,
        valueCents: (i + 1) * 100_00,
        status: i % 2 === 0 ? "OPEN" : "WON",
        pipedriveId: 1000 + i,
        stage: { name: `Stage ${i}` },
        owner: { name: `Owner ${i}` },
      } satisfies SpotRow);
    }
  }

  it("returns exactly 5 deals when 12 are imported, each looked up by its position", async () => {
    const { client } = fakeClient({});
    seedSpotRows(12);
    mocks.appCounts.deals = 12;
    const pick = vi.fn(() => [1, 4, 6, 9, 11]);

    const report = await buildCheckReport(client, pick);

    expect(pick).toHaveBeenCalledWith(12);
    expect(report.spot).toEqual([
      { title: "Deal 1", valueCents: 20_000, stage: "Stage 1", owner: "Owner 1", status: "WON", pipedriveId: 1001 },
      { title: "Deal 4", valueCents: 50_000, stage: "Stage 4", owner: "Owner 4", status: "OPEN", pipedriveId: 1004 },
      { title: "Deal 6", valueCents: 70_000, stage: "Stage 6", owner: "Owner 6", status: "OPEN", pipedriveId: 1006 },
      { title: "Deal 9", valueCents: 100_000, stage: "Stage 9", owner: "Owner 9", status: "WON", pipedriveId: 1009 },
      { title: "Deal 11", valueCents: 120_000, stage: "Stage 11", owner: "Owner 11", status: "WON", pipedriveId: 1011 },
    ]);
    expect(mocks.db.salesDeal.findMany.mock.calls.map(([args]) => args)).toEqual(
      [1, 4, 6, 9, 11].map((skip) => ({
        where: IMPORTED,
        orderBy: { id: "asc" },
        skip,
        take: 1,
        select: {
          title: true,
          valueCents: true,
          status: true,
          pipedriveId: true,
          stage: { select: { name: true } },
          owner: { select: { name: true } },
        },
      })),
    );
  });

  it("returns exactly 5 when exactly 5 are imported", async () => {
    const { client } = fakeClient({});
    seedSpotRows(5);
    mocks.appCounts.deals = 5;

    const report = await buildCheckReport(client, (total) => Array.from({ length: Math.min(total, 5) }, (_, i) => i));

    expect(report.spot.map((s) => s.pipedriveId)).toEqual([1000, 1001, 1002, 1003, 1004]);
  });

  it("returns only the deals that exist when fewer than 5 are imported", async () => {
    const { client } = fakeClient({});
    seedSpotRows(3);
    mocks.appCounts.deals = 3;

    // A picker that overshoots: the positions past the end are dropped, not looked up.
    const report = await buildCheckReport(client, () => [0, 1, 2, 3, 4]);

    expect(report.spot.map((s) => s.pipedriveId)).toEqual([1000, 1001, 1002]);
    expect(mocks.db.salesDeal.findMany).toHaveBeenCalledTimes(3);
  });

  it("returns an empty list, and asks nothing, when no deals are imported", async () => {
    const { client } = fakeClient({});
    const pick = vi.fn(() => [0, 1, 2]);

    const report = await buildCheckReport(client, pick);

    expect(report.spot).toEqual([]);
    expect(pick).not.toHaveBeenCalled();
    expect(mocks.db.salesDeal.findMany).not.toHaveBeenCalled();
  });

  it("ignores a repeated, negative or fractional position and never returns more than 5", async () => {
    const { client } = fakeClient({});
    seedSpotRows(10);
    mocks.appCounts.deals = 10;

    const report = await buildCheckReport(client, () => [2, 2, -1, 1.5, 3, 4, 5, 6, 7]);

    expect(report.spot.map((s) => s.pipedriveId)).toEqual([1002, 1003, 1004, 1005, 1006]);
  });

  it("leaves out a deal that is no longer there, instead of failing", async () => {
    const { client } = fakeClient({});
    seedSpotRows(2);
    mocks.appCounts.deals = 4; // two deals went away between the count and the lookup

    const report = await buildCheckReport(client, () => [0, 3]);

    expect(report.spot.map((s) => s.pipedriveId)).toEqual([1000]);
  });
});

describe("buildCheckReport errors", () => {
  it("lets a Pipedrive error through untouched, so the caller can show it in plain words", async () => {
    const failure = new PipedriveError(401, "Pipedrive request failed (HTTP 401): Pipedrive did not accept the API token.");
    const { client } = fakeClient({}, { failOn: { "/api/v2/deals": failure } });

    await expect(buildCheckReport(client, noSpot)).rejects.toBe(failure);
  });
});
