import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { ACTIVITY_TYPE_LABELS, TIMELINE_PAGE_SIZE } from "@/lib/sales/constants";
import { visibleDealWhere } from "@/lib/sales/deal-access";
import { formatMoney, shortName } from "@/lib/sales/format";
import { formatDate } from "@/lib/utils";

// The deal panel's History: the locked history rows written against a deal
// (deal-audit.ts), newest first, each turned into one plain line that names
// who did it. Pages of 30 with a "Show older" cursor (spec 7.8). The rows are
// stored JSON, so every payload is read defensively: an unexpected shape gives
// a vaguer line, never an error.

type TimelineDb = Pick<typeof prisma, "salesDeal" | "salesAuditLog" | "teamMember" | "salesNote">;

export type TimelineIcon =
  | "created"
  | "stage"
  | "won"
  | "lost"
  | "reopened"
  | "value"
  | "owner"
  | "field"
  | "deleted"
  | "activity"
  | "done"
  | "missed"
  | "note";

export type TimelineEntry = {
  id: string;
  at: string;
  actorType: "USER" | "BOT" | "SYSTEM" | "WEBHOOK";
  /** First name and last initial; null for a rule or webhook, or someone no longer on the team. */
  actorName: string | null;
  icon: TimelineIcon;
  text: string;
  /** On "Note added" lines while the note still exists: its current text, and whether this person may edit it. */
  note?: { id: string; body: string; canEdit: boolean };
};

export type TimelineCursor = { at: string; id: string };

type Payload = Record<string, unknown>;

function payload(value: unknown): Payload {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : {};
}

/** A non-empty string at `key`, else null. */
function str(p: Payload, key: string): string | null {
  const value = p[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function cents(p: Payload, key: string): number {
  const value = p[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Who made an activity when a rule did, as the History line names it. */
const RULE_NAMES: Record<string, string> = {
  "rule:no-show": "the No Show rule",
  "rule:territory-hold": "the territory hold rule",
};

function activityTypeLabel(p: Payload): string {
  const type = str(p, "type");
  return type && type in ACTIVITY_TYPE_LABELS ? ACTIVITY_TYPE_LABELS[type as SalesActivityType] : "Activity";
}

/** "Call done: First call", or "Call done" when the subject is missing. */
function activityLine(p: Payload, verb: string): string {
  const subject = str(p, "subject");
  return `${activityTypeLabel(p)} ${verb}${subject ? `: ${subject}` : ""}`;
}

/** "Call scheduled: First call (Nov 6)", or "Call added by the No Show rule: ..." for a rule's activity. */
function activityAddedLine(p: Payload): string {
  const createdBy = str(p, "createdBy");
  const rule = createdBy?.startsWith("rule:") ? (RULE_NAMES[createdBy] ?? "a rule") : null;
  const subject = str(p, "subject");
  const dueAt = str(p, "dueAt");
  const due = dueAt && !Number.isNaN(Date.parse(dueAt)) ? formatDate(dueAt, { month: "short", day: "numeric" }) : null;
  const head = rule ? `${activityTypeLabel(p)} added by ${rule}` : `${activityTypeLabel(p)} scheduled`;
  return `${head}${subject ? `: ${subject}` : ""}${due ? ` (${due})` : ""}`;
}

/** "Renamed to ..." and/or "Source set to ...", for the keys that changed. */
function updatedLine(after: Payload): string {
  const parts: string[] = [];
  const title = str(after, "title");
  if (title) parts.push(`Renamed to ${title}`);
  if ("source" in after) {
    const source = str(after, "source");
    parts.push(source ? `Source set to ${source}` : "Source cleared");
  }
  return parts.length > 0 ? parts.join(". ") : "Deal updated";
}

const FALLBACK = { icon: "field", text: "Deal updated" } as const;

/**
 * One History line for a stored history row. `names` maps team member ids to
 * full names (for "Owner changed to Ben S."). No line uses an em dash.
 */
export function describeAuditRow(
  row: { action: string; actorType: string; before: unknown; after: unknown },
  names: Map<string, string>,
): { icon: TimelineIcon; text: string } {
  const after = payload(row.after);
  const before = payload(row.before);

  switch (row.action) {
    case "created":
      return { icon: "created", text: "Deal created" };
    case "stage_changed": {
      const stageName = str(after, "stageName");
      const moved = stageName ? `Moved to ${stageName}` : "Moved to another stage";
      // The only rule that moves deals is the No Show rule.
      return { icon: "stage", text: row.actorType === "SYSTEM" ? `${moved} (No Show rule)` : moved };
    }
    case "status_changed": {
      const status = str(after, "status");
      if (status === "WON") return { icon: "won", text: "Marked as won" };
      if (status === "LOST") {
        // The comment typed into the Lost dialog follows the reason: "Marked as lost: Price. Went with a cheaper printer".
        const reason = str(after, "lostReason");
        const comment = str(after, "lostComment");
        const line = reason ? `Marked as lost: ${reason}` : "Marked as lost";
        return { icon: "lost", text: comment ? `${line}. ${comment}` : line };
      }
      if (status === "OPEN") return { icon: "reopened", text: "Reopened" };
      return FALLBACK;
    }
    case "value_changed": {
      const mrr = cents(after, "mrrCents");
      const monthly = mrr > 0 ? ` (${formatMoney(mrr)}/mo)` : "";
      return { icon: "value", text: `Value set to ${formatMoney(cents(after, "valueCents"))}${monthly}` };
    }
    case "owner_changed": {
      const ownerId = str(after, "ownerId");
      const name = ownerId ? names.get(ownerId) : undefined;
      return { icon: "owner", text: name ? `Owner changed to ${shortName(name)}` : "Owner changed" };
    }
    case "updated":
      return { icon: "field", text: updatedLine(after) };
    case "field_changed": {
      const label = str(after, "label") ?? "A field";
      const value = str(after, "value");
      return { icon: "field", text: value ? `${label} set to ${value}` : `${label} cleared` };
    }
    case "archived":
      return { icon: "deleted", text: "Deal deleted" };
    case "delete_refused":
      return { icon: "deleted", text: "Tried to delete this deal (refused)" };
    case "activity_added":
      return { icon: "activity", text: activityAddedLine(after) };
    case "activity_done":
      return { icon: "done", text: activityLine(after, "done") };
    case "activity_reopened":
      return { icon: "activity", text: activityLine(after, "reopened") };
    case "activity_missed":
      return { icon: "missed", text: activityLine(after, "missed") };
    case "activity_removed":
      return { icon: "activity", text: activityLine(before, "removed") };
    case "note_added":
      return { icon: "note", text: "Note added" };
    case "note_edited":
      return { icon: "note", text: "Note edited" };
    default:
      return FALLBACK;
  }
}

/**
 * One page of a deal's History, newest first, continuing after `cursor`. Null
 * when this person may not see the deal (the route answers 404). Names come
 * from one team-member lookup, note text from one note lookup.
 */
export async function loadDealTimeline(
  actor: SalesActor,
  dealId: string,
  cursor: TimelineCursor | null,
  db: TimelineDb = prisma,
): Promise<{ entries: TimelineEntry[]; nextCursor: TimelineCursor | null } | null> {
  const deal = await db.salesDeal.findFirst({ where: visibleDealWhere(actor, dealId), select: { id: true } });
  if (!deal) return null;

  const cursorAt = cursor ? new Date(cursor.at) : null;
  const after =
    cursor && cursorAt && !Number.isNaN(cursorAt.getTime())
      ? { OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: cursor.id } }] }
      : {};
  const rows = await db.salesAuditLog.findMany({
    where: { entityType: "SalesDeal", entityId: dealId, ...after },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: TIMELINE_PAGE_SIZE + 1,
    select: { id: true, at: true, actorType: true, actorId: true, action: true, before: true, after: true },
  });
  const page = rows.slice(0, TIMELINE_PAGE_SIZE);

  const personIds = new Set<string>();
  const noteIds: string[] = [];
  for (const row of page) {
    if (row.actorId) personIds.add(row.actorId);
    if (row.action === "owner_changed") {
      for (const side of [row.before, row.after]) {
        const ownerId = str(payload(side), "ownerId");
        if (ownerId) personIds.add(ownerId);
      }
    }
    if (row.action === "note_added") {
      const noteId = str(payload(row.after), "noteId");
      if (noteId) noteIds.push(noteId);
    }
  }

  const [people, notes] = await Promise.all([
    personIds.size > 0
      ? db.teamMember.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    noteIds.length > 0
      ? db.salesNote.findMany({
          where: { id: { in: noteIds }, archivedAt: null },
          select: { id: true, body: true, authorId: true },
        })
      : Promise.resolve([]),
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const noteById = new Map(notes.map((note) => [note.id, note]));

  const entries = page.map((row): TimelineEntry => {
    const actorFullName = row.actorId ? names.get(row.actorId) : undefined;
    const entry: TimelineEntry = {
      id: row.id,
      at: row.at.toISOString(),
      actorType: row.actorType,
      actorName: actorFullName ? shortName(actorFullName) : null,
      ...describeAuditRow(row, names),
    };
    const note = row.action === "note_added" ? noteById.get(str(payload(row.after), "noteId") ?? "") : undefined;
    if (note) {
      entry.note = { id: note.id, body: note.body, canEdit: actor.isAdmin || note.authorId === actor.userId };
    }
    return entry;
  });

  const last = page[page.length - 1];
  return {
    entries,
    nextCursor: rows.length > TIMELINE_PAGE_SIZE ? { at: last.at.toISOString(), id: last.id } : null,
  };
}
