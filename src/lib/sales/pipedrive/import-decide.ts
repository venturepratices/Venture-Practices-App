// The Pipedrive import's decisions, kept pure so each is tested directly: who
// owns a row, what changed, which app row a Pipedrive link points at, where a
// new stage goes, and how a custom field value is stored. No Prisma, no network.

import { DEFAULT_ROTTING_DAYS, ROTTING_DAYS_MAX, TITLE_MAX } from "@/lib/sales/constants";
import { emailKey, nameKey } from "@/lib/sales/contact-keys";
import type { FieldLink, ImportContext } from "@/lib/sales/pipedrive/import-state";
import { kebab } from "@/lib/sales/seed-data";

// --- Owners ---

export type UserMatch = {
  pipedriveUserId: number;
  name: string;
  email: string | null;
  memberId: string | null;
  memberName: string | null;
  /** True when the match came from the email, false for a saved choice (or no match). */
  auto: boolean;
};

/**
 * Which team member each Pipedrive user becomes. A saved choice wins, as long as
 * that member can still own Sales records (is in `members`); otherwise the same
 * email (any case) matches. Anyone else is unmatched (null), and their records
 * go to the person who started the run.
 */
export function matchPipedriveUsers(
  pdUsers: { id: number; name?: string | null; email?: string | null }[],
  members: { id: string; name: string; email: string }[],
  overrides: { pipedriveUserId: number; memberId: string }[],
): UserMatch[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const byEmail = new Map(members.map((m) => [emailKey(m.email), m]));
  const saved = new Map(overrides.map((o) => [o.pipedriveUserId, o.memberId]));
  return pdUsers.map((user) => {
    const email = user.email?.trim() || null;
    const name = user.name?.trim() || `Pipedrive user ${user.id}`;
    const chosen = byId.get(saved.get(user.id) ?? "");
    if (chosen) return { pipedriveUserId: user.id, name, email, memberId: chosen.id, memberName: chosen.name, auto: false };
    const found = email === null ? undefined : byEmail.get(emailKey(email));
    return {
      pipedriveUserId: user.id,
      name,
      email,
      memberId: found?.id ?? null,
      memberName: found?.name ?? null,
      auto: found !== undefined,
    };
  });
}

/** The team member who owns (or wrote) a row: the matched one, else the person who started the run, with an issue. */
export function resolveOwner(
  pipedriveUserId: number | null,
  owners: Map<number, string>,
  starterId: string,
  role: "owner" | "author",
): { memberId: string; issue: string | null } {
  const found = pipedriveUserId === null ? undefined : owners.get(pipedriveUserId);
  if (found) return { memberId: found, issue: null };
  if (role === "author") {
    return {
      memberId: starterId,
      issue: "The author in Pipedrive matches no team member, so the person who started the import is shown as the author.",
    };
  }
  return {
    memberId: starterId,
    issue:
      pipedriveUserId === null
        ? "The record had no owner in Pipedrive, so the person who started the import owns it."
        : "The owner in Pipedrive matches no team member, so the person who started the import owns it.",
  };
}

// --- Comparing and linking ---

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

/** The values in `after` that differ from `before`. Dates compare by time; null and missing are the same. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => !sameValue(before[key], value)));
}

/**
 * `changed` without the dates this run could only guess. The mappers use the
 * import date (`fallback`) for a date Pipedrive left out, and each run has its
 * own import date, so without this every re-run would "update" those rows. A
 * guess replaces nothing that is already stored; it is only written when the
 * row has no date there yet.
 */
export function keepGuessedValues(
  changed: Record<string, unknown>,
  existing: Record<string, unknown>,
  fallback: Date,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(changed).filter(
      ([key, value]) => !(value instanceof Date && value.getTime() === fallback.getTime() && existing[key] instanceof Date),
    ),
  );
}

/** The app id for a Pipedrive link. A link to a record that was not copied is dropped with `missingIssue`. */
export function resolveLink(
  pipedriveId: number | string | null,
  found: Map<number | string, string>,
  missingIssue: string,
): { id: string | null; issue: string | null } {
  if (pipedriveId === null) return { id: null, issue: null };
  const id = found.get(pipedriveId);
  return id ? { id, issue: null } : { id: null, issue: missingIssue };
}

/**
 * Where an activity goes. The app keeps an activity on a deal, a lead or a
 * person, never on an organization alone, so one that is only on an
 * organization goes to that organization's first person (`org` is null when
 * there is no organization link). With nothing to go on, it is skipped.
 */
export function activityTarget(
  links: { dealId: string | null; leadId: string | null; personId: string | null },
  org: { firstPersonId: string | null } | null,
): { personId: string | null; issue: string | null } | { skip: string } {
  if (links.dealId || links.leadId || links.personId) return { personId: links.personId, issue: null };
  if (org?.firstPersonId) {
    return {
      personId: org.firstPersonId,
      issue: "The activity was only on an organization, so it was put on that organization's first person.",
    };
  }
  if (org) return { skip: "The activity was only on an organization with no people, so it was not copied." };
  return { skip: "The activity was not on a deal, lead or person that was copied, so it was not copied." };
}

/**
 * The app stage and pipeline of a deal: its own stage when the structure step
 * matched or made it (a won or lost deal keeps its stage too), else the first
 * stage of its pipeline with an issue. `live` is false in a practice run, where
 * stages that would be created have no id yet.
 */
export function resolveDealStage(
  stagePipedriveId: number | null,
  pipelinePipedriveId: number | null,
  ctx: ImportContext,
  live: boolean,
): { stageId: string | null; pipelineId: string | null; issue: string | null } | { skip: string } {
  const stage = stagePipedriveId === null ? undefined : ctx.stages[String(stagePipedriveId)];
  if (stage && (stage.stageId || !live)) return { stageId: stage.stageId, pipelineId: stage.pipelineId, issue: null };
  const pipeline = pipelinePipedriveId === null ? undefined : ctx.pipelines[String(pipelinePipedriveId)];
  if (!pipeline) return { skip: "The deal's stage and pipeline were not found in Pipedrive's lists, so it was not copied." };
  if (live && !pipeline.firstStageId) return { skip: "The deal's pipeline has no stages in the app, so it was not copied." };
  return {
    stageId: pipeline.firstStageId,
    pipelineId: pipeline.pipelineId,
    issue: "The deal's stage was not found in Pipedrive's stage list, so it was put in the first stage of its pipeline.",
  };
}

// --- Structure ---

/** `base`, or `base-2`, `base-3`... when taken; `fallback` when `base` is empty. Adds the result to `taken`. */
export function uniqueKey(base: string, taken: Set<string>, fallback: string): string {
  const root = base || fallback;
  let key = root;
  for (let n = 2; taken.has(key); n++) key = `${root}-${n}`;
  taken.add(key);
  return key;
}

export type AppStageLite = {
  id: string;
  key: string;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  archivedAt: Date | null;
};

export type PipedriveStage = {
  id: number;
  name?: string | null;
  order_nr?: number | null;
  deal_probability?: number | null;
  is_deal_rot_enabled?: boolean | null;
  days_to_rotten?: number | null;
  pipeline_id?: number | null;
  is_deleted?: boolean | null;
};

export type StageCreate = {
  pipedriveId: number;
  key: string;
  name: string;
  position: number;
  probability: number;
  rottingDays: number;
};

/**
 * How one pipeline's Pipedrive stages land in the app. A stage matches an app
 * stage of the same pipeline by name key. Each one with no match is created in
 * Pipedrive's order at the end of the open stages, before the won and lost
 * ones; `shiftFrom` is the position from which the app's stages move down to
 * make room (null when nothing has to move).
 */
export function planStages(
  appStages: AppStageLite[],
  pdStages: PipedriveStage[],
): { matched: Record<string, string>; creates: StageCreate[]; shiftFrom: number | null } {
  const active = appStages.filter((s) => s.archivedAt === null);
  const taken = new Set(appStages.map((s) => s.key));
  const closing = active.filter((s) => s.isWon || s.isLost).map((s) => s.position);
  const insertAt = closing.length > 0 ? Math.min(...closing) : Math.max(0, ...active.map((s) => s.position)) + 1;

  const matched: Record<string, string> = {};
  const creates: StageCreate[] = [];
  const ordered = [...pdStages].sort((a, b) => (a.order_nr ?? 0) - (b.order_nr ?? 0) || a.id - b.id);
  for (const stage of ordered) {
    const name = (stage.name?.trim() || "Unnamed stage").slice(0, TITLE_MAX);
    const key = nameKey(name);
    const match = key === null ? undefined : active.find((s) => nameKey(s.name) === key);
    if (match) {
      matched[String(stage.id)] = match.id;
      continue;
    }
    const days = stage.days_to_rotten;
    const rottingDays =
      stage.is_deal_rot_enabled === true && typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= ROTTING_DAYS_MAX
        ? days
        : DEFAULT_ROTTING_DAYS;
    creates.push({
      pipedriveId: stage.id,
      key: uniqueKey(kebab(name), taken, "stage"),
      name,
      position: insertAt + creates.length,
      probability: Math.min(100, Math.max(0, Math.round(Number(stage.deal_probability) || 0))),
      rottingDays,
    });
  }
  const shiftFrom = creates.length > 0 && appStages.some((s) => s.position >= insertAt) ? insertAt : null;
  return { matched, creates, shiftFrom };
}

// --- Custom fields ---

/** The app field type for a new field made from a Pipedrive one: a number, a date, a single option, else text. */
export function appFieldType(pipedriveType: string | null | undefined): "TEXT" | "NUMBER" | "DATE" | "SELECT" {
  if (pipedriveType === "double" || pipedriveType === "monetary") return "NUMBER";
  if (pipedriveType === "date") return "DATE";
  if (pipedriveType === "enum") return "SELECT";
  return "TEXT";
}

/** A field's choices as id to label, from Pipedrive's `[{ id, label }]`. Null when there is no list. */
export function optionLabels(options: unknown): Record<string, string> | null {
  if (!Array.isArray(options)) return null;
  const labels: Record<string, string> = {};
  for (const option of options) {
    const o = option as { id?: unknown; label?: unknown } | null;
    if (!o || (typeof o.id !== "number" && typeof o.id !== "string")) continue;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (label !== "") labels[String(o.id)] = label;
  }
  return labels;
}

/**
 * A custom field value as the app stores it. For a field with choices the
 * mapper hands over option ids ("1" or "1, 2"); each becomes its label (joined
 * with ", "), and an id Pipedrive no longer lists is dropped with an issue.
 */
export function convertCustomValue(raw: string, field: FieldLink): { value: string | null; issue: string | null } {
  if (field.options === null) return { value: raw, issue: null };
  const labels: string[] = [];
  let unknown = false;
  for (const id of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    const label = field.options[id];
    if (label === undefined) unknown = true;
    else labels.push(label);
  }
  return {
    value: labels.length > 0 ? labels.join(", ") : null,
    issue: unknown ? `A choice in the Pipedrive field "${field.name}" no longer exists in Pipedrive, so it was not copied.` : null,
  };
}

/** True when Pipedrive's due time is exactly midnight ("00:00" or "00:00:00"). */
export function isMidnightDueTime(dueTime: unknown): boolean {
  return typeof dueTime === "string" && /^00:00(:00)?$/.test(dueTime.trim());
}
