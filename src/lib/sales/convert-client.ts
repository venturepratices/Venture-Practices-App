import { dayLabel, endSentence, joinNames } from "@/lib/sales/format";
import type { ConvertTarget } from "@/lib/sales/lead-convert";
import type { LeadPanelData } from "@/lib/sales/lead-panel";
import type { TimelineEntry } from "@/lib/sales/timeline";

// Pure helpers for the lead panel and the convert dialogs (Mockup v2
// `#s=lead-open`, `#s=lead-converted`, `#s=lead-convert`,
// `#s=leads-bulk-convert`, `#s=lead-convert-taken`): every line they show,
// worked out from the data, with no React and no server code (the server
// modules are imported for their types only). Copy is Mockup v2's where it
// words a plan string differently (controller ruling P3A-X3). Days are read
// in app time.

/** How many lead titles a line names before it says "and {n} more". */
const TITLES_SHOWN = 5;

const NO_NEXT_STEP = "No next step. Call within 5 minutes of opt-in works best.";
const NO_PIPELINES = "No sales pipelines yet. Ask an admin to run the Sales setup.";

const leadCount = (n: number) => `${n} ${n === 1 ? "lead" : "leads"}`;

/** The dialog's title: one lead, or several (Mockup v2 "Convert leads to deals"). */
export function convertTitle(n: number): string {
  return n === 1 ? "Convert to deal" : "Convert leads to deals";
}

/** The leads a bulk convert takes, under its title: "A, B, C, D, E and 2 more". */
export function whyLine(titles: string[]): string {
  if (titles.length <= TITLES_SHOWN) return titles.join(", ");
  return `${titles.slice(0, TITLES_SHOWN).join(", ")} and ${titles.length - TITLES_SHOWN} more`;
}

/** The toast once leads became deals, naming the pipeline they are in now. */
export function convertToast(n: number, pipelineName: string): string {
  return n === 1
    ? endSentence(`Lead converted. Find it in ${pipelineName}`)
    : endSentence(`${n} leads converted. Find them in ${pipelineName}`);
}

/** The leads a bulk convert leaves alone because they have neither a person nor an organization; null when none. */
export function skippedLine(titles: string[]): string | null {
  if (titles.length === 0) return null;
  const stay = titles.length === 1 ? "It stays" : "They stay";
  return `${endSentence(`Add a person or an organization first: ${whyLine(titles)}`)} ${stay} in the inbox.`;
}

/** "Convert" for one lead; "Convert 3 leads" in bulk, counting only the leads it will take. */
export function convertButtonLabel(n: number, single: boolean): string {
  return single ? "Convert" : `Convert ${leadCount(n)}`;
}

/** "today", "yesterday", "tomorrow", else "Nov 2": the day as it sits inside a sentence. */
function dayWord(date: Date, now: Date): string {
  const label = dayLabel(date, now);
  return label === "Today" || label === "Yesterday" || label === "Tomorrow" ? label.toLowerCase() : label;
}

/** What a single convert carries over: the lead's open activities (soonest first), or the first call it adds. */
export function moveLine(openActivities: readonly { subject: string; dueAt: string }[], now: Date): string {
  if (openActivities.length === 0) return "It has no next step, so a first call is added for today. Notes move to the deal.";
  if (openActivities.length === 1) {
    const [only] = openActivities;
    return `Its next step moves to the deal: ${only.subject} (${dayWord(new Date(only.dueAt), now)}). Notes move too.`;
  }
  return `Its ${openActivities.length} open activities move to the deal. Notes move too.`;
}

/** Above the Total and Monthly boxes when the picked stage needs a price (spec rules 2 and 8). */
export function stagePriceLine(stageName: string): string {
  return `${stageName} needs a real price, so both values are required.`;
}

/** Why bulk convert does not list the pipeline's priced stages; null when it has none. */
export function pricedStagesNote(stageNames: string[]): string | null {
  if (stageNames.length === 0) return null;
  return `Stages that need a price (${joinNames(stageNames)}) are not offered here. Convert one lead at a time for those.`;
}

/** Under "This lead was already converted." (409): the deal it is now, when this person may open it. */
export function takenLine(dealTitle: string, pipelineName: string | null): string {
  const where = pipelineName ? `${dealTitle} in ${pipelineName}` : dealTitle;
  return `It is the deal ${where} now. Nothing was changed just now.`;
}

export type TargetsState =
  | { kind: "loading"; text: string }
  | { kind: "error"; text: string; action: string }
  | { kind: "empty"; text: string }
  | { kind: "ready" };

/**
 * The pipelines a convert may use: every stage the server offers, or in bulk
 * only those that need no price (bulk sends no values). A pipeline left with
 * no stage is dropped.
 */
export function usableTargets(targets: ConvertTarget[], bulk: boolean): ConvertTarget[] {
  if (!bulk) return targets.filter((target) => target.stages.length > 0);
  return targets.flatMap((target) => {
    const stages = target.stages.filter((stage) => !stage.requiresValue);
    return stages.length > 0 ? [{ ...target, stages }] : [];
  });
}

/** What the dialog says about its Pipeline and Stage lists while they load, fail, or hold nothing to pick. */
export function convertTargetsState(load: "loading" | "error" | { targets: ConvertTarget[] }): TargetsState {
  if (load === "loading") return { kind: "loading", text: "Loading pipelines…" };
  if (load === "error") return { kind: "error", text: "Could not load pipelines.", action: "Try again" };
  // A pipeline with no stage a lead may land on is as good as none (Task 8).
  return load.targets.some((target) => target.stages.length > 0) ? { kind: "ready" } : { kind: "empty", text: NO_PIPELINES };
}

export type LeadNotice = { tone: "info" | "warning"; text: string; action: "open-deal" | "restore" | "schedule" | null };

/**
 * The bar at the top of the lead panel's body: where a converted lead went
 * (with "Open deal" when this person may open it), an archived lead (with
 * "Restore" for its owner or an admin), or an open lead with no next step
 * (with "Schedule" for whoever may add one). Null when there is nothing to say.
 */
export function leadNotice(data: LeadPanelData): LeadNotice | null {
  const { lead } = data;
  if (lead.status === "CONVERTED") {
    return data.convertedDeal
      ? {
          tone: "info",
          text: `${endSentence(`Converted to ${data.convertedDeal.title}`)} Its activities and notes are on the deal now.`,
          action: "open-deal",
        }
      : { tone: "info", text: "Converted to a deal you cannot open.", action: null };
  }
  if (lead.status === "ARCHIVED") {
    return { tone: "info", text: "This lead is archived.", action: data.canRestore ? "restore" : null };
  }
  if (data.openActivities.length > 0) return null;
  return { tone: "warning", text: NO_NEXT_STEP, action: data.canEdit ? "schedule" : null };
}

/** The lock line on an open lead the viewer may only read (Mockup v2 `#s=lead-open&id=1&as=rep`). */
export function leadReadOnlyLine(ownerName: string): string {
  return `${ownerName} owns this lead. Only they or an admin can change it.`;
}

/** Under an open lead's name: "Open lead · came in yesterday". */
export function leadCameIn(createdAt: string, now: Date): string {
  return `Open lead · came in ${dayWord(new Date(createdAt), now)}`;
}

/**
 * History entries as the lead panel shows them: once a lead is converted or
 * archived its notes can no longer be edited (the server answers 409), so
 * they offer no Edit. An open lead's entries come back as they were.
 */
export function lockNotes(entries: TimelineEntry[], status: LeadPanelData["lead"]["status"]): TimelineEntry[] {
  if (status === "OPEN") return entries;
  return entries.map((entry) => (entry.note?.canEdit ? { ...entry, note: { ...entry.note, canEdit: false } } : entry));
}
