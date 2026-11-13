import {
  BOT_KEY_MAX_DAYS,
  BOT_ROLE_OPTIONS,
  BOT_SCOPE_AREAS,
  BOT_SCOPE_LIST,
  BOT_SCOPES,
  type BotRole,
  type BotScope,
  type BotScopeInfo,
} from "@/lib/sales/bot-scopes";

// The bot form's rules (create and edit), as pure functions: role presets,
// the permission checklist, what is missing, and the request bodies.

export type BotDraft = {
  name: string;
  actingForId: string;
  role: BotRole | "custom";
  scopes: BotScope[];
  allPipelines: boolean;
  pipelineKeys: string[];
  ownDealsOnly: boolean;
  expiresInDays: number;
};

type DraftSource = { name: string; actingFor: { id: string }; scopes: string[]; allPipelines: boolean; pipelineKeys: string[]; ownDealsOnly: boolean };

const ordered = (scopes: readonly string[]) => BOT_SCOPES.filter((s) => scopes.includes(s));
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function roleFor(scopes: readonly string[]): BotRole | "custom" {
  return BOT_ROLE_OPTIONS.find((r) => sameList(r.scopes, ordered(scopes)))?.key ?? "custom";
}

export function emptyDraft(): BotDraft {
  return {
    name: "",
    actingForId: "",
    role: "read",
    scopes: ["read"],
    allPipelines: false,
    pipelineKeys: [],
    ownDealsOnly: true,
    expiresInDays: BOT_KEY_MAX_DAYS,
  };
}

export function draftFromBot(bot: DraftSource): BotDraft {
  const scopes = ordered(bot.scopes);
  return {
    name: bot.name,
    actingForId: bot.actingFor.id,
    role: roleFor(scopes),
    scopes,
    allPipelines: bot.allPipelines,
    pipelineKeys: [...bot.pipelineKeys],
    ownDealsOnly: bot.ownDealsOnly,
    expiresInDays: BOT_KEY_MAX_DAYS,
  };
}

export function pickRole(draft: BotDraft, role: BotRole): BotDraft {
  const preset = BOT_ROLE_OPTIONS.find((r) => r.key === role)!;
  return { ...draft, role, scopes: [...preset.scopes] };
}

/** Ticks or unticks one permission; the role follows (a preset when the list matches one, else Custom). */
export function toggleScope(draft: BotDraft, scope: BotScope): BotDraft {
  const has = draft.scopes.includes(scope);
  const scopes = ordered(has ? draft.scopes.filter((s) => s !== scope) : [...draft.scopes, scope]);
  return { ...draft, scopes, role: roleFor(scopes) };
}

export function draftError(draft: BotDraft): string | null {
  if (!draft.name.trim()) return "Give the bot a name.";
  if (!draft.actingForId) return "Pick who the bot works for.";
  if (draft.scopes.length === 0) return "Tick at least one permission.";
  if (!draft.allPipelines && draft.pipelineKeys.length === 0) return "Pick at least one pipeline, or all pipelines.";
  return null;
}

const access = (draft: BotDraft) => (draft.role === "custom" ? { scopes: draft.scopes } : { role: draft.role });

export function createBody(draft: BotDraft, password: string) {
  return {
    name: draft.name.trim(),
    actingForId: draft.actingForId,
    ...access(draft),
    allPipelines: draft.allPipelines,
    pipelineKeys: draft.allPipelines ? [] : draft.pipelineKeys,
    ownDealsOnly: draft.ownDealsOnly,
    expiresInDays: draft.expiresInDays,
    password,
  };
}

/** Only the fields that changed, or null when nothing did. Name and person are fixed after create. */
export function updateBody(draft: BotDraft, bot: DraftSource): Record<string, unknown> | null {
  const before = draftFromBot(bot);
  const body: Record<string, unknown> = {};
  if (!sameList(draft.scopes, before.scopes)) Object.assign(body, access(draft));
  if (draft.allPipelines !== before.allPipelines) body.allPipelines = draft.allPipelines;
  if (!draft.allPipelines && !sameList(draft.pipelineKeys, before.pipelineKeys)) body.pipelineKeys = draft.pipelineKeys;
  if (draft.ownDealsOnly !== before.ownDealsOnly) body.ownDealsOnly = draft.ownDealsOnly;
  return Object.keys(body).length ? body : null;
}

export function scopesByArea(): { key: string; label: string; scopes: BotScopeInfo[] }[] {
  return BOT_SCOPE_AREAS.map((area) => ({ key: area.key, label: area.label, scopes: BOT_SCOPE_LIST.filter((s) => s.area === area.key) }));
}

export function copyMessage(ok: boolean): string {
  return ok
    ? "Copied. Paste it straight into the bot's secret store."
    : "Copy did not work here. The key is selected: press Ctrl+C (or Cmd+C), or long-press and Copy.";
}
