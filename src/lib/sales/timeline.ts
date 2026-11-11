import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { ACTIVITY_TYPE_LABELS, TIMELINE_PAGE_SIZE } from "@/lib/sales/constants";
import { visibleOrganizationWhere, visiblePersonWhere } from "@/lib/sales/contact-access";
import type { ContactKind } from "@/lib/sales/contacts-query";
import { visibleDealWhere } from "@/lib/sales/deal-access";
import { formatMoney, isValidDateString, shortName } from "@/lib/sales/format";
import { visibleLeadWhere } from "@/lib/sales/lead-access";
import { endOfDay, formatDate } from "@/lib/utils";

// The deal, lead and contact panels' History: the locked history rows written
// against a deal (deal-audit.ts), a lead (lead-audit.ts) or a person or
// organization (audit.ts), newest first, each turned into one plain line that
// names who did it. Pages of 30 with a "Show older" cursor (spec 7.8). The rows
// are stored JSON, so every payload is read defensively: an unexpected shape
// gives a vaguer line, never an error.

type TimelineDb = Pick<
  typeof prisma,
  "salesDeal" | "salesLead" | "salesPerson" | "salesOrganization" | "salesAuditLog" | "teamMember" | "salesNote"
>;
type PageDb = Pick<TimelineDb, "salesAuditLog" | "teamMember" | "salesNote">;

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
  | "note"
  | "converted"
  | "contact"
  | "file"
  | "merged";

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

/** "Expected close set to Nov 30" for a stored "YYYY-MM-DD" day, "Expected close cleared" for null. */
function expectedCloseLine(day: unknown): string {
  if (day === null) return "Expected close cleared";
  if (typeof day !== "string" || !isValidDateString(day)) return "Expected close changed";
  return `Expected close set to ${formatDate(endOfDay(day), { month: "short", day: "numeric" })}`;
}

/** "Renamed to ...", "Source set to ..." and/or "Expected close set to ...", for the keys that changed; `fallback` when none reads. */
function updatedLine(after: Payload, fallback: string): string {
  const parts: string[] = [];
  const title = str(after, "title");
  if (title) parts.push(`Renamed to ${title}`);
  if ("source" in after) {
    const source = str(after, "source");
    parts.push(source ? `Source set to ${source}` : "Source cleared");
  }
  if ("expectedCloseDate" in after) parts.push(expectedCloseLine(after.expectedCloseDate));
  return parts.length > 0 ? joinSentences(parts) : fallback;
}

/** "Organization changed to Oak Creek Dental", "Organization removed", or "Organization changed" when the name is gone. */
function contactSideLine(label: string, after: Payload, idKey: string, nameKey: string): string {
  if (!str(after, idKey)) return `${label} removed`;
  const name = str(after, nameKey);
  return name ? `${label} changed to ${name}` : `${label} changed`;
}

/**
 * A deal's or lead's organization and person changing (deal-audit.ts
 * `ContactChange`). The ids say which side changed; a merge of duplicate
 * contacts says so at the end.
 */
function contactChangedLine(before: Payload, after: Payload): string {
  const organizationChanged = str(before, "organizationId") !== str(after, "organizationId");
  const personChanged = str(before, "personId") !== str(after, "personId");
  const merged = after.merged === true ? " (merged duplicates)" : "";
  if (organizationChanged && personChanged) return `Organization and person changed${merged}`;
  if (organizationChanged) return `${contactSideLine("Organization", after, "organizationId", "organizationName")}${merged}`;
  if (personChanged) return `${contactSideLine("Person", after, "personId", "personName")}${merged}`;
  return `Contacts changed${merged}`;
}

/** Joins sentences with ". ", without a second period after one that already ends in "." ("Renamed to Sarah K."). */
function joinSentences(parts: string[]): string {
  return parts.reduce((text, part) => (text === "" ? part : `${text}${text.endsWith(".") ? "" : "."} ${part}`), "");
}

/** The contact details an edit can change, in the order "Details updated: ..." names them, and the payload keys that mean each. */
const CONTACT_DETAILS: [label: string, keys: string[]][] = [
  ["email", ["email"]],
  ["phone", ["phone"]],
  ["role", ["role"]],
  ["organization", ["organizationId", "organization"]],
  ["website", ["website"]],
  ["address", ["address"]],
  ["ZIP", ["zip"]],
];

/** "Renamed to ..." and/or "Details updated: email, phone", for the keys an edit changed. */
function contactUpdatedLine(after: Payload): string {
  const parts: string[] = [];
  const name = str(after, "name");
  if (name) parts.push(`Renamed to ${name}`);
  const details = CONTACT_DETAILS.filter(([, keys]) => keys.some((key) => key in after)).map(([label]) => label);
  if (details.length > 0) parts.push(`Details updated: ${details.join(", ")}`);
  return parts.length > 0 ? joinSentences(parts) : "Contact updated";
}

/** A person's or an organization's own History line (entity "SalesPerson" or "SalesOrganization"). */
function describeContactRow(kind: "person" | "organization", action: string, after: Payload): { icon: TimelineIcon; text: string } {
  switch (action) {
    case "created":
      return { icon: "created", text: kind === "person" ? "Person added" : "Organization added" };
    case "updated":
      return { icon: "field", text: contactUpdatedLine(after) };
    case "merged": {
      // On the kept contact: the dropped one's name, from the snapshot the merge stored.
      const dropped = str(payload(after.dropped), "name") ?? "a duplicate";
      return { icon: "merged", text: `Merged ${dropped} into this ${kind}` };
    }
    case "merged_into": {
      const kept = str(after, "keptName");
      return { icon: "merged", text: kept ? `Merged into ${kept}` : "Merged into another contact" };
    }
    default:
      return { icon: "field", text: "Contact updated" };
  }
}

/** Whose History a contact row is, or null for a deal's or a lead's. */
function contactKindOf(entityType: string | undefined): "person" | "organization" | null {
  if (entityType === "SalesPerson") return "person";
  if (entityType === "SalesOrganization") return "organization";
  return null;
}

/**
 * One History line for a stored history row. `names` maps team member ids to
 * full names (for "Owner changed to Ben S."). `entityType` says whose history
 * the row is ("SalesLead" reads as a lead's, "SalesPerson" and
 * "SalesOrganization" as a contact's; anything else, or none, as a deal's).
 * No line uses an em dash.
 */
export function describeAuditRow(
  row: { entityType?: string; action: string; actorType: string; before: unknown; after: unknown },
  names: Map<string, string>,
): { icon: TimelineIcon; text: string } {
  const after = payload(row.after);
  const before = payload(row.before);
  const contactKind = contactKindOf(row.entityType);
  if (contactKind) return describeContactRow(contactKind, row.action, after);
  const isLead = (row.entityType ?? "SalesDeal") === "SalesLead";
  const fallback = { icon: "field", text: isLead ? "Lead updated" : "Deal updated" } as const;

  switch (row.action) {
    case "created": {
      if (isLead) return { icon: "created", text: "Lead created" };
      // A deal made by converting a lead (lead-convert.ts) says where it came from.
      if (str(after, "fromLeadId")) {
        const source = str(after, "source");
        return { icon: "converted", text: source ? `Converted from lead (${source})` : "Converted from a lead" };
      }
      return { icon: "created", text: "Deal created" };
    }
    case "stage_changed": {
      const stageName = str(after, "stageName") ?? "another stage";
      // A toast's Undo that put the earlier entry time back (stage-moves.ts), not a move by hand.
      if (after.undo === true) return { icon: "stage", text: `Moved back to ${stageName} (undo)` };
      const moved = `Moved to ${stageName}`;
      // The only rule that moves deals is the No Show rule.
      return { icon: "stage", text: row.actorType === "SYSTEM" ? `${moved} (No Show rule)` : moved };
    }
    case "status_changed": {
      const status = str(after, "status");
      if (isLead) {
        // A lead's Archive (status ARCHIVED, with Undo) and Restore. Delete is the "archived" row.
        if (status === "ARCHIVED") return { icon: "deleted", text: "Archived" };
        if (status === "OPEN") return { icon: "reopened", text: "Restored to the Inbox" };
        return fallback;
      }
      if (status === "WON") return { icon: "won", text: "Marked as won" };
      if (status === "LOST") {
        // The comment typed into the Lost dialog follows the reason: "Marked as lost: Price. Went with a cheaper printer".
        const reason = str(after, "lostReason");
        const comment = str(after, "lostComment");
        const line = reason ? `Marked as lost: ${reason}` : "Marked as lost";
        return { icon: "lost", text: comment ? `${line}. ${comment}` : line };
      }
      if (status === "OPEN") return { icon: "reopened", text: "Reopened" };
      return fallback;
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
      return { icon: "field", text: updatedLine(after, fallback.text) };
    case "field_changed": {
      const label = str(after, "label") ?? "A field";
      const value = str(after, "value");
      return { icon: "field", text: value ? `${label} set to ${value}` : `${label} cleared` };
    }
    case "contact_changed":
      return { icon: "contact", text: contactChangedLine(before, after) };
    case "converted":
      return { icon: "converted", text: "Converted to a deal" };
    case "archived":
      return { icon: "deleted", text: isLead ? "Lead deleted" : "Deal deleted" };
    case "delete_refused":
      return { icon: "deleted", text: isLead ? "Tried to delete this lead (refused)" : "Tried to delete this deal (refused)" };
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
    case "file_added": {
      const name = str(after, "name");
      return { icon: "file", text: name ? `File added: ${name}` : "File added" };
    }
    case "file_removed": {
      const name = str(before, "name");
      return { icon: "file", text: name ? `File removed: ${name}` : "File removed" };
    }
    default:
      return fallback;
  }
}

export type TimelinePage = { entries: TimelineEntry[]; nextCursor: TimelineCursor | null };

/** Whose history rows a page reads: one record, or several (a converted deal and its lead; merged contacts). */
type TimelineSource = { entityType: string; entityId: string };

const CURSOR_ID_MAX = 64;

/** `?at=<iso>&id=<id>` from "Show older". Anything unreadable means the first page, never an error. */
export function readTimelineCursor(request: Request): TimelineCursor | null {
  const search = new URL(request.url).searchParams;
  const at = search.get("at");
  const id = search.get("id");
  if (!at || !id || id.length > CURSOR_ID_MAX) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : { at: new Date(ms).toISOString(), id };
}

/**
 * One page of History over `sources`, newest first, continuing after `cursor`.
 * The caller has already checked this person may see the record. Names come
 * from one team-member lookup, note text from one note lookup.
 */
async function loadTimelinePage(
  db: PageDb,
  actor: SalesActor,
  sources: TimelineSource[],
  cursor: TimelineCursor | null,
): Promise<TimelinePage> {
  const cursorAt = cursor ? new Date(cursor.at) : null;
  const cursorClause: Prisma.SalesAuditLogWhereInput | null =
    cursor && cursorAt && !Number.isNaN(cursorAt.getTime())
      ? { OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: cursor.id } }] }
      : null;
  const where: Prisma.SalesAuditLogWhereInput =
    sources.length === 1
      ? { ...sources[0], ...cursorClause }
      : { AND: cursorClause ? [{ OR: sources }, cursorClause] : [{ OR: sources }] };
  const rows = await db.salesAuditLog.findMany({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: TIMELINE_PAGE_SIZE + 1,
    select: { id: true, at: true, entityType: true, actorType: true, actorId: true, action: true, before: true, after: true },
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

/**
 * One page of a deal's History, newest first, continuing after `cursor`. Null
 * when this person may not see the deal (the route answers 404). A deal made
 * by converting a lead also reads that lead's rows, so the notes and calls that
 * moved with it keep their history (Decision 14).
 */
export async function loadDealTimeline(
  actor: SalesActor,
  dealId: string,
  cursor: TimelineCursor | null,
  db: TimelineDb = prisma,
): Promise<TimelinePage | null> {
  const deal = await db.salesDeal.findFirst({
    where: visibleDealWhere(actor, dealId),
    select: { id: true, convertedFromLead: { select: { id: true } } },
  });
  if (!deal) return null;
  const sources: TimelineSource[] = [{ entityType: "SalesDeal", entityId: dealId }];
  if (deal.convertedFromLead) sources.push({ entityType: "SalesLead", entityId: deal.convertedFromLead.id });
  return loadTimelinePage(db, actor, sources, cursor);
}

/**
 * One page of a lead's History, newest first, continuing after `cursor`. Null
 * when this person may not see the lead, or it is deleted (the route answers 404).
 */
export async function loadLeadTimeline(
  actor: SalesActor,
  leadId: string,
  cursor: TimelineCursor | null,
  db: TimelineDb = prisma,
): Promise<TimelinePage | null> {
  const lead = await db.salesLead.findFirst({ where: visibleLeadWhere(actor, leadId), select: { id: true } });
  if (!lead) return null;
  return loadTimelinePage(db, actor, [{ entityType: "SalesLead", entityId: leadId }], cursor);
}

/**
 * One page of a person's or an organization's History, newest first,
 * continuing after `cursor`, including the rows of every contact merged into
 * it (A6), so a merge loses no history. Null when this person may not see the
 * contact, or it is archived or missing (the route answers 404).
 */
export async function loadContactTimeline(
  actor: SalesActor,
  kind: ContactKind,
  id: string,
  cursor: TimelineCursor | null,
  db: TimelineDb = prisma,
): Promise<TimelinePage | null> {
  let contactIds: string[];
  if (kind === "person") {
    const person = await db.salesPerson.findFirst({ where: { id, ...visiblePersonWhere(actor, "everyone") }, select: { id: true } });
    if (!person) return null;
    const merged = await db.salesPerson.findMany({ where: { mergedIntoId: id }, select: { id: true } });
    contactIds = [id, ...merged.map((row) => row.id)];
  } else {
    const organization = await db.salesOrganization.findFirst({
      where: { id, ...visibleOrganizationWhere(actor, "everyone") },
      select: { id: true },
    });
    if (!organization) return null;
    const merged = await db.salesOrganization.findMany({ where: { mergedIntoId: id }, select: { id: true } });
    contactIds = [id, ...merged.map((row) => row.id)];
  }
  const entityType = kind === "person" ? "SalesPerson" : "SalesOrganization";
  return loadTimelinePage(
    db,
    actor,
    contactIds.map((entityId) => ({ entityType, entityId })),
    cursor,
  );
}
