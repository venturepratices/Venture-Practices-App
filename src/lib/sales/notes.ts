import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import { NOTE_MAX_CHARS } from "@/lib/sales/constants";
import { findDealForEdit } from "@/lib/sales/deal-access";
import { recordDealAudit } from "@/lib/sales/deal-audit";
import { fail, type SalesFail } from "@/lib/sales/http";

// Notes on a deal. A note body is plain text: it is stored exactly as typed
// and never parsed as HTML anywhere (the panel renders it as text), so no
// sanitizer is needed (Decision 16). Only the deal owner or an admin may add a
// note; only its author or an admin may edit it, and an edit keeps the old
// text in its history row. A note is found only through a deal this person may
// see, so one on a hidden or deleted deal is "not found", never confirmed.

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

/** Adds a note to a deal, written by this person. */
export async function addDealNote(actor: SalesActor, dealId: string, input: NoteInput, meta: Meta): Promise<AddNoteResult> {
  return prisma.$transaction(async (tx): Promise<AddNoteResult> => {
    const found = await findDealForEdit(tx, actor, dealId, { id: true, ownerId: true });
    if (!found.ok) return found;

    const note = await tx.salesNote.create({
      data: { body: input.body, authorId: actor.userId, dealId: found.deal.id },
      select: { id: true, body: true, createdAt: true },
    });
    await recordDealAudit(tx, actor, found.deal.id, { action: "note_added", after: { noteId: note.id } }, meta);
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

/** One try: a fresh read through the deal's visibility, the author check, then the guarded write and its history row. */
async function attemptEdit(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  noteId: string,
  input: NoteInput,
  meta: Meta,
): Promise<EditNoteResult | typeof RACED> {
  const note = await tx.salesNote.findFirst({
    where: {
      id: noteId,
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null, ...dealOwnerWhere(actor, "everyone") },
    },
    select: { id: true, body: true, authorId: true, dealId: true, updatedAt: true },
  });
  if (!note?.dealId) return fail(404, NOTE_NOT_FOUND);
  if (!actor.isAdmin && note.authorId !== actor.userId) return fail(403, NOT_YOUR_NOTE);
  if (note.body === input.body) return { ok: true, changed: false, note: { id: note.id, body: note.body } };

  const { count } = await tx.salesNote.updateMany({
    where: { id: note.id, archivedAt: null, updatedAt: note.updatedAt },
    data: { body: input.body },
  });
  if (count === 0) return RACED;
  await recordDealAudit(
    tx,
    actor,
    note.dealId,
    {
      action: "note_edited",
      before: { noteId: note.id, body: note.body },
      after: { noteId: note.id, body: input.body },
    },
    meta,
  );
  return { ok: true, changed: true, note: { id: note.id, body: input.body } };
}
