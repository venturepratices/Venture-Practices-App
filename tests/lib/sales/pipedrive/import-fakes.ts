// Test doubles for the Pipedrive import engine: an in-memory database with the
// few Prisma calls the engine makes (and the unique keys it relies on), and a
// fake read-only Pipedrive client that serves fixed pages and records every
// list it was asked for. Not a test file itself (the name has no ".test").

import { vi } from "vitest";

import type { PageToken, PipedriveClient } from "@/lib/sales/pipedrive/client";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = [
  "teamMember",
  "salesPipeline",
  "salesStage",
  "salesCustomField",
  "salesCustomFieldValue",
  "salesOrganization",
  "salesPerson",
  "salesDeal",
  "salesLead",
  "salesActivity",
  "salesNote",
  "salesAuditLog",
  "salesImportRun",
  "salesImportUserMap",
] as const;
export type Table = (typeof TABLES)[number];

/** Unique keys, as in the schema. A key with a null part never clashes (SQL rules). */
const UNIQUE: Partial<Record<Table, string[][]>> = {
  teamMember: [["email"]],
  salesPipeline: [["key"]],
  salesStage: [["pipelineId", "key"]],
  salesCustomField: [["key"]],
  salesCustomFieldValue: [
    ["fieldId", "dealId"],
    ["fieldId", "leadId"],
  ],
  salesOrganization: [["pipedriveId"]],
  salesPerson: [["pipedriveId"]],
  salesDeal: [["pipedriveId"]],
  salesLead: [["pipedriveId"]],
  salesActivity: [["pipedriveId"]],
  salesNote: [["pipedriveId"]],
  salesImportUserMap: [["pipedriveUserId"]],
};

export const store = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Record<Table, Row[]>;
/** Every write the engine made, in order: which table and which call. */
export const writes: { table: Table; op: string; count: number }[] = [];
export const clock = { now: new Date("2026-11-12T15:00:00.000Z") };
let nextId = 1;

export function resetDb(): void {
  for (const t of TABLES) store[t].length = 0;
  writes.length = 0;
  nextId = 1;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function matches(row: Row, where: Where | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (key === "OR") {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Where[]).every((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c && !(c.in as unknown[]).some((v) => same(value, v))) return false;
      if ("not" in c && same(value, c.not)) return false;
      if ("gte" in c && compare(value, c.gte) < 0) return false;
      if ("gt" in c && compare(value, c.gt) <= 0) return false;
      if ("lt" in c && compare(value, c.lt) >= 0) return false;
      if ("lte" in c && compare(value, c.lte) > 0) return false;
    } else if (!same(value, cond)) return false;
  }
  return true;
}

function project(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function defaults(table: Table): Row {
  const base: Row = { createdAt: clock.now, updatedAt: clock.now };
  if (table === "salesImportRun") return { startedAt: clock.now, updatedAt: clock.now, finishedAt: null, cursor: null, isFinal: false };
  if (table === "salesAuditLog") return { at: clock.now };
  if (table === "teamMember" || table === "salesImportUserMap") return base;
  return { ...base, archivedAt: null };
}

function uniqueClash(table: Table, row: Row, ignoreId?: unknown): boolean {
  if (table === "salesImportRun" && row.status === "RUNNING") {
    if (store.salesImportRun.some((r) => r.id !== ignoreId && r.status === "RUNNING")) return true;
  }
  for (const key of UNIQUE[table] ?? []) {
    if (key.some((k) => row[k] === null || row[k] === undefined)) continue;
    if (store[table].some((r) => r.id !== ignoreId && key.every((k) => same(r[k], row[k])))) return true;
  }
  return false;
}

function uniqueError(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function applyData(row: Row, data: Row): Row {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && !(value instanceof Date) && "increment" in value) {
      next[key] = (next[key] as number) + (value as { increment: number }).increment;
    } else {
      next[key] = value;
    }
  }
  return next;
}

type Args = { where?: Where; data?: Row | Row[]; select?: Record<string, unknown>; orderBy?: unknown; take?: number };

function delegate(table: Table) {
  const rows = () => store[table];
  const sorted = (list: Row[], orderBy: unknown) => {
    const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, "asc" | "desc">[];
    return [...list].sort((a, b) => {
      for (const order of orders) {
        const [key, dir] = Object.entries(order)[0];
        const c = compare(a[key], b[key]);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  };
  const create = (data: Row): Row => {
    const row = { id: data.id ?? `${table}-${nextId++}`, ...defaults(table), ...data };
    if (uniqueClash(table, row)) throw uniqueError();
    rows().push(row);
    return row;
  };
  return {
    findMany: vi.fn(async (args: Args = {}) =>
      sorted(rows().filter((r) => matches(r, args.where)), args.orderBy)
        .slice(0, args.take)
        .map((r) => project(r, args.select)),
    ),
    findFirst: vi.fn(async (args: Args = {}) => {
      const row = sorted(rows().filter((r) => matches(r, args.where)), args.orderBy)[0];
      return row ? project(row, args.select) : null;
    }),
    findUnique: vi.fn(async (args: Args) => {
      const row = rows().find((r) => matches(r, args.where));
      return row ? project(row, args.select) : null;
    }),
    count: vi.fn(async (args: Args = {}) => rows().filter((r) => matches(r, args.where)).length),
    create: vi.fn(async (args: Args) => {
      writes.push({ table, op: "create", count: 1 });
      return project(create(args.data as Row), args.select);
    }),
    createMany: vi.fn(async (args: Args & { skipDuplicates?: boolean }) => {
      const list = args.data as Row[];
      writes.push({ table, op: "createMany", count: list.length });
      let count = 0;
      for (const data of list) {
        try {
          create(data);
          count++;
        } catch (error) {
          if (!args.skipDuplicates) throw error;
        }
      }
      return { count };
    }),
    update: vi.fn(async (args: Args) => {
      writes.push({ table, op: "update", count: 1 });
      const index = rows().findIndex((r) => matches(r, args.where));
      if (index < 0) throw Object.assign(new Error("Not found"), { code: "P2025" });
      const next = applyData(rows()[index], { updatedAt: clock.now, ...(args.data as Row) });
      if (uniqueClash(table, next, next.id)) throw uniqueError();
      rows()[index] = next;
      return project(next, args.select);
    }),
    updateMany: vi.fn(async (args: Args) => {
      writes.push({ table, op: "updateMany", count: 1 });
      let count = 0;
      rows().forEach((row, index) => {
        if (!matches(row, args.where)) return;
        const next = applyData(row, { updatedAt: clock.now, ...(args.data as Row) });
        if (uniqueClash(table, next, next.id)) throw uniqueError();
        rows()[index] = next;
        count++;
      });
      return { count };
    }),
    upsert: vi.fn(async (args: Args & { create: Row; update: Row }) => {
      writes.push({ table, op: "upsert", count: 1 });
      const index = rows().findIndex((r) => matches(r, args.where));
      if (index < 0) return create(args.create);
      rows()[index] = applyData(rows()[index], { updatedAt: clock.now, ...args.update });
      return rows()[index];
    }),
  };
}

export const db = {
  ...(Object.fromEntries(TABLES.map((t) => [t, delegate(t)])) as Record<Table, ReturnType<typeof delegate>>),
  $transaction: vi.fn(async (arg: unknown): Promise<unknown> => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => unknown)(db);
  }),
};

/** Adds rows straight to the store (fixtures), outside the write log. */
export function seed(table: Table, ...rows: Row[]): Row[] {
  return rows.map((data) => {
    const row = { id: data.id ?? `${table}-${nextId++}`, ...defaults(table), ...data };
    store[table].push(row);
    return row;
  });
}

/** Writes to Sales tables other than the run row itself. */
export function salesWrites() {
  return writes.filter((w) => w.table !== "salesImportRun");
}

// --- Fake Pipedrive client ---

export type ListCall = { path: string; resumeAt: PageToken | undefined; limit: number | undefined; style: string | undefined };

/**
 * Serves `lists[path]` as pages, in order. Page n's resumeAt is `{ cursor: "p<n>" }`
 * (cursor style) or `{ start: n * 100 }` (offset style). `failOn[path]` throws
 * that error when the list is asked for. `onPage` runs as each page is served.
 */
export function fakeClient(
  lists: Record<string, unknown[][]>,
  opts: { failOn?: Record<string, Error>; onPage?: (path: string, index: number) => void } = {},
) {
  const calls: ListCall[] = [];
  const client: PipedriveClient = {
    pages: () => {
      throw new Error("The engine must use pageBatches.");
    },
    download: async () => {
      throw new Error("No downloads in these tests.");
    },
    async *pageBatches<T>(path: string, o: { style?: "cursor" | "offset"; limit?: number; resumeAt?: PageToken } = {}) {
      calls.push({ path, resumeAt: o.resumeAt, limit: o.limit, style: o.style });
      const failure = opts.failOn?.[path];
      if (failure) throw failure;
      const pages = lists[path] ?? [[]];
      const offset = o.style === "offset";
      let index = 0;
      if (o.resumeAt) index = "cursor" in o.resumeAt ? Number(o.resumeAt.cursor.slice(1)) : o.resumeAt.start / 100;
      for (; index < pages.length; index++) {
        opts.onPage?.(path, index);
        const last = index === pages.length - 1;
        const resumeAt: PageToken | null = last ? null : offset ? { start: (index + 1) * 100 } : { cursor: `p${index + 1}` };
        yield { items: pages[index] as T[], resumeAt };
      }
    },
  };
  return { client, calls };
}
