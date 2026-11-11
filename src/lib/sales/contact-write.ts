import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { SalesActor } from "@/lib/sales/access";
import { recordSalesAudit, type SalesRequestMeta } from "@/lib/sales/audit";
import { TITLE_MAX } from "@/lib/sales/constants";
import { visibleOrganizationWhere, visiblePersonWhere } from "@/lib/sales/contact-access";
import { organizationKeys, personKeys } from "@/lib/sales/contact-keys";
import type { ContactChange } from "@/lib/sales/deal-audit";
import { fail, type SalesFail } from "@/lib/sales/http";

// The one way Sales picks or adds an organization and a person: Add deal, new
// lead, convert and contact edits. A picked contact must be one the actor may
// see (Decision 18); a new one is made for the record's owner with its
// duplicate keys (Decision 17) and its own `created` history row.
//
// Two steps, so a caller can keep every refusal ahead of its first write:
// `checkContactRefs` only reads; `createContacts` only writes and never refuses.
// `resolveContacts` runs both, for callers with no refusal after it.

const ID_MAX = 64;

export const ORG_NOT_FOUND = "That organization was not found.";
export const PERSON_NOT_FOUND = "That person was not found.";

/**
 * An existing organization or person picked by id, or a new one by name; null
 * for none. No default here: zod 4 fills a `.default()` in even inside
 * `.optional()`, so create schemas add `.default(null)` and update schemas use
 * `.optional()`, which leaves a key that was not sent out.
 */
export const contactRefSchema = z
  .union([
    z.strictObject({ id: z.string().min(1).max(ID_MAX) }),
    z.strictObject({ name: z.string().trim().min(1).max(TITLE_MAX) }),
  ])
  .nullable();

export type ContactRef = z.infer<typeof contactRefSchema>;

type Contact = { id: string; name: string };
export type ResolvedContacts = { organization: Contact | null; person: Contact | null };
type ContactInput = { organization: ContactRef; person: ContactRef };
type Meta = Partial<SalesRequestMeta>;

const CONTACT_SELECT = { id: true, name: true } as const;

/**
 * Checks both picked contacts (the organization first) against what the actor
 * may see. Writes nothing; a contact given by name is not looked up.
 */
export async function checkContactRefs(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  input: ContactInput,
): Promise<{ ok: true; picked: ResolvedContacts } | SalesFail> {
  let organization: Contact | null = null;
  if (input.organization && "id" in input.organization) {
    organization = await tx.salesOrganization.findFirst({
      where: { id: input.organization.id, ...visibleOrganizationWhere(actor, "everyone") },
      select: CONTACT_SELECT,
    });
    if (!organization) return fail(400, ORG_NOT_FOUND);
  }

  let person: Contact | null = null;
  if (input.person && "id" in input.person) {
    person = await tx.salesPerson.findFirst({
      where: { id: input.person.id, ...visiblePersonWhere(actor, "everyone") },
      select: CONTACT_SELECT,
    });
    if (!person) return fail(400, PERSON_NOT_FOUND);
  }

  return { ok: true, picked: { organization, person } };
}

/**
 * Makes each contact given by name for `ownerId` (the organization first), with
 * its keys and its `created` history row. A new person joins the organization,
 * picked or new; a picked person is never moved. Never refuses.
 */
export async function createContacts(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  input: ContactInput,
  picked: ResolvedContacts,
  ownerId: string,
  meta: Meta,
): Promise<ResolvedContacts> {
  let organization = picked.organization;
  if (input.organization && "name" in input.organization) {
    const fields = { name: input.organization.name, ownerId };
    organization = await tx.salesOrganization.create({
      data: { ...fields, ...organizationKeys(fields) },
      select: CONTACT_SELECT,
    });
    await recordSalesAudit(
      tx,
      actor,
      { entityType: "SalesOrganization", entityId: organization.id, action: "created", after: fields },
      meta,
    );
  }

  let person = picked.person;
  if (input.person && "name" in input.person) {
    const fields = { name: input.person.name, ownerId, organizationId: organization?.id ?? null };
    person = await tx.salesPerson.create({
      data: { ...fields, ...personKeys({ name: fields.name, email: null, phone: null }) },
      select: CONTACT_SELECT,
    });
    await recordSalesAudit(tx, actor, { entityType: "SalesPerson", entityId: person.id, action: "created", after: fields }, meta);
  }

  return { organization, person };
}

/**
 * A contact sent in an edit, or undefined when it would leave the record's
 * contact as it is: left out, null when there is none already, or the same id.
 * A new contact by name is always a change.
 */
export function contactChange(ref: ContactRef | undefined, currentId: string | null): ContactRef | undefined {
  if (ref === undefined) return undefined;
  if (ref === null) return currentId === null ? undefined : null;
  if ("id" in ref) return ref.id === currentId ? undefined : ref;
  return ref;
}

/** A deal's or lead's organization and person with the names they have now, for a `contact_changed` history row. */
export function contactSnapshot(contacts: ResolvedContacts): ContactChange {
  return {
    organizationId: contacts.organization?.id ?? null,
    organizationName: contacts.organization?.name ?? null,
    personId: contacts.person?.id ?? null,
    personName: contacts.person?.name ?? null,
  };
}

/** `checkContactRefs` then `createContacts`, for callers with no refusal after this point. */
export async function resolveContacts(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  input: ContactInput,
  ownerId: string,
  meta: Meta,
): Promise<({ ok: true } & ResolvedContacts) | SalesFail> {
  const checked = await checkContactRefs(tx, actor, input);
  if (!checked.ok) return checked;
  return { ok: true, ...(await createContacts(tx, actor, input, checked.picked, ownerId, meta)) };
}
