// What a bot key may do in Sales. Plain constants with no imports, so the Bots
// screen can load them in the browser. There is deliberately no scope for
// deleting, exporting or changing settings: a bot can never be given those.

export const BOT_SCOPES = ["read", "notes", "activities", "move", "create"] as const;
export type BotScope = (typeof BOT_SCOPES)[number];

export const BOT_ROLES = ["read", "helper", "rep"] as const;
export type BotRole = (typeof BOT_ROLES)[number];

export const BOT_ROLE_PRESETS: Record<BotRole, BotScope[]> = {
  read: ["read"],
  helper: ["read", "notes", "activities"],
  rep: ["read", "notes", "activities", "move", "create"],
};

/** Calls one bot key may make. Day windows are UTC days. */
export const BOT_LIMITS = { perMinute: 60, perDay: 2000 };

/** Every bot key starts with this, so a leaked one is easy to spot. */
export const BOT_SECRET_PREFIX = "vpb_";
