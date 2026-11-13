import { BOT_LIMITS, BOT_ROLE_OPTIONS, BOT_SCOPE_CATALOGUE, BOT_SCOPES, isCatalogueScope } from "@/lib/sales/bot-scopes";
import type { BotActivityItem, BotView } from "@/lib/sales/bots-screen";

// Plain words for the Bots screen. Pure functions, browser-safe (the
// bots-screen import is for types only). Every time word takes the server's
// clock (`now`) so the server and the browser say the same thing.

export * from "@/lib/sales/bot-draft";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function roleLabel(scopes: readonly string[]): string {
  return BOT_ROLE_OPTIONS.find((role) => sameSet(role.scopes, scopes))?.label ?? "Custom";
}

export function permissionSummary(scopes: readonly string[]): string {
  const labels = BOT_SCOPES.filter((s) => scopes.includes(s)).map((s) => BOT_SCOPE_CATALOGUE[s].label);
  return labels.length ? labels.join(", ") : "No permissions";
}

export function pipelinesText(bot: Pick<BotView, "allPipelines" | "pipelineKeys">, pipelines: { key: string; name: string }[]): string {
  if (bot.allPipelines) return "All pipelines";
  if (bot.pipelineKeys.length === 0) return "No pipelines";
  return bot.pipelineKeys.map((key) => pipelines.find((p) => p.key === key)?.name ?? key).join(", ");
}

export function callsTodayText(calls: number): string {
  return `${count(calls)} of ${count(BOT_LIMITS.perDay)} calls today`;
}

export function lastUsedText(lastUsedAt: string | null, now: string): string {
  if (!lastUsedAt) return "Never used";
  const ago = Date.parse(now) - Date.parse(lastUsedAt);
  if (ago < MINUTE) return "Used just now";
  if (ago < HOUR) return `Used ${plural(Math.floor(ago / MINUTE), "minute")} ago`;
  if (ago < DAY) return `Used ${plural(Math.floor(ago / HOUR), "hour")} ago`;
  return `Used ${plural(Math.floor(ago / DAY), "day")} ago`;
}

export const EXPIRY_WARN_DAYS = 14;

export function expiryInfo(expiresAt: string | null, now: string): { text: string; warn: boolean } {
  if (!expiresAt) return { text: "Key has no end date. Rotate it to set one.", warn: true };
  const left = Date.parse(expiresAt) - Date.parse(now);
  if (left <= 0) return { text: "Key expired. Rotate it to use this bot again.", warn: true };
  const days = Math.ceil(left / DAY);
  if (days < EXPIRY_WARN_DAYS) return { text: `Key expires in ${plural(days, "day")}`, warn: true };
  const date = new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { text: `Key works until ${date}`, warn: false };
}

export function statusInfo(bot: Pick<BotView, "enabled" | "offReason" | "mustRotate">): { label: string; on: boolean; reason: string | null } {
  if (bot.enabled) return { label: "On", on: true, reason: null };
  if (bot.mustRotate) return { label: "Off", on: false, reason: "Its key came back from a backup. Rotate the key before turning it on." };
  if (bot.offReason) return { label: "Off", on: false, reason: `The app turned it off because ${bot.offReason}` };
  return { label: "Off", on: false, reason: null };
}

const THING: Record<string, string> = {
  SalesDeal: "a deal",
  SalesLead: "a lead",
  SalesPerson: "a contact",
  SalesOrganization: "a contact",
  BotToken: "this bot",
};

const DID: Record<string, (thing: string) => string> = {
  note_added: (t) => `Added a note to ${t}`,
  note_edited: (t) => `Edited a note on ${t}`,
  activity_added: (t) => `Added a call, meeting or task to ${t}`,
  activity_done: (t) => `Ticked off a task on ${t}`,
  stage_changed: (t) => `Moved ${t} to another stage`,
  created: (t) => `Created ${t}`,
  updated: (t) => `Changed ${t}`,
};

export function describeActivity(item: BotActivityItem): string {
  if (item.action === "auto_turned_off") return `Turned off by the app: ${item.detail ?? "too many problems."}`;
  const thing = THING[item.entityType] ?? "a record";
  const did = DID[item.action];
  return did ? did(thing) : `Changed ${thing} (${item.action.replaceAll("_", " ")})`;
}

/** "Nov 13, 12:00 UTC": short and the same on the server and in the browser. */
export function whenText(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

export { isCatalogueScope };
