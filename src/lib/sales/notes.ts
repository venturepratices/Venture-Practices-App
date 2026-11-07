import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import { NOTE_MAX_CHARS } from "@/lib/sales/constants";
import { findDealForEdit } from "@/lib/sales/deal-access";
import { recordDealAudit, type ChildAuditEvent } from "@/lib/sales/deal-audit";
import { fail, type SalesFail } from "@/lib/sales/http";
import { refuseUnlessOpen, takeOpenLead } from "@/lib/sales/lead-access";
import { recordLeadAudit } from "@/lib/sales/lead-audit";

// Notes on a deal or a lead. A note body is plain text: it is stored exactly as
// typed and never parsed as HTML anywhere (the panel renders it as text), so no
// sanitizer is needed (Decision 16). Only the owner of the deal or lead, or an
// admin, may add a note; only its author or an admin may edit it, and an edit
// keeps the old text in its history row. A note is found only through a deal
// or lead this person may see, so one on a hidden or deleted parent is "not
// found", never confirmed. A note reaches its lead only while it has no deal
// (Decision 10): once a convert moves it, its deal decides. A note on a lead
// that is converted or archived cannot be edited (409).

type Meta = Partial<SalesRequestMeta>;

const NOTE_NOT_FOUND = "Note not found.";
const NOT_YOUR_NOTE = "Only the person who wrote this note or an admin can edit it.";
const NOTE_JUST_CHANGED = "This note just changed. Refresh and try again.";
const WRITE_SOMETHING = "Write something first.";

// --- Input ---

export const noteSchema = z.strictObject({
  body: z
    .string({ error: WRITE_SOMETHING })
    .trim()
    .min(1, { error: WRITE_SOMETHING })
    .max(NOTE_MAX_CHARS, { error: "Notes can be up to 50,000 characters." }),
});

export type NoteInput = z.infer<typeof noteSchema>;

// --- Add ---

type AddNoteResult = { ok: true; note: { id: string; body: string; createdAt: string } } | SalesFail;

const ADDED_NOTE_SELECT = { id: true, body: true, createdAt: true } as const;

/** Adds a note to a deal, written by this person. */
export async function addDealNote(actor: SalesActor, dealId: string, input: NoteInput, meta: Meta): Promise<AddNoteResult> {
  return prisma.$transaction(async (tx): Promise<AddNoteResult> => {
    const found = await findDealForEdit(tx, actor, dealId, { id: true, ownerId: true });
    if (!found.ok) return found;

    const note = await tx.salesNote.create({
      data: { body: input.body, authorId: actor.userId, dealId: found.deal.id },
      select: ADDED_NOTE_SELECT,
    });
    await recordDealAudit(tx, actor, found.deal.id, { action: "note_added", after: { noteId: note.id } }, meta);
    return { ok: true, note: { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() } };
  });
}

/**
 * Adds a note to an open lead, written by this person. The lead's row is taken
 * first (`takeOpenLead`), so a convert of the same lead at the same moment
 * either moves this note to the deal or wins, and the note is never made.
 */
export async function addLeadNote(actor: SalesActor, leadId: string, input: NoteInput, meta: Meta): Promise<AddNoteResult> {
  return prisma.$transaction(async (tx): Promise<AddNoteResult> => {
    const taken = await takeOpenLead(tx, actor, leadId);
    if (!taken.ok) return taken;

    const note = await tx.salesNote.create({
      data: { body: input.body, authorId: actor.userId, leadId: taken.lead.id },
      select: ADDED_NOTE_SELECT,
    });
    await recordLeadAudit(tx, actor, taken.lead.id, { action: "note_added", after: { noteId: note.id } }, meta);
    return { ok: true, note: { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() } };
  });
}

// --- Edit ---

type EditNoteResult = { ok: true; changed: boolean; note: { id: string; body: string } } | SalesFail;

/** What an attempt answers when its guarded write matched nothing: another request changed the note first. */
const RACED = Symbol("raced");

/**
 * Replaces a note's text. The same text changes nothing and writes no history.
 * The write lands only while the note is unchanged since it was read, so two
 * saves at once never lose an edit from history: the second reads again and
 * records the text it actually replaced (or nothing, when it was the same
 * save twice). A second miss answers 409.
 */
export async function editNote(actor: SalesActor, noteId: string, input: NoteInput, meta: Meta): Promise<EditNoteResult> {
  return prisma.$transaction(async (tx): Promise<EditNoteResult> => {
    for (let tries = 0; tries < 2; tries++) {
      const result = await attemptEdit(tx, actor, noteId, input, meta);
      if (result !== RACED) return result;
    }
    return fail(409, NOTE_JUST_CHANGED);
  });
}

/** One try: a fresh read through the deal's or lead's visibility, the author and status checks, then the guarded write and its history row. */
async function attemptEdit(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  noteId: string,
  input: NoteInput,
  meta: Meta,
): Promise<EditNoteResult | typeof RACED> {
  const owner = dealOwnerWhere(actor, "everyone");
  const note = await tx.salesNote.findFirst({
    where: {
      id: noteId,
      archivedAt: null,
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null, ...owner } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ...owner } },
      ],
    },
    select: { id: true, body: true, authorId: true, dealId: true, leadId: true, updatedAt: true, lead: { select: { status: true } } },
  });
  if (!note) return fail(404, NOTE_NOT_FOUND);
  // Through its deal once it has one; through its lead only while it has none.
  const parent = note.dealId
    ? { kind: "deal" as const, id: note.dealId }
    : note.leadId && note.lead
      ? { kind: "lead" as const, id: note.leadId, status: note.lead.status }
      : null;
  if (!parent) return fail(404, NOTE_NOT_FOUND);
  if (!actor.isAdmin && note.authorId !== actor.userId) return fail(403, NOT_YOUR_NOTE);
  const closed = parent.kind === "lead" ? refuseUnlessOpen(parent.status) : null;
  if (closed) return closed;
  if (note.body === input.body) return { ok: true, changed: false, note: { id: note.id, body: note.body } };

  const { count } = await tx.salesNote.updateMany({
    where: {
      id: note.id,
      archivedAt: null,
      updatedAt: note.updatedAt,
      // A convert that moved it to a deal a moment ago makes this miss, so the next try reaches it through the deal.
      ...(parent.kind === "lead" ? { dealId: null } : {}),
    },
    data: { body: input.body },
  });
  if (count === 0) return RACED;
  const event: ChildAuditEvent = {
    action: "note_edited",
    before: { noteId: note.id, body: note.body },
    after: { noteId: note.id, body: input.body },
  };
  if (parent.kind === "lead") await recordLeadAudit(tx, actor, parent.id, event, meta);
  else await recordDealAudit(tx, actor, parent.id, event, meta);
  return { ok: true, changed: true, note: { id: note.id, body: input.body } };
}
