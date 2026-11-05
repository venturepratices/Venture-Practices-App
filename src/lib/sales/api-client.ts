import type { ActivitiesQuery } from "@/lib/sales/activities-query";
import { activitiesQueryToSearch } from "@/lib/sales/activities-query";
import type { CreateActivityInput, setActivityDone } from "@/lib/sales/activities";
import type { ActivityRowsPage } from "@/lib/sales/activities-page";
import type { DealListPage } from "@/lib/sales/board";
import type { BoardQuery, SavedView } from "@/lib/sales/board-query";
import { boardQueryToSearch } from "@/lib/sales/board-query";
import type { ContactResult } from "@/lib/sales/contacts";
import type { DealPanelData, PanelActivity } from "@/lib/sales/deal-panel";
import type { addDealNote, editNote, NoteInput } from "@/lib/sales/notes";
import type { CreateDealInput, updateDeal, UpdateDealInput } from "@/lib/sales/deals";
import type { DealStatusInput, MoveDealInput, MoveResult, setDealStatus } from "@/lib/sales/stage-moves";
import type { TimelineCursor, TimelineEntry } from "@/lib/sales/timeline";

// The browser's way to the Sales routes: one small typed wrapper per route the
// board, the deal panel and the Activities page call. Every call answers with
// an ApiResult instead of throwing, so a screen always has a message to show.
// The server modules are imported for their types only (erased at build time),
// so nothing server-side reaches the browser bundle.

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

// --- Deals ---

export function getDealPanel(dealId: string): Promise<ApiResult<DealPanelData>> {
  return get(dealUrl(dealId));
}

export function getDealTimeline(
  dealId: string,
  cursor: TimelineCursor | null,
): Promise<ApiResult<{ entries: TimelineEntry[]; nextCursor: TimelineCursor | null }>> {
  const search = cursor ? `?${new URLSearchParams({ at: cursor.at, id: cursor.id })}` : "";
  return get(`${dealUrl(dealId)}/timeline${search}`);
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

// --- Activities and notes ---

export function createActivityRequest(dealId: string, body: CreateActivityInput): Promise<ApiResult<{ activity: PanelActivity }>> {
  return send("POST", `${dealUrl(dealId)}/activities`, body);
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

export function addNoteRequest(dealId: string, body: NoteInput): Promise<ApiResult<{ note: Answer<typeof addDealNote>["note"] }>> {
  return send("POST", `${dealUrl(dealId)}/notes`, body);
}

export function editNoteRequest(noteId: string, body: NoteInput): Promise<ApiResult<Answer<typeof editNote>>> {
  return send("PATCH", `/api/sales/notes/${encodeURIComponent(noteId)}`, body);
}

// --- Pickers and preferences ---

/** The Add deal dialog's organization and person search (up to 8 names; nothing under two letters). */
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
