// In-memory fake Pipedrive. It is the REAL client (createPipedriveClient) with an
// injected fetch that answers from memory, so the real paging code (cursor, offset
// with a pagination block, offset WITHOUT one for leads) is what runs. No network:
// any host other than the fake base is refused.
import { createPipedriveClient, PipedriveError, type PipedriveClient, type PageToken } from "@/lib/sales/pipedrive/client";

const BASE = "https://api.pipedrive.com";
/** Small pages so multi-page paging and mid-phase resume are exercised. */
const PAGE = 3;

export const H = (n: number) => n.toString(16).padStart(40, "0"); // a 40-hex custom field key
export const KEY_TARGET_START = H(0x9000a01);
export const KEY_TIER = H(0x9000a02);
export const LEAD = (n: number) => `90000000-0000-4000-8000-00000000000${n}`;

export type Dataset = Record<string, unknown[]>;

export function buildDataset(emails: { a: string; b: string }): Dataset {
  const t = (d: string) => `${d}T10:00:00Z`;
  const users = [
    { id: 9000001, name: "REHEARSAL User A", email: emails.a, active_flag: true },
    { id: 9000002, name: "REHEARSAL User B", email: emails.b, active_flag: true },
    { id: 9000003, name: "REHEARSAL Unmatched", email: "rehearsal-unmatched@example.invalid", active_flag: true },
    { id: 9000004, name: "REHEARSAL Deactivated", email: "rehearsal-deactivated@example.invalid", active_flag: false },
  ];
  const pipelines = [
    { id: 9000101, name: "Direct Mail", order_nr: 1 },
    { id: 9000102, name: "New Mover Mail", order_nr: 2 },
    { id: 9000103, name: "REHEARSAL Pipeline", order_nr: 3 },
  ];
  const dm = ["New Opt-In", "Appointment Scheduled", "No Show", "Demo Complete", "Proposal Sent", "Follow-Up", "Contract Signed", "Sent to Onboarding", "REHEARSAL Extra Stage"];
  const nm = ["New Lead - Check Availability", "90 Day Trial/Get Started", "Demo Scheduled", "No Show/Cancel", "Proposal Sent", "Follow-Up", "Deal Won"];
  const stages = [
    ...dm.map((name, i) => ({ id: 9000201 + i, name, order_nr: i + 1, pipeline_id: 9000101, deal_probability: 50, is_deal_rot_enabled: true, days_to_rotten: 12 })),
    ...nm.map((name, i) => ({ id: 9000211 + i, name, order_nr: i + 1, pipeline_id: 9000102 })),
    { id: 9000221, name: "REHEARSAL Stage One", order_nr: 1, pipeline_id: 9000103 },
    { id: 9000222, name: "REHEARSAL Stage Two", order_nr: 2, pipeline_id: 9000103 },
  ];
  const dealFields = [
    { key: "title", name: "Title", field_type: "varchar" },
    { key: KEY_TARGET_START, name: "Target Start Date", field_type: "date" },
    { key: KEY_TIER, name: "REHEARSAL Lead Tier", field_type: "enum", options: [{ id: 9000301, label: "Gold" }, { id: 9000302, label: "Silver" }] },
  ];
  const orgOwners = [9000001, 9000002, 9000003, 9000001, 9000002, 9000001];
  const organizations = orgOwners.map((owner, i) => ({
    id: 9000401 + i, name: `REHEARSAL Org ${i + 1}`, owner_id: owner, add_time: t(`2025-0${i + 1}-15`),
    address: { value: "1 Rehearsal Way" }, website: null,
  }));
  const persons = [
    { id: 9000501, name: "REHEARSAL Person 1", org_id: 9000401, owner_id: 9000001, add_time: t("2025-02-01"),
      emails: [{ value: "rehearsal-p1@example.invalid", primary: true }, { value: "rehearsal-p1b@example.invalid", primary: false }] },
    { id: 9000502, name: null, first_name: null, last_name: null, org_id: 9000402, owner_id: 9000002, add_time: t("2025-02-02"),
      emails: [{ value: "rehearsal-p2@example.invalid", primary: true }] },
    ...[3, 4, 5, 6, 7].map((n) => ({ id: 9000500 + n, name: `REHEARSAL Person ${n}`, org_id: 9000400 + ((n % 5) + 1), owner_id: 9000001, add_time: t(`2025-02-0${n}`) })),
    { id: 9000508, name: "REHEARSAL Person 8", org_id: null, owner_id: 9000003, add_time: t("2025-02-09") },
  ];
  const deal = (id: number, extra: Record<string, unknown>) => ({
    id, title: `REHEARSAL Deal ${id - 9000600}`, owner_id: 9000001, person_id: 9000501, org_id: 9000401,
    pipeline_id: 9000101, stage_id: 9000201, value: 1000, currency: "USD", status: "open",
    add_time: t(`2025-03-${String(id - 9000600).padStart(2, "0")}`), stage_change_time: t("2025-04-01"), ...extra,
  });
  const deals = [
    deal(9000601, { custom_fields: { [KEY_TARGET_START]: "2026-12-01", [KEY_TIER]: 9000301 } }),
    deal(9000602, { status: "won", won_time: t("2025-05-01"), stage_id: 9000207, owner_id: 9000002, person_id: 9000502, org_id: 9000402 }),
    deal(9000603, { status: "lost", lost_time: t("2025-05-02"), lost_reason: "Too expensive", pipeline_id: 9000102, stage_id: 9000213, person_id: 9000503, org_id: 9000404 }),
    deal(9000604, { status: "deleted" }),
    deal(9000605, { value: 0 }),
    deal(9000606, { value: 2500, currency: "EUR" }),
    deal(9000607, { stage_id: 9000209 }),
    deal(9000608, { pipeline_id: 9000103, stage_id: 9000221, owner_id: 9000003, person_id: null, org_id: null }),
    deal(9000609, { owner_id: 9000004, custom_fields: { [KEY_TIER]: 9999999 } }),
  ];
  const archivedDeals = [
    deal(9000610, { is_archived: true, archive_time: t("2025-06-01") }),
    deal(9000611, { is_archived: true, archive_time: t("2025-06-02"), status: "won", won_time: t("2025-05-20"), stage_id: 9000208 }),
    deal(9000612, { is_archived: true, archive_time: t("2025-06-03"), stage_id: 9999999 }),
  ];
  const leads = [
    { id: LEAD(1), title: "REHEARSAL Lead 1", owner_id: 9000001, person_id: 9000501, organization_id: 9000401, add_time: t("2025-07-01"), [KEY_TARGET_START]: "2026-12-05" },
    { id: LEAD(2), title: "REHEARSAL Lead 2", owner_id: 9000002, person_id: null, organization_id: 9000402, add_time: t("2025-07-02") },
    { id: LEAD(3), title: "REHEARSAL Lead 3", owner_id: 9000003, person_id: 9000504, organization_id: null, add_time: t("2025-07-03") },
  ];
  const archivedLeads = [{ id: LEAD(4), title: "REHEARSAL Lead 4", owner_id: 9000001, person_id: 9000505, is_archived: true, add_time: t("2025-07-04"), update_time: t("2025-08-01") }];
  const act = (id: number, extra: Record<string, unknown>) => ({
    id, subject: `REHEARSAL Activity ${id - 9000700}`, type: "call", done: false, due_date: "2025-09-01", due_time: "14:30",
    owner_id: 9000001, add_time: t("2025-08-15"), ...extra,
  });
  const activities = [
    act(9000701, { deal_id: 9000601, person_id: 9000501 }),
    act(9000702, { due_date: null, due_time: null, person_id: 9000502 }),
    act(9000703, { due_time: null, deal_id: 9000602 }),
    act(9000704, { type: "rehearsal_custom_type", lead_id: LEAD(1) }),
    act(9000705, { done: true, marked_as_done_time: null, deal_id: 9000603 }),
    act(9000706, { org_id: 9000406 }),
    act(9000707, { org_id: 9000401, type: "meeting" }),
    act(9000708, { type: "meeting", due_time: "00:00", deal_id: 9000606 }),
    act(9000709, { type: "email", deal_id: 9000607, owner_id: 9000003 }),
    act(9000710, { type: "task", deal_id: 9000604 }),
  ];
  const note = (id: number, extra: Record<string, unknown>) => ({ id, content: `<p>REHEARSAL note ${id - 9000800}</p>`, user_id: 9000001, add_time: t("2025-10-01"), active_flag: true, ...extra });
  const notes = [
    note(9000801, { content: "<p>Hello <b>team</b></p><script>alert('x')</script><p>REHEARSAL after</p>", deal_id: 9000601, pinned_to_deal_flag: true }),
    note(9000802, { person_id: 9000501, pinned_to_person_flag: true, user_id: 9000003 }),
    note(9000803, { org_id: 9000402 }),
    note(9000804, { lead_id: LEAD(2) }),
    note(9000805, { content: "<p></p>", deal_id: 9000601 }),
    note(9000806, { deal_id: 9000604 }),
  ];
  const files = [
    { id: 9000901, name: "REHEARSAL proposal.pdf", file_size: 1200, deal_id: 9000601, deal_name: "REHEARSAL Deal 1", add_time: "2025-10-02 10:00:00", active_flag: true },
    { id: 9000902, name: "REHEARSAL big.pdf", file_size: 5 * 1024 * 1024, deal_id: 9000602, deal_name: "REHEARSAL Deal 2", add_time: "2025-10-03 10:00:00", active_flag: true },
    { id: 9000903, name: "REHEARSAL tool.exe", file_size: 1000, deal_id: 9000603, deal_name: "REHEARSAL Deal 3", add_time: "2025-10-04 10:00:00", active_flag: true },
  ];
  return {
    "/api/v1/users": users, "/api/v2/pipelines": pipelines, "/api/v2/stages": stages, "/api/v1/dealFields": dealFields,
    "/api/v2/organizations": organizations, "/api/v2/persons": persons, "/api/v2/deals": deals, "/api/v2/deals/archived": archivedDeals,
    "/api/v1/leads": leads, "/api/v1/leads/archived": archivedLeads, "/api/v2/activities": activities, "/api/v1/notes": notes, "/api/v1/files": files,
  };
}

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const CURSOR_PATHS = new Set(["/api/v2/pipelines", "/api/v2/stages", "/api/v2/organizations", "/api/v2/persons", "/api/v2/deals", "/api/v2/deals/archived", "/api/v2/activities"]);
const NO_PAGINATION_BLOCK = new Set(["/api/v1/leads", "/api/v1/leads/archived"]);

export function makeFakeClient(data: Dataset): { client: PipedriveClient; requests: string[] } {
  const requests: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== BASE) throw new Error("fake: refused non-fake host");
    const path = url.pathname;
    requests.push(path + (url.search ? `?${url.searchParams.get("cursor") ?? url.searchParams.get("start") ?? ""}` : ""));
    const dl = /^\/api\/v1\/files\/(\d+)\/download$/.exec(path);
    if (dl) {
      if (Number(dl[1]) === 9000903) return new Response(new Uint8Array([0x4d, 0x5a, 0x90, 0]), { status: 200, headers: { "content-type": "application/octet-stream" } });
      return new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } });
    }
    const list = data[path];
    if (!list) return new Response(JSON.stringify({ success: false, error: "not found" }), { status: 404 });
    const limit = Number(url.searchParams.get("limit") ?? 100);
    if (CURSOR_PATHS.has(path)) {
      const start = url.searchParams.get("cursor") ? Number(url.searchParams.get("cursor")!.slice(1)) : 0;
      const size = Math.min(limit, PAGE);
      const next = start + size < list.length ? `c${start + size}` : null;
      return json({ success: true, data: list.slice(start, start + size), additional_data: { next_cursor: next } });
    }
    const start = Number(url.searchParams.get("start") ?? 0);
    if (NO_PAGINATION_BLOCK.has(path)) {
      // Leads: no pagination block at all. Honors the asked limit like Pipedrive does.
      return json({ success: true, data: list.slice(start, start + limit), additional_data: null });
    }
    const size = Math.min(limit, PAGE);
    const more = start + size < list.length;
    return json({
      success: true,
      data: list.slice(start, start + size),
      additional_data: { pagination: { start, limit: size, more_items_in_collection: more, ...(more ? { next_start: start + size } : {}) } },
    });
  }) as typeof fetch;
  const client = createPipedriveClient({ token: "rehearsal-fake-token-0000", baseUrl: BASE, fetchImpl, sleep: async () => {} });
  return { client, requests };
}

/** Wraps a client so the Nth call of pageBatches for `path` throws `error` (once). */
export function failingClient(inner: PipedriveClient, path: string, error: PipedriveError, opts: { times?: number } = {}): PipedriveClient {
  let left = opts.times ?? 1;
  return {
    pages: inner.pages,
    download: inner.download,
    pageBatches<T>(p: string, o?: Parameters<PipedriveClient["pageBatches"]>[1]) {
      if (p === path && left > 0) {
        left -= 1;
        // eslint-disable-next-line require-yield
        return (async function* () { throw error; })() as AsyncGenerator<{ items: T[]; resumeAt: PageToken | null }, void, void>;
      }
      return inner.pageBatches<T>(p, o);
    },
  };
}
