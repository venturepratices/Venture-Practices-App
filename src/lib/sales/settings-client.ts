import { ROTTING_DAYS_MAX } from "@/lib/sales/constants";
import { joinNames, shortName } from "@/lib/sales/format";
import type { LeadAssignmentView, SavedPersonView, StageSettings } from "@/lib/sales/settings";

// Pure helpers for the Sales settings screen (Task 25). No prisma, no server
// imports; client-safe (the server module settings.ts is read for its types
// only). Wording follows Mockup v2 where it draws the same thing, else the
// plan's pinned strings.

const ROTTING_ERROR = `Use a number from 1 to ${ROTTING_DAYS_MAX}, or leave it blank.`;
const SINGLE_MISSING = "Choose the person who gets every new lead.";
const SINGLE_LOST_ACCESS = "The person who gets every new lead no longer has Sales access. Pick someone else.";
const FORMER_TEAM_MEMBER = "A former team member";

/** The eight rules shown on the "Rules (always on)" card, in order, from Mockup v2. */
export const SALES_RULES: readonly string[] = [
  'Every open deal and lead needs a next activity. If it has none, it shows a "No next step" badge.',
  "A deal cannot go to Proposal Sent with a $0 value.",
  "At Proposal Sent, both total value and monthly value are required.",
  "Every deal and lead has an owner.",
  "A territory hold check is added 7 days before the hold ends.",
  "Moving a deal to No Show adds a reschedule call for today.",
  "The history log cannot be edited or deleted, by anyone.",
  "Files are for final versions only (signed contracts, final proposals).",
] as const;

/** The editable draft of the "Who gets new leads" card (the radios, the ticked rotation, the single person). */
export type AssignmentDraft = {
  mode: "ROUND_ROBIN" | "SINGLE";
  /** The ids ticked on the rotation, in the saved order (people without Sales access stay here while the user draws). */
  rotation: string[];
  /** The id of the person who gets every new lead when `mode` is SINGLE, or null. */
  single: string | null;
};

/** The starting draft for the save bar (reset on load and after a real save). */
export function draftFromView(view: LeadAssignmentView): AssignmentDraft {
  return {
    mode: view.mode,
    rotation: view.rotation.map((person) => person.id),
    single: view.single ? view.single.id : null,
  };
}

/**
 * What a real save sends. Returns null when nothing has changed from the saved
 * view. The rotation list is cleaned of anyone who lost Sales access so they
 * drop on Save (the body carries only ids with access).
 */
export function settingsPatch(
  draft: AssignmentDraft,
  view: LeadAssignmentView,
): { leadAssignMode?: "ROUND_ROBIN" | "SINGLE"; roundRobinMemberIds?: string[]; singleAssigneeId?: string | null } | null {
  const hasAccess = new Set(view.members.map((member) => member.id));
  const cleanedRotation = draft.rotation.filter((id) => hasAccess.has(id));
  const savedRotation = view.rotation.filter((person) => person.hasAccess).map((person) => person.id);
  const savedSingle = view.single ? view.single.id : null;

  const patch: {
    leadAssignMode?: "ROUND_ROBIN" | "SINGLE";
    roundRobinMemberIds?: string[];
    singleAssigneeId?: string | null;
  } = {};

  if (draft.mode !== view.mode) patch.leadAssignMode = draft.mode;

  const rotationChanged =
    cleanedRotation.length !== savedRotation.length ||
    cleanedRotation.some((id, index) => id !== savedRotation[index]);
  if (rotationChanged) patch.roundRobinMemberIds = cleanedRotation;

  if (draft.single !== savedSingle) patch.singleAssigneeId = draft.single;

  return Object.keys(patch).length === 0 ? null : patch;
}

/** The inline refusal under the single-person select: null when the draft is fine to send. */
export function assignmentError(draft: AssignmentDraft, view: LeadAssignmentView): string | null {
  if (draft.mode !== "SINGLE") return null;
  if (!draft.single) return SINGLE_MISSING;
  const hasAccess = new Set(view.members.map((member) => member.id));
  if (!hasAccess.has(draft.single)) return SINGLE_LOST_ACCESS;
  return null;
}

/** "Ben E." or, when the name is gone, "A former team member" (Decision 28 wording). */
export function personLabel(person: Pick<SavedPersonView, "id" | "name" | "hasAccess">): string {
  return person.name ? shortName(person.name) : FORMER_TEAM_MEMBER;
}

/** "{Short} no longer has Sales access.": the start of the lost-access bar. */
function lostAccessPrefix(person: Pick<SavedPersonView, "id" | "name">): string {
  return `${person.name ? shortName(person.name) : FORMER_TEAM_MEMBER} no longer has Sales access.`;
}

/** What comes after "{name} no longer has Sales access." when the saved single person lost it. */
function fallbackClause(view: LeadAssignmentView): string {
  const { effective } = view;
  // Round-robin with names: shared out round-robin.
  if (effective.mode === "ROUND_ROBIN" && effective.names.length > 0) {
    return "New leads are shared out round-robin until you pick someone else.";
  }
  if (effective.fallbackName) {
    return `New leads go to ${effective.fallbackName} until you pick someone else.`;
  }
  return "Nobody can take new leads until you pick someone else.";
}

/**
 * The warn bar that opens when the SAVED single person has lost Sales access:
 * names them, and says who gets new leads instead (the real fallback,
 * `LeadAssignmentView.effective`). Returns null when there is no lost-access
 * story to tell (the single person still has access, or mode is ROUND_ROBIN).
 */
export function lostAccessBar(view: LeadAssignmentView): string | null {
  if (view.mode !== "SINGLE" || !view.single || view.single.hasAccess) return null;
  return `${lostAccessPrefix(view.single)} ${fallbackClause(view)}`;
}

/** The line under the rotation when some ticked people have lost Sales access; null when every one has it. */
export function lostRotationLine(rotation: readonly SavedPersonView[]): string | null {
  const lost = rotation.filter((person) => !person.hasAccess);
  if (lost.length === 0) return null;
  const names = lost.map(personLabel);
  const list = joinNames(names);
  if (lost.length === 1) {
    return `${list} no longer has Sales access and is skipped. Saving takes ${list} off this list.`;
  }
  return `${list} no longer have Sales access and are skipped. Saving takes them off this list.`;
}

/** The line under the rotation when the draft has nobody ticked (round-robin with nobody eligible). A8 names the admin. */
export function nobodyTickedLine(firstAdminName: string | null): string {
  if (firstAdminName) return `Nobody is ticked. New leads go to ${firstAdminName} until someone is picked.`;
  return "Nobody is ticked. Nobody can take new leads until someone is picked.";
}

/** Reads what a person typed into a "Goes stale after" box; blank (null) means never. */
export function rottingDaysInput(text: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: ROTTING_ERROR };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > ROTTING_DAYS_MAX) return { ok: false, error: ROTTING_ERROR };
  return { ok: true, value: n };
}

/**
 * What the "Edit stages" save sends: every stage whose number really changed,
 * in the order they appear in the pipeline. Won and lost stages are never sent.
 * A bad number refuses the save with a per-row error map.
 */
export function stageRottingPatch(
  stages: StageSettings["stages"],
  inputs: Record<string, string>,
): { ok: true; stages: { id: string; rottingDays: number | null }[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const changes: { id: string; rottingDays: number | null }[] = [];
  for (const stage of stages) {
    if (stage.isWon || stage.isLost) continue;
    const typed = inputs[stage.id];
    if (typed === undefined) continue;
    const parsed = rottingDaysInput(typed);
    if (!parsed.ok) {
      errors[stage.id] = parsed.error;
      continue;
    }
    if (parsed.value !== stage.rottingDays) changes.push({ id: stage.id, rottingDays: parsed.value });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, stages: changes };
}

/** The toast after a stage save: nothing changed, one stage changed, or n stages changed. */
export function stageSaveToast(changed: number): string {
  if (changed === 0) return "No changes to save.";
  if (changed === 1) return "Saved. 1 stage changed.";
  return `Saved. ${changed} stages changed.`;
}

/** The small line under a pipeline name on the "Pipelines and stages" card: "Sales · 9 stages". */
export function pipelineLine(pipeline: StageSettings): string {
  const kind = pipeline.kind === "SALES" ? "Sales" : "Consulting";
  return `${kind} · ${pipeline.stages.length} stages`;
}
