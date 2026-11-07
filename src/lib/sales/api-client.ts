import type { ActivitiesQuery } from "@/lib/sales/activities-query";
import { activitiesQueryToSearch } from "@/lib/sales/activities-query";
import type { CreateActivityInput, setActivityDone } from "@/lib/sales/activities";
import type { ActivityRowsPage } from "@/lib/sales/activities-page";
import type { DealListPage } from "@/lib/sales/board";
import type { BoardQuery, SavedView } from "@/lib/sales/board-query";
import { boardQueryToSearch } from "@/lib/sales/board-query";
import type { ContactPanelData } from "@/lib/sales/contact-panel";
import type { MergeCounts } from "@/lib/sales/contact-merge";
import type {
  CreateOrganizationInput,
  CreatePersonInput,
  UpdateOrganizationInput,
  UpdatePersonInput,
} from "@/lib/sales/contacts-edit";
import type { ContactRowsPage } from "@/lib/sales/contacts-page";
import type { ContactKind, ContactsQuery } from "@/lib/sales/contacts-query";
import { CONTACT_PATHS, contactsQueryToSearch } from "@/lib/sales/contacts-query";
import type { ContactResult } from "@/lib/sales/contacts";
import type { DealPanelData, PanelActivity } from "@/lib/sales/deal-panel";
import type { addDealNote, editNote, NoteInput } from "@/lib/sales/notes";
import type { CreateDealInput, updateDeal, UpdateDealInput } from "@/lib/sales/deals";
import type { BulkLeadInput, BulkLeadResult } from "@/lib/sales/lead-bulk";
import type { BulkConvertInput, BulkConvertResult, ConvertLeadInput, ConvertTarget, convertLead } from "@/lib/sales/lead-convert";
import type { LeadPanelData } from "@/lib/sales/lead-panel";
import type { CreateLeadInput, updateLead, UpdateLeadInput } from "@/lib/sales/leads";
import type { LeadRowsPage } from "@/lib/sales/leads-page";
import type { LeadsQuery } from "@/lib/sales/leads-query";
import { leadsQueryToSearch } from "@/lib/sales/leads-query";
import type { DealStatusInput, MoveDealInput, MoveResult, setDealStatus } from "@/lib/sales/stage-moves";
import type { TimelineCursor, TimelinePage } from "@/lib/sales/timeline";

// The browser's way to the Sales routes: one small typed wrapper per route the
// board, the deal and lead panels, the Activities page and the Leads Inbox
// call. Every call answers with an ApiResult instead of throwing, so a screen
// always has a message to show. The server modules are imported for their
// types only (erased at build time), so nothing server-side reaches the
// browser bundle; runtime values come only from client-safe `*-query.ts`.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";
const UNKNOWN_ERROR = "Something went wrong. Try again.";

/** What a write route answers with on success: its result without the refusal branch. */
type Answer<F extends (...args: never[]) => Promise<unknown>> = Extract<Awaited<ReturnType<F>>, { ok: true }>;

const JSON_HEADERS = { "Content-Type": "application/json" };

function readField(body: unknown, key: string): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function request<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A proxy error page or an unexpected crash: no JSON to read.
    return { ok: false, status: response.status, error: UNKNOWN_ERROR };
  }

  if (response.ok) return { ok: true, data: body as T };
  const error = readField(body, "error") ?? UNKNOWN_ERROR;
  const code = readField(body, "code");
  return code ? { ok: false, status: response.status, error, code } : { ok: false, status: response.status, error };
}

const get = <T>(url: string) => request<T>(url, { method: "GET" });
const send = <T>(method: "POST" | "PATCH" | "PUT", url: string, body: unknown) =>
  request<T>(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });

const dealUrl = (dealId: string) => `/api/sales/deals/${encodeURIComponent(dealId)}`;
const leadUrl = (leadId: string) => `/api/sales/leads/${encodeURIComponent(leadId)}`;

/** The deal or lead an activity or note is added to. */
export type SalesParentRef = { kind: "deal" | "lead"; id: string };

const parentUrl = (parent: SalesParentRef) => (parent.kind === "lead" ? leadUrl(parent.id) : dealUrl(parent.id));

// --- Deals ---

export function getDealPanel(dealId: string): Promise<ApiResult<DealPanelData>> {
  return get(dealUrl(dealId));
}

/** "?at=...&id=..." for an older History page, or nothing for the newest. */
const timelineSearch = (cursor: TimelineCursor | null) =>
  cursor ? `?${new URLSearchParams({ at: cursor.at, id: cursor.id })}` : "";

export function getDealTimeline(dealId: string, cursor: TimelineCursor | null): Promise<ApiResult<TimelinePage>> {
  return get(`${dealUrl(dealId)}/timeline${timelineSearch(cursor)}`);
}

/** One more page of the Deals list view: the page's own filters (with its resolved pipeline) and `query.cursor`. */
export function getDealListPage(query: BoardQuery): Promise<ApiResult<DealListPage>> {
  const search = new URLSearchParams(boardQueryToSearch(query));
  if (query.cursor) search.set("cursor", query.cursor);
  return get(`/api/sales/deals?${search}`);
}

export function createDealRequest(body: CreateDealInput): Promise<ApiResult<{ deal: { id: string; pipelineKey: string } }>> {
  return send("POST", "/api/sales/deals", body);
}

export function updateDealRequest(
  dealId: string,
  body: UpdateDealInput,
): Promise<ApiResult<{ deal: Answer<typeof updateDeal>["deal"] }>> {
  return send("PATCH", dealUrl(dealId), body);
}

export function deleteDealRequest(dealId: string): Promise<ApiResult<{ ok: true }>> {
  return request(dealUrl(dealId), { method: "DELETE" });
}

/** Set (`value`) or clear (`null`) one custom field. */
export function setDealFieldRequest(
  dealId: string,
  fieldKey: string,
  value: string | null,
): Promise<ApiResult<{ value: string | null }>> {
  return send("PUT", `${dealUrl(dealId)}/fields/${encodeURIComponent(fieldKey)}`, { value });
}

export function moveDealRequest(dealId: string, body: MoveDealInput): Promise<ApiResult<MoveResult>> {
  return send("POST", `${dealUrl(dealId)}/move`, body);
}

export function setDealStatusRequest(dealId: string, body: DealStatusInput): Promise<ApiResult<Answer<typeof setDealStatus>>> {
  return send("POST", `${dealUrl(dealId)}/status`, body);
}

// --- Leads ---

/** One more page of the Leads Inbox: the page's scope and search and `query.cursor`. */
export function getLeadRowsPage(query: LeadsQuery): Promise<ApiResult<LeadRowsPage>> {
  const search = new URLSearchParams(leadsQueryToSearch(query));
  if (query.cursor) search.set("cursor", query.cursor);
  return get(`/api/sales/leads?${search}`);
}

export function getLeadPanel(leadId: string): Promise<ApiResult<LeadPanelData>> {
  return get(leadUrl(leadId));
}

export function getLeadTimeline(leadId: string, cursor: TimelineCursor | null): Promise<ApiResult<TimelinePage>> {
  return get(`${leadUrl(leadId)}/timeline${timelineSearch(cursor)}`);
}

export function createLeadRequest(body: CreateLeadInput): Promise<ApiResult<{ lead: { id: string } }>> {
  return send("POST", "/api/sales/leads", body);
}

export function updateLeadRequest(
  leadId: string,
  body: UpdateLeadInput,
): Promise<ApiResult<{ lead: Answer<typeof updateLead>["lead"] }>> {
  return send("PATCH", leadUrl(leadId), body);
}

/** Archive (`true`) or restore (`false`) a lead. `changed` is false when it already was. */
export function setLeadArchivedRequest(leadId: string, archived: boolean): Promise<ApiResult<{ ok: true; changed: boolean }>> {
  return send("POST", `${leadUrl(leadId)}/archive`, { archived });
}

/** Set (`value`) or clear (`null`) one of a lead's custom fields. */
export function setLeadFieldRequest(
  leadId: string,
  fieldKey: string,
  value: string | null,
): Promise<ApiResult<{ value: string | null }>> {
  return send("PUT", `${leadUrl(leadId)}/fields/${encodeURIComponent(fieldKey)}`, { value });
}

/** The Inbox bulk bar's assign, archive, restore or delete: one result per lead. */
export function runLeadBulkRequest(body: BulkLeadInput): Promise<ApiResult<{ results: BulkLeadResult[] }>> {
  return send("POST", "/api/sales/leads/bulk", body);
}

/** The pipelines and stages a lead may be converted into. */
export function getConvertTargets(): Promise<ApiResult<{ targets: ConvertTarget[] }>> {
  return get("/api/sales/leads/convert");
}

export function convertLeadRequest(
  leadId: string,
  body: ConvertLeadInput,
): Promise<ApiResult<{ deal: Answer<typeof convertLead>["deal"] }>> {
  return send("POST", `${leadUrl(leadId)}/convert`, body);
}

/** The bulk bar's Convert: one result per lead, and the pipeline they went to. */
export function convertLeadsRequest(
  body: BulkConvertInput,
): Promise<ApiResult<{ results: BulkConvertResult[]; pipeline: { key: string; name: string } }>> {
  return send("POST", "/api/sales/leads/convert", body);
}

// --- Activities and notes ---

/** Schedules an activity on a deal or a lead. */
export function createActivityFor(parent: SalesParentRef, body: CreateActivityInput): Promise<ApiResult<{ activity: PanelActivity }>> {
  return send("POST", `${parentUrl(parent)}/activities`, body);
}

export function createActivityRequest(dealId: string, body: CreateActivityInput): Promise<ApiResult<{ activity: PanelActivity }>> {
  return createActivityFor({ kind: "deal", id: dealId }, body);
}

export function setActivityDoneRequest(activityId: string, done: boolean): Promise<ApiResult<Answer<typeof setActivityDone>>> {
  return send("PATCH", `/api/sales/activities/${encodeURIComponent(activityId)}`, { done });
}

/** One more page of the Activities list: the page's filters and `query.cursor`. */
export function getActivitiesPage(query: ActivitiesQuery): Promise<ApiResult<ActivityRowsPage>> {
  const search = new URLSearchParams(activitiesQueryToSearch(query));
  if (query.cursor) search.set("cursor", query.cursor);
  return get(`/api/sales/activities?${search}`);
}

/** Adds a note to a deal or a lead. */
export function addNoteFor(parent: SalesParentRef, body: NoteInput): Promise<ApiResult<{ note: Answer<typeof addDealNote>["note"] }>> {
  return send("POST", `${parentUrl(parent)}/notes`, body);
}

export function addNoteRequest(dealId: string, body: NoteInput): Promise<ApiResult<{ note: Answer<typeof addDealNote>["note"] }>> {
  return addNoteFor({ kind: "deal", id: dealId }, body);
}

export function editNoteRequest(noteId: string, body: NoteInput): Promise<ApiResult<Answer<typeof editNote>>> {
  return send("PATCH", `/api/sales/notes/${encodeURIComponent(noteId)}`, body);
}

// --- Contacts ---

/** One more page of the Contacts list: the page's scope and search and `query.cursor`, for the tab's path. */
export function getContactRowsPage(query: ContactsQuery): Promise<ApiResult<ContactRowsPage>> {
  const search = new URLSearchParams(contactsQueryToSearch(query).replace(/^tab=[^&]*&?/, ""));
  if (query.cursor) search.set("cursor", query.cursor);
  return get(`/api/sales/contacts/${CONTACT_PATHS[query.tab === "organizations" ? "organization" : "person"]}?${search}`);
}

/** "+ Person" or "+ Organization": adds a contact owned by the actor and hands back its id and name. */
export function createContactRequest(
  kind: ContactKind,
  body: CreatePersonInput | CreateOrganizationInput,
): Promise<ApiResult<{ contact: { id: string; name: string } }>> {
  return send("POST", `/api/sales/contacts/${CONTACT_PATHS[kind]}`, body);
}

const contactUrl = (kind: ContactKind, id: string) =>
  `/api/sales/contacts/${CONTACT_PATHS[kind]}/${encodeURIComponent(id)}`;

/** The contact panel data for one person or one organization (A4: null returns 404 "Contact not found."). */
export function getContactPanel(kind: ContactKind, id: string): Promise<ApiResult<ContactPanelData>> {
  return get(contactUrl(kind, id));
}

/** One page of a contact's History (an older page when a cursor is sent). */
export function getContactTimeline(
  kind: ContactKind,
  id: string,
  cursor: TimelineCursor | null,
): Promise<ApiResult<TimelinePage>> {
  return get(`${contactUrl(kind, id)}/timeline${timelineSearch(cursor)}`);
}

/** Edits a person or an organization with PATCH; only the keys sent change. */
export function updateContactRequest(
  kind: ContactKind,
  id: string,
  body: UpdatePersonInput | UpdateOrganizationInput,
): Promise<ApiResult<{ changed: boolean; contact: { id: string; name: string } }>> {
  return send("PATCH", contactUrl(kind, id), body);
}

/** What merging `dropId` into `keepId` would move, for the merge dialog (admins only). */
export function getMergePreview(
  kind: ContactKind,
  keepId: string,
  dropId: string,
): Promise<ApiResult<{ keep: { id: string; name: string }; drop: { id: string; name: string }; counts: MergeCounts }>> {
  return get(`${contactUrl(kind, keepId)}/merge?with=${encodeURIComponent(dropId)}`);
}

/** Merges `dropId` into `keepId` (admins only); the panel swaps to the kept id. */
export function mergeContactsRequest(
  kind: ContactKind,
  keepId: string,
  dropId: string,
): Promise<ApiResult<{ kept: { id: string; name: string } }>> {
  return send("POST", `${contactUrl(kind, keepId)}/merge`, { dropId });
}

// --- Pickers and preferences ---

/** The contact picker's organization and person search (up to 8 names; nothing under two letters). */
export function searchContactsRequest(
  kind: "organization" | "person",
  q: string,
): Promise<ApiResult<{ results: ContactResult[] }>> {
  return get(`/api/sales/contacts?${new URLSearchParams({ kind, q })}`);
}

/** Remembers this person's pipeline, Board or List, and Everyone or Just me. */
export function saveDefaultViewRequest(view: SavedView): Promise<ApiResult<{ ok: true }>> {
  return send("PUT", "/api/sales/view", view);
}
