import { BULK_CONVERT_MAX, BULK_IDS_MAX } from "@/lib/sales/constants";
import { daysInStage, endSentence, joinNames, shortName } from "@/lib/sales/format";
import type { AssignmentSummary } from "@/lib/sales/lead-assignment";
import type { BulkLeadResult } from "@/lib/sales/lead-bulk";
import type { LeadRow } from "@/lib/sales/leads-page";
import { leadsQueryToSearch, type LeadsQuery } from "@/lib/sales/leads-query";

// Pure helpers for the Leads Inbox (no prisma, no server imports: the server
// modules above are read for their types only). Wording follows Mockup v2
// where it draws the same thing (ruling P3A-X3), else the plan's strings.

const LEADS_PATH = "/sales/leads";

/** Opens Add lead on the Inbox (the empty Inbox's action). */
export const NEW_LEAD_HREF = `${LEADS_PATH}?new=1`;

const SETTINGS_LINE = "Change it in Sales settings.";
const ASK_AN_ADMIN = "An admin can change this in Sales settings.";

/** "1 lead", "2 leads". */
function leadCount(n: number): string {
  return `${n} ${n === 1 ? "lead" : "leads"}`;
}

/** Who gets new leads, as a sentence without "Change it...": the footer and the settings card read it. */
function ruleSentence(summary: AssignmentSummary): string {
  const { names, fallbackName } = summary;
  if (names.length > 1) return endSentence(`New leads are shared out round-robin between ${joinNames(names)}`);
  if (names.length === 1) return endSentence(`New leads all go to ${names[0]}`);
  if (fallbackName) return `New leads go to ${fallbackName} until someone is picked.`;
  return "Nobody can take new leads yet.";
}

/**
 * Who gets new leads, ending in exactly one period whatever the last name
 * ends in ("...and Robert O."). Admins also read where to change it; others
 * cannot open Sales settings.
 */
export function assignmentLine(summary: AssignmentSummary, isAdmin: boolean): string {
  const sentence = ruleSentence(summary);
  return isAdmin ? `${sentence} ${SETTINGS_LINE}` : sentence;
}

/** The Inbox footer: `assignmentLine`, and for someone who is not an admin, who can change it (Mockup v2). */
export function inboxFooterLine(summary: AssignmentSummary, isAdmin: boolean): string {
  return isAdmin ? assignmentLine(summary, true) : `${assignmentLine(summary, false)} ${ASK_AN_ADMIN}`;
}

/** Add lead's line under Owner while "Share out automatically" is picked: the rule a new lead follows now. */
export function autoOwnerLine(summary: AssignmentSummary): string {
  const prefix = "Uses the rule in Sales settings";
  const { names, fallbackName } = summary;
  if (names.length > 1) return endSentence(`${prefix}: round-robin between ${joinNames(names)}`);
  if (names.length === 1) return endSentence(`${prefix}: always ${names[0]}`);
  if (fallbackName) return `${prefix}: ${fallbackName} for now.`;
  return `${prefix}.`;
}

/** Whole calendar days since the lead came in, in app time. */
export function leadAgeDays(createdAt: string, now: Date): number {
  return daysInStage(new Date(createdAt), now);
}

/** A lead older than two days gets the "{n}d old" pill. */
export function isOldLead(days: number): boolean {
  return days > 2;
}

/** The select-all box: how many of the shown leads one may tick are ticked. Ticks of leads not shown do not count. */
export function selectionState(selected: ReadonlySet<string>, rowIds: readonly string[]): "none" | "some" | "all" {
  const ticked = rowIds.filter((id) => selected.has(id)).length;
  if (ticked === 0) return "none";
  return ticked === rowIds.length ? "all" : "some";
}

/** The ticks that still name a shown lead: a lead that left the list (converted, archived, filtered out) is let go. */
export function pruneSelection(selected: ReadonlySet<string>, rowIds: readonly string[]): Set<string> {
  return new Set(rowIds.filter((id) => selected.has(id)));
}

type LeadsEmptyState = {
  title: string;
  /** None for a search that found nothing: that shows as one line with its action. */
  description: string | null;
  /** None where there is nothing more to show (someone who sees only their own leads). */
  action: { label: string; href: string } | null;
};

/** An Inbox URL for a query (no cursor). */
function leadsHref(query: LeadsQuery): string {
  const search = leadsQueryToSearch(query);
  return search ? `${LEADS_PATH}?${search}` : LEADS_PATH;
}

/**
 * What an empty Inbox says (Mockup v2). A search that found nothing wins and
 * offers to clear it (keeping Just me). Just me offers everyone's, but only to
 * someone who may see them; for someone who sees only their own leads, the
 * Inbox is always theirs. Otherwise the Inbox is truly empty.
 */
export function leadsEmptyState(query: LeadsQuery, canSeeEveryone: boolean): LeadsEmptyState {
  if (query.q) {
    return {
      title: `No leads match "${query.q}".`,
      description: null,
      action: { label: "Clear search", href: leadsHref({ ...query, q: "", cursor: null }) },
    };
  }
  if (!canSeeEveryone || query.scope === "mine") {
    return {
      title: "No leads of yours right now.",
      description: "New leads that come to you will show up here.",
      action: canSeeEveryone ? { label: "Show everyone's leads", href: leadsHref({ scope: "everyone", q: "", cursor: null }) } : null,
    };
  }
  return {
    title: "Inbox zero.",
    description: "New Check Availability opt-ins will show up here. Add one by hand if a lead calls in.",
    action: { label: "Add a lead", href: NEW_LEAD_HREF },
  };
}

/** The toast after a bulk action changed `n` leads (Mockup v2). `ownerName` is the new owner's short name. */
export function bulkToast(action: "assign" | "archive" | "restore" | "delete", n: number, ownerName?: string): string {
  switch (action) {
    case "assign":
      return endSentence(`${leadCount(n)} assigned to ${ownerName ?? "someone else"}`);
    case "archive":
      return `${leadCount(n)} archived.`;
    case "restore":
      return `${leadCount(n)} restored.`;
    case "delete":
      return `${leadCount(n)} deleted.`;
  }
}

/** How many of a bulk action's leads were refused, with the first reason; null when none was. */
export function bulkFailureLine(results: BulkLeadResult[]): string | null {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return null;
  const first = failed[0];
  const reason = first.ok ? "" : ` ${first.error}`;
  return `${failed.length} of ${results.length} could not be changed.${reason}`;
}

/** The bulk bar's note once too many leads are ticked: past 100 nothing but Clear works, past 25 Convert does not. */
export function bulkLimitNote(count: number, canConvert: boolean): string | null {
  if (count > BULK_IDS_MAX) return `Pick ${BULK_IDS_MAX} leads or fewer at a time. Untick some to go on.`;
  if (canConvert && count > BULK_CONVERT_MAX) {
    return `Convert works on up to ${BULK_CONVERT_MAX} leads at a time. Untick some to convert them.`;
  }
  return null;
}

/** Leads the delete confirm names before "and {n} more". */
const DELETE_NAMES_SHOWN = 5;

/** The admin delete confirm (Mockup v2): its title, the leads it names, what it does and its button. */
export function deleteLeadsCopy(titles: readonly string[]): { title: string; names: string; text: string; confirm: string } {
  const n = titles.length;
  const shown = titles.slice(0, DELETE_NAMES_SHOWN);
  const rest = n - shown.length;
  return {
    title: n === 1 ? "Delete this lead?" : `Delete ${n} leads?`,
    names: rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", "),
    text: `${n === 1 ? "It leaves" : "They leave"} the Leads Inbox for good. The history keeps a record. This cannot be undone.`,
    confirm: n === 1 ? "Delete lead" : `Delete ${n} leads`,
  };
}

/** The toast after Add lead; it names the owner when the lead went to someone else by name. */
export function newLeadToast(otherOwnerName: string | null): string {
  const added = "Lead added with its first activity.";
  return otherOwnerName ? `${added} ${endSentence(`It went to ${otherOwnerName}`)}` : added;
}

/** The assign menu's heading. */
export function assignMenuLabel(n: number): string {
  return n === 1 ? "Give this lead to" : `Give ${n} leads to`;
}

/** The line under the assign menu's people: what moves with the leads, or why nobody can be picked. */
export function assignNote(notMine: number): string {
  if (notMine === 0) return "Their open activities move to the new owner too.";
  return `You can only give away leads you own. ${notMine} of these ${notMine === 1 ? "is" : "are"} someone else's.`;
}

type AssignChoice = { id: string; label: string; ownerNow: boolean; disabled: boolean };

/**
 * The assign menu's people (Mockup v2): short names, "(you)" for the viewer,
 * and "Owner now" (not pickable) for the one who already owns every ticked
 * lead. Someone who is not an admin may give away only their own leads, so a
 * ticked lead of someone else's turns every choice off (`notMine` says how many).
 */
export function assignChoices(
  members: readonly { id: string; name: string }[],
  ownerIds: readonly string[],
  viewer: { userId: string; isAdmin: boolean },
): { notMine: number; choices: AssignChoice[] } {
  const notMine = viewer.isAdmin ? 0 : ownerIds.filter((id) => id !== viewer.userId).length;
  const choices = members.map((member) => {
    const ownerNow = ownerIds.length > 0 && ownerIds.every((id) => id === member.id);
    const label = member.id === viewer.userId ? `${shortName(member.name)} (you)` : shortName(member.name);
    return { id: member.id, label, ownerNow, disabled: ownerNow || notMine > 0 };
  });
  return { notMine, choices };
}

/**
 * The grey line under a lead's title (Mockup v2): its person (unless the lead
 * is named after them) and ZIP, and what it is missing. Null when there is
 * nothing to say.
 */
export function leadSubLine(row: Pick<LeadRow, "title" | "personName" | "organizationName" | "zip">): string | null {
  const parts: string[] = [];
  if (row.personName && row.personName !== row.title) parts.push(row.personName);
  if (row.zip) parts.push(`ZIP ${row.zip}`);
  if (!row.personName && !row.organizationName) parts.push("No person or organization yet");
  else if (!row.organizationName) parts.push("No organization yet");
  return parts.length > 0 ? parts.join(" · ") : null;
}
