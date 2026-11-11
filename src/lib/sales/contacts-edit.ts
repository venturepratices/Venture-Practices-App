import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import { auditDiff, recordSalesAudit, type SalesRequestMeta } from "@/lib/sales/audit";
import { TITLE_MAX } from "@/lib/sales/constants";
import {
  canEditContact,
  CONTACT_NOT_FOUND,
  NOT_YOUR_CONTACT,
  visibleOrganizationWhere,
  visiblePersonWhere,
} from "@/lib/sales/contact-access";
import { organizationKeys, personKeys } from "@/lib/sales/contact-keys";
import { normalizeWebsite } from "@/lib/sales/contact-links";
import { checkContactRefs, contactChange, contactRefSchema, createContacts } from "@/lib/sales/contact-write";
import { fail, type SalesFail } from "@/lib/sales/http";

// Adding and editing people and organizations from the Contacts page and the
// contact panel (Decisions 16 to 19). A new contact belongs to whoever adds it;
// a contact is changed by its owner or an admin, and only while the viewer may
// see it (else "Contact not found."). Every write stores the duplicate keys of
// the details it changes (Decision 17) and one history row, in one transaction.
//
// An edit lands only on the contact exactly as it was read: the write's `where`
// repeats the `updatedAt` it read, so a save made a moment earlier matches
// nothing. That write can come after a new practice is made for the person, so
// a miss throws `ContactRaced` (the whole transaction, practice included, rolls
// back) and the edit is tried once more on a fresh read, then answers 409.

type Meta = Partial<SalesRequestMeta>;

const ADD_NAME = "Add a name.";
const NAME_TOO_LONG = "Keep the name under 200 characters.";
const BAD_EMAIL = "Enter a real email address.";
const PHONE_TOO_LONG = "Keep the phone number under 40 characters.";
const ROLE_TOO_LONG = "Keep the role under 100 characters.";
const ADDRESS_TOO_LONG = "Keep the address under 500 characters.";
const BAD_WEBSITE = "Enter a web address like https://example.com.";
const BAD_ZIP = "Enter a 5-digit ZIP code.";
const NOTHING_TO_CHANGE = "Nothing to change.";

export const CONTACT_JUST_CHANGED = "This contact just changed. Refresh and try again.";

/** The longest address an email can be (RFC 5321). */
const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const ROLE_MAX = 100;
const ADDRESS_MAX = 500;
const WEBSITE_MAX = 500;
/** Five digits, or ZIP+4. */
const ZIP = /^\d{5}(-\d{4})?$/;

// --- Input ---

/** A field left blank clears it: stored as null, never as an empty string. */
const blankToNull = (value: string): string | null => value || null;

const nameSchema = z
  .string({ error: ADD_NAME })
  .trim()
  .min(1, { error: ADD_NAME })
  .max(TITLE_MAX, { error: NAME_TOO_LONG });

/** Trimmed text up to `max` characters; blank or null is none. */
const detailSchema = (max: number, tooLong: string) =>
  z.string().trim().max(max, { error: tooLong }).transform(blankToNull).nullable();

/** Trimmed and kept in the case it was typed (only its duplicate key is lower case); blank or null is none. */
const emailSchema = z
  .string({ error: BAD_EMAIL })
  .trim()
  .max(EMAIL_MAX, { error: BAD_EMAIL })
  .transform(blankToNull)
  .pipe(z.email({ error: BAD_EMAIL }).nullable())
  .nullable();

/** Stored as a full http or https address ("oakcreekdental.com" becomes "https://oakcreekdental.com/"); blank or null is none. */
const websiteSchema = z
  .string({ error: BAD_WEBSITE })
  .trim()
  .max(WEBSITE_MAX, { error: BAD_WEBSITE })
  .transform((value, ctx) => {
    if (!value) return null;
    const href = normalizeWebsite(value);
    if (href === null) {
      ctx.issues.push({ code: "custom", message: BAD_WEBSITE, input: value });
      return z.NEVER;
    }
    return href;
  })
  .nullable();

const zipSchema = z
  .string({ error: BAD_ZIP })
  .trim()
  .transform(blankToNull)
  .pipe(z.string().regex(ZIP, { error: BAD_ZIP }).nullable())
  .nullable();

const somethingSent = (data: object) => Object.values(data).some((value) => value !== undefined);

export const createPersonSchema = z.strictObject({
  name: nameSchema,
  email: emailSchema.optional(),
  phone: detailSchema(PHONE_MAX, PHONE_TOO_LONG).optional(),
  role: detailSchema(ROLE_MAX, ROLE_TOO_LONG).optional(),
  organization: contactRefSchema.optional(),
});

/** Only the keys sent change; `organization: null` takes the person out of their organization. */
export const updatePersonSchema = z
  .strictObject({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    phone: detailSchema(PHONE_MAX, PHONE_TOO_LONG).optional(),
    role: detailSchema(ROLE_MAX, ROLE_TOO_LONG).optional(),
    organization: contactRefSchema.optional(),
  })
  .refine(somethingSent, { error: NOTHING_TO_CHANGE });

export const createOrganizationSchema = z.strictObject({
  name: nameSchema,
  phone: detailSchema(PHONE_MAX, PHONE_TOO_LONG).optional(),
  website: websiteSchema.optional(),
  address: detailSchema(ADDRESS_MAX, ADDRESS_TOO_LONG).optional(),
  zip: zipSchema.optional(),
});

/** Only the keys sent change. */
export const updateOrganizationSchema = z
  .strictObject({
    name: nameSchema.optional(),
    phone: detailSchema(PHONE_MAX, PHONE_TOO_LONG).optional(),
    website: websiteSchema.optional(),
    address: detailSchema(ADDRESS_MAX, ADDRESS_TOO_LONG).optional(),
    zip: zipSchema.optional(),
  })
  .refine(somethingSent, { error: NOTHING_TO_CHANGE });

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// --- Results ---

type Contact = { id: string; name: string };
type CreateContactResult = { ok: true; contact: Contact } | SalesFail;
type UpdateContactResult = { ok: true; changed: boolean; contact: Contact } | SalesFail;

const CONTACT_SELECT = { id: true, name: true } as const;

/** Thrown when an edit's guarded write matched nothing: another save landed first. Rolls the transaction back. */
class ContactRaced extends Error {
  constructor() {
    super("The contact changed while it was being saved.");
  }
}

/**
 * Runs an edit in its own transaction, and once more in a new one when it lost
 * a race (the lost try rolled back, so it left nothing behind). Losing twice
 * answers 409.
 */
async function retryIfRaced(attempt: () => Promise<UpdateContactResult>): Promise<UpdateContactResult> {
  for (let tries = 0; tries < 2; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ContactRaced)) throw error;
    }
  }
  return fail(409, CONTACT_JUST_CHANGED);
}

/** A key sent in an edit: undefined (left out) keeps what is stored. */
function sentOr<T>(sent: T | undefined, stored: T): T {
  return sent === undefined ? stored : sent;
}

// --- People ---

/**
 * Adds a person owned by the actor, with their duplicate keys and a `created`
 * history row. A picked organization must be one the actor may see; a new one
 * (by name) is made first, owned by the actor, with its own `created` row.
 */
export async function createPerson(actor: SalesActor, input: CreatePersonInput, meta: Meta): Promise<CreateContactResult> {
  return prisma.$transaction(async (tx): Promise<CreateContactResult> => {
    const contactInput = { organization: input.organization ?? null, person: null };
    const checked = await checkContactRefs(tx, actor, contactInput);
    if (!checked.ok) return checked;

    // The last check has passed: everything from here writes.
    const { organization } = await createContacts(tx, actor, contactInput, checked.picked, actor.userId, meta);
    const fields = { name: input.name, ownerId: actor.userId, organizationId: organization?.id ?? null };
    const details = { email: input.email ?? null, phone: input.phone ?? null, role: input.role ?? null };
    const person = await tx.salesPerson.create({
      data: { ...fields, ...details, ...personKeys({ name: fields.name, email: details.email, phone: details.phone }) },
      select: CONTACT_SELECT,
    });
    await recordSalesAudit(tx, actor, { entityType: "SalesPerson", entityId: person.id, action: "created", after: fields }, meta);
    return { ok: true, contact: person };
  });
}

const PERSON_EDIT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  organizationId: true,
  ownerId: true,
  updatedAt: true,
} satisfies Prisma.SalesPersonSelect;

/** Which stored key goes with each detail of a person. */
const PERSON_KEY_OF = { name: "nameKey", email: "emailKey", phone: "phoneKey" } as const;

/**
 * Changes a person's name, email, phone, role or organization (picked, new by
 * name, or none). One `updated` history row with only what changed, and none
 * (`changed: false`) when nothing did. A new practice belongs to the person's
 * owner, so a rep whose person an admin moved still sees it.
 */
export async function updatePerson(
  actor: SalesActor,
  personId: string,
  input: UpdatePersonInput,
  meta: Meta,
): Promise<UpdateContactResult> {
  return retryIfRaced(() => prisma.$transaction((tx) => attemptPersonUpdate(tx, actor, personId, input, meta)));
}

async function attemptPersonUpdate(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  personId: string,
  input: UpdatePersonInput,
  meta: Meta,
): Promise<UpdateContactResult> {
  const person = await tx.salesPerson.findFirst({
    where: { id: personId, mergedIntoId: null, ...visiblePersonWhere(actor, "everyone") },
    select: PERSON_EDIT_SELECT,
  });
  if (!person) return fail(404, CONTACT_NOT_FOUND);
  if (!canEditContact(actor, person)) return fail(403, NOT_YOUR_CONTACT);

  const stored = {
    name: person.name,
    email: person.email,
    phone: person.phone,
    role: person.role,
    organizationId: person.organizationId,
  };
  const next = {
    name: sentOr(input.name, person.name),
    email: sentOr(input.email, person.email),
    phone: sentOr(input.phone, person.phone),
    role: sentOr(input.role, person.role),
    organizationId: person.organizationId,
  };
  const organizationRef = contactChange(input.organization, person.organizationId);
  if (organizationRef === undefined && Object.keys(auditDiff(stored, next).after).length === 0) {
    return { ok: true, changed: false, contact: { id: person.id, name: person.name } };
  }

  if (organizationRef !== undefined) {
    const contactInput = { organization: organizationRef, person: null };
    const checked = await checkContactRefs(tx, actor, contactInput);
    if (!checked.ok) return checked;
    // The last check has passed: a new practice is made now, so a lost race below must roll it back.
    const { organization } = await createContacts(tx, actor, contactInput, checked.picked, person.ownerId, meta);
    next.organizationId = organization?.id ?? null;
  }

  const edits = auditDiff(stored, next);
  const keys = personKeys(next);
  const data: Prisma.SalesPersonUncheckedUpdateManyInput = { ...edits.after };
  for (const [field, key] of Object.entries(PERSON_KEY_OF)) {
    if (field in edits.after) data[key] = keys[key];
  }

  const { count } = await tx.salesPerson.updateMany({
    where: { id: personId, archivedAt: null, mergedIntoId: null, updatedAt: person.updatedAt },
    data,
  });
  if (count === 0) throw new ContactRaced();

  await recordSalesAudit(tx, actor, { entityType: "SalesPerson", entityId: personId, action: "updated", ...edits }, meta);
  return { ok: true, changed: true, contact: { id: personId, name: next.name } };
}

// --- Organizations ---

/** Adds an organization owned by the actor, with its duplicate key and a `created` history row. */
export async function createOrganization(
  actor: SalesActor,
  input: CreateOrganizationInput,
  meta: Meta,
): Promise<CreateContactResult> {
  return prisma.$transaction(async (tx): Promise<CreateContactResult> => {
    const fields = { name: input.name, ownerId: actor.userId };
    const details = {
      phone: input.phone ?? null,
      website: input.website ?? null,
      address: input.address ?? null,
      zip: input.zip ?? null,
    };
    const organization = await tx.salesOrganization.create({
      data: { ...fields, ...details, ...organizationKeys(fields) },
      select: CONTACT_SELECT,
    });
    await recordSalesAudit(
      tx,
      actor,
      { entityType: "SalesOrganization", entityId: organization.id, action: "created", after: fields },
      meta,
    );
    return { ok: true, contact: organization };
  });
}

const ORGANIZATION_EDIT_SELECT = {
  id: true,
  name: true,
  phone: true,
  website: true,
  address: true,
  zip: true,
  ownerId: true,
  updatedAt: true,
} satisfies Prisma.SalesOrganizationSelect;

/**
 * Changes an organization's name, phone, website, address or ZIP. One `updated`
 * history row with only what changed, and none (`changed: false`) when nothing did.
 */
export async function updateOrganization(
  actor: SalesActor,
  organizationId: string,
  input: UpdateOrganizationInput,
  meta: Meta,
): Promise<UpdateContactResult> {
  return retryIfRaced(() => prisma.$transaction((tx) => attemptOrganizationUpdate(tx, actor, organizationId, input, meta)));
}

async function attemptOrganizationUpdate(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  organizationId: string,
  input: UpdateOrganizationInput,
  meta: Meta,
): Promise<UpdateContactResult> {
  const organization = await tx.salesOrganization.findFirst({
    where: { id: organizationId, mergedIntoId: null, ...visibleOrganizationWhere(actor, "everyone") },
    select: ORGANIZATION_EDIT_SELECT,
  });
  if (!organization) return fail(404, CONTACT_NOT_FOUND);
  if (!canEditContact(actor, organization)) return fail(403, NOT_YOUR_CONTACT);

  const next = {
    name: sentOr(input.name, organization.name),
    phone: sentOr(input.phone, organization.phone),
    website: sentOr(input.website, organization.website),
    address: sentOr(input.address, organization.address),
    zip: sentOr(input.zip, organization.zip),
  };
  const edits = auditDiff(
    {
      name: organization.name,
      phone: organization.phone,
      website: organization.website,
      address: organization.address,
      zip: organization.zip,
    },
    next,
  );
  if (Object.keys(edits.after).length === 0) {
    return { ok: true, changed: false, contact: { id: organization.id, name: organization.name } };
  }

  const data: Prisma.SalesOrganizationUncheckedUpdateManyInput = { ...edits.after };
  if ("name" in edits.after) data.nameKey = organizationKeys(next).nameKey;

  const { count } = await tx.salesOrganization.updateMany({
    where: { id: organizationId, archivedAt: null, mergedIntoId: null, updatedAt: organization.updatedAt },
    data,
  });
  if (count === 0) throw new ContactRaced();

  await recordSalesAudit(
    tx,
    actor,
    { entityType: "SalesOrganization", entityId: organizationId, action: "updated", ...edits },
    meta,
  );
  return { ok: true, changed: true, contact: { id: organizationId, name: next.name } };
}
