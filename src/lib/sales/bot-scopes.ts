// What a bot key may do. Plain constants with no imports, so the Bots screen
// can load them in the browser. This file is the one permission catalogue:
// the routes validate against it, the key check reads it, and the screen shows
// its labels, sentences and risk marks. There is deliberately no permission for
// deleting, exporting or changing settings: a bot can never be given those.
//
// Adding another area later (for example call records or clients): add its key
// to BOT_SCOPE_AREAS and its permissions to BOT_SCOPES and BOT_SCOPE_CATALOGUE.
// The screen groups by area from these lists, so its code does not change.

export const BOT_SCOPES = ["read", "notes", "activities", "move", "create"] as const;
export type BotScope = (typeof BOT_SCOPES)[number];

export const BOT_SCOPE_AREAS = [{ key: "sales", label: "Sales" }] as const;
export type BotScopeArea = (typeof BOT_SCOPE_AREAS)[number]["key"];

/** How much harm a permission could do if a bot misbehaves or its key leaks. */
export type BotRisk = "low" | "medium" | "higher";

export const BOT_RISK_LABELS: Record<BotRisk, string> = {
  low: "Low risk",
  medium: "Medium risk",
  higher: "Higher risk",
};

export type BotScopeInfo = {
  key: BotScope;
  label: string;
  description: string;
  area: BotScopeArea;
  risk: BotRisk;
};

export const BOT_SCOPE_CATALOGUE: Record<BotScope, BotScopeInfo> = {
  read: {
    key: "read",
    label: "See deals and leads",
    description: "Can look at the deals, leads and contacts the person it works for can see. It cannot change anything.",
    area: "sales",
    risk: "low",
  },
  notes: {
    key: "notes",
    label: "Add notes",
    description: "Can write new notes on deals and leads, marked as written by the bot.",
    area: "sales",
    risk: "low",
  },
  activities: {
    key: "activities",
    label: "Add calls, meetings and tasks",
    description: "Can add calls, meetings and to-dos to deals and leads.",
    area: "sales",
    risk: "medium",
  },
  move: {
    key: "move",
    label: "Move deals between stages",
    description: "Can move a deal to another stage, which changes the pipeline numbers everyone sees.",
    area: "sales",
    risk: "higher",
  },
  create: {
    key: "create",
    label: "Create deals and leads",
    description: "Can add new deals and leads, owned by the person it works for.",
    area: "sales",
    risk: "medium",
  },
};

/** The catalogue in the standard order. */
export const BOT_SCOPE_LIST: readonly BotScopeInfo[] = BOT_SCOPES.map((scope) => BOT_SCOPE_CATALOGUE[scope]);

/** True only for a permission in the catalogue (never for "delete", "export" or a made-up name). */
export function isCatalogueScope(value: string): value is BotScope {
  return (BOT_SCOPES as readonly string[]).includes(value);
}

export const BOT_ROLES = ["read", "helper", "rep"] as const;
export type BotRole = (typeof BOT_ROLES)[number];

export const BOT_ROLE_PRESETS: Record<BotRole, BotScope[]> = {
  read: ["read"],
  helper: ["read", "notes", "activities"],
  rep: ["read", "notes", "activities", "move", "create"],
};

export type BotRoleOption = { key: BotRole; label: string; description: string; scopes: BotScope[] };

/** The role presets as the screen lists them, built from the catalogue. */
export const BOT_ROLE_OPTIONS: readonly BotRoleOption[] = [
  { key: "read", label: "Read only", description: "Looks, never changes anything.", scopes: BOT_ROLE_PRESETS.read },
  {
    key: "helper",
    label: "Helper",
    description: "Looks, and adds notes, calls, meetings and tasks.",
    scopes: BOT_ROLE_PRESETS.helper,
  },
  {
    key: "rep",
    label: "Rep",
    description: "Does what a helper does, and also moves deals and creates deals and leads.",
    scopes: BOT_ROLE_PRESETS.rep,
  },
];

/** Calls one bot key may make. Day windows are UTC days. */
export const BOT_LIMITS = { perMinute: 60, perDay: 2000 };

/** A key stops working this many days after it is made or rotated, at most. */
export const BOT_KEY_MAX_DAYS = 90;

/** How many bots one person may have, and how many may exist in total. */
export const BOT_CAPS = { perPerson: 2, total: 10 };

/** Every bot key starts with this, so a leaked one is easy to spot. */
export const BOT_SECRET_PREFIX = "vpb_";
