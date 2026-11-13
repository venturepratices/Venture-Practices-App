import type { BotActivityItem } from "@/lib/sales/bots-screen";

// The Bots screen's way to its admin routes. Every call answers with a result
// instead of throwing, so the screen always has plain words to show. The key
// comes back only from create and rotate, and the screen keeps it in memory
// only (never storage, the address bar or a toast).

export type BotsResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NETWORK = "Could not reach the app. Check your connection and try again.";
const UNKNOWN = "Something went wrong. Try again.";
const JSON_HEADERS = { "Content-Type": "application/json" };

async function call<T>(url: string, init: RequestInit): Promise<BotsResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store" });
  } catch {
    return { ok: false, error: NETWORK };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no JSON to read
  }
  if (res.ok && body !== null) return { ok: true, data: body as T };
  const error = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : UNKNOWN;
  return { ok: false, error: error === "Invalid input" ? "Something in the form is not right. Check it and try again." : error };
}

const botUrl = (id: string) => `/api/sales/bots/${encodeURIComponent(id)}`;

export type MadeKey = { bot: { id: string; name: string }; secret: string };

export function createBotRequest(body: object): Promise<BotsResult<MadeKey>> {
  return call("/api/sales/bots", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function updateBotRequest(id: string, body: object): Promise<BotsResult<{ bot: unknown }>> {
  return call(botUrl(id), { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function rotateBotRequest(id: string, password: string): Promise<BotsResult<MadeKey>> {
  return call(`${botUrl(id)}?action=rotate`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ password }) });
}

export function deleteBotRequest(id: string): Promise<BotsResult<{ ok: true }>> {
  return call(botUrl(id), { method: "DELETE" });
}

export function botActivityRequest(id: string): Promise<BotsResult<{ activity: BotActivityItem[] }>> {
  return call(`${botUrl(id)}/activity`, { method: "GET" });
}
