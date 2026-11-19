import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSalesAudit, type SalesRequestMeta, type SalesSystemActor } from "@/lib/sales/audit";
import { PRACTICE_ZIP_FIELD_KEY, TITLE_MAX } from "@/lib/sales/constants";
import { emailKey, nameKey, organizationKeys, personKeys, phoneKey } from "@/lib/sales/contact-keys";
import { normalizeFieldValue } from "@/lib/sales/custom-fields";
import { activityDueAt } from "@/lib/sales/format";
import { assignLeadOwner } from "@/lib/sales/lead-assignment";
import { recordLeadAudit } from "@/lib/sales/lead-audit";
import { leadSourceFor, nextBusinessDay, type LeadIntake } from "@/lib/sales/lead-intake-payload";
import { LEAD_FIELD_SELECT, writeLeadField } from "@/lib/sales/leads";
import { dateInputValue } from "@/lib/utils";

// A new HighLevel lead lands in the Leads Inbox on its own: the practice and
// the person (found if they are already there, else made), the lead, its
// Practice ZIP, and a first call due the next business day (spec 9.1). Every
// row's history says "webhook" made it. Nothing here edits an existing person
// or practice.
//
// HighLevel can send the same opt-in twice, or retry one that timed out, so the
// whole thing runs inside one transaction that first takes a Postgres advisory
// lock on each identity it was sent (contact id, email, phone). Two requests
// for the same person then take turns: the second finds the first's lead and
// makes nothing. The locks drop when the transaction ends.

const WEBHOOK: SalesSystemActor = { system: "webhook" };

/** `createdBy` on the first call, the way "rule:no-show" names a rule's. */
const WEBHOOK_CREATOR = "webhook:highlevel";
const FIRST_CALL_SUBJECT = "Reach out within 1 business day";

/** A runaway workflow (a loop, a replay) is stopped after this many webhook-made leads in this many minutes, or in one day. */
export const INTAKE_BURST_LIMIT = 60;
export const INTAKE_BURST_MINUTES = 10;
export const INTAKE_DAILY_LIMIT = 300;

type Meta = Partial<SalesRequestMeta>;

export type IntakeResult =
  | { created: true; leadId: string; ownerId: string; title: string }
  | { created: false; leadId: string };

type Contact = { id: string; name: string };
type FoundPerson = Contact & { organizationId: string | null; organization: Contact | null };

const PERSON_SELECT = {
  id: true,
  name: true,
  organizationId: true,
  organization: { select: { id: true, name: true } },
} satisfies Prisma.SalesPersonSelect;

/** One lock name per identity sent, sorted so two requests always take them in the same order. */
function lockNames(intake: LeadIntake, email: string | null, phone: string | null): string[] {
  const practice = intake.practiceName ? nameKey(intake.practiceName) : null;
  const names = [
    intake.ghlContactId ? `ghl:${intake.ghlContactId}` : null,
    email ? `email:${email}` : null,
    phone ? `phone:${phone}` : null,
    // Two different people from a practice that is not in the app yet must not each make it.
    practice ? `org:${practice}|${intake.practiceZip ?? ""}` : null,
  ].filter((name): name is string => name !== null);
  if (names.length === 0) names.push(`name:${nameKey(intake.personName ?? "") ?? ""}`);
  return names.sort();
}

/**
 * An open lead that already belongs to this contact: by HighLevel's contact id,
 * or by its person's email or phone (the spec's rule, so two people sharing an
 * office email or phone are one contact). With none of those to go on, the
 * practice's name and ZIP (or the person's name) stand in, so a retry of such a
 * request does not make a second lead.
 */
async function findOpenLead(tx: Prisma.TransactionClient, intake: LeadIntake, email: string | null, phone: string | null) {
  const identity: Prisma.SalesLeadWhereInput[] = [];
  if (intake.ghlContactId) identity.push({ ghlContactId: intake.ghlContactId });
  if (email) identity.push({ person: { emailKey: email } });
  if (phone) identity.push({ person: { phoneKey: phone } });
  if (identity.length === 0) {
    const practice = intake.practiceName ? nameKey(intake.practiceName) : null;
    const person = intake.personName ? nameKey(intake.personName) : null;
    if (practice) identity.push({ organization: { nameKey: practice, zip: intake.practiceZip } });
    else if (person) identity.push({ person: { nameKey: person } });
  }
  if (identity.length === 0) return null;
  return tx.salesLead.findFirst({
    where: { status: "OPEN", archivedAt: null, OR: identity },
    orderBy: { createdAt: "desc" },
    select: { id: true, ghlContactId: true },
  });
}

/** A person already in Sales: by email first, by phone second. */
async function findPerson(tx: Prisma.TransactionClient, email: string | null, phone: string | null): Promise<FoundPerson | null> {
  const live = { archivedAt: null, mergedIntoId: null };
  if (email) {
    const hit = await tx.salesPerson.findFirst({ where: { ...live, emailKey: email }, orderBy: { createdAt: "asc" }, select: PERSON_SELECT });
    if (hit) return hit;
  }
  if (phone) {
    const hit = await tx.salesPerson.findFirst({ where: { ...live, phoneKey: phone }, orderBy: { createdAt: "asc" }, select: PERSON_SELECT });
    if (hit) return hit;
  }
  return null;
}

/** The practice's organization: one already there with the same name and ZIP, else a new one. */
async function findOrMakeOrganization(
  tx: Prisma.TransactionClient,
  intake: LeadIntake & { practiceName: string },
  ownerId: string,
  meta: Meta,
): Promise<Contact> {
  const key = nameKey(intake.practiceName);
  if (key) {
    const hit = await tx.salesOrganization.findFirst({
      where: { archivedAt: null, mergedIntoId: null, nameKey: key, zip: intake.practiceZip },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (hit) return hit;
  }
  const organization = await tx.salesOrganization.create({
    data: { name: intake.practiceName, ownerId, zip: intake.practiceZip, ...organizationKeys({ name: intake.practiceName }) },
    select: { id: true, name: true },
  });
  await recordSalesAudit(
    tx,
    WEBHOOK,
    { entityType: "SalesOrganization", entityId: organization.id, action: "created", after: { name: organization.name, ownerId } },
    meta,
  );
  return organization;
}

async function makePerson(
  tx: Prisma.TransactionClient,
  intake: LeadIntake & { personName: string },
  organizationId: string | null,
  ownerId: string,
  meta: Meta,
): Promise<Contact> {
  const person = await tx.salesPerson.create({
    data: {
      name: intake.personName,
      ownerId,
      organizationId,
      email: intake.email,
      phone: intake.phone,
      ...personKeys({ name: intake.personName, email: intake.email, phone: intake.phone }),
    },
    select: { id: true, name: true },
  });
  await recordSalesAudit(
    tx,
    WEBHOOK,
    { entityType: "SalesPerson", entityId: person.id, action: "created", after: { name: person.name, ownerId, organizationId } },
    meta,
  );
  return person;
}

/**
 * Makes the lead for one HighLevel opt-in, or finds the open one it repeats.
 * A repeat writes nothing (apart from remembering HighLevel's contact id on an
 * open lead that had none) and does not use up anyone's turn in the rotation.
 */
export async function createLeadFromIntake(intake: LeadIntake, meta: Meta, now: Date): Promise<IntakeResult> {
  const email = emailKey(intake.email);
  const phone = phoneKey(intake.phone);

  return prisma.$transaction(
    async (tx): Promise<IntakeResult> => {
      for (const name of lockNames(intake, email, phone)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
      }

      const open = await findOpenLead(tx, intake, email, phone);
      if (open) {
        if (intake.ghlContactId && open.ghlContactId === null) {
          await tx.salesLead.update({ where: { id: open.id }, data: { ghlContactId: intake.ghlContactId } });
        }
        return { created: false, leadId: open.id };
      }

      // The lead is new: from here on everything writes, starting with the owner's turn.
      const ownerId = await assignLeadOwner(tx);
      const found = await findPerson(tx, email, phone);

      const organization = intake.practiceName
        ? await findOrMakeOrganization(tx, { ...intake, practiceName: intake.practiceName }, ownerId, meta)
        : (found?.organization ?? null);
      const person = found ?? (intake.personName ? await makePerson(tx, { ...intake, personName: intake.personName }, organization?.id ?? null, ownerId, meta) : null);

      const fields = {
        title: (organization?.name ?? person?.name ?? "").slice(0, TITLE_MAX),
        ownerId,
        source: leadSourceFor(intake.formType),
        organizationId: organization?.id ?? null,
        personId: person?.id ?? null,
      };
      const lead = await tx.salesLead.create({ data: { ...fields, ghlContactId: intake.ghlContactId }, select: { id: true } });
      await recordLeadAudit(tx, WEBHOOK, lead.id, { action: "created", after: fields }, meta);

      // The ZIP lives in the Practice ZIP lead field; with that field gone it is left out rather than losing the lead.
      if (intake.practiceZip) {
        const field = await tx.salesCustomField.findFirst({
          where: { key: PRACTICE_ZIP_FIELD_KEY, entity: "LEAD", archivedAt: null },
          select: LEAD_FIELD_SELECT,
        });
        const zip = field ? normalizeFieldValue(field, intake.practiceZip) : null;
        if (field && zip?.ok && zip.value !== null) await writeLeadField(tx, WEBHOOK, lead.id, field, null, zip.value, meta);
      }

      const dueAt = activityDueAt(nextBusinessDay(dateInputValue(now)), null);
      const activity = await tx.salesActivity.create({
        data: {
          type: "CALL",
          subject: FIRST_CALL_SUBJECT,
          dueAt,
          hasTime: false,
          ownerId,
          leadId: lead.id,
          personId: person?.id ?? null,
          createdBy: WEBHOOK_CREATOR,
        },
        select: { id: true },
      });
      await recordLeadAudit(
        tx,
        WEBHOOK,
        lead.id,
        {
          action: "activity_added",
          after: { activityId: activity.id, type: "CALL", subject: FIRST_CALL_SUBJECT, dueAt: dueAt.toISOString(), hasTime: false, createdBy: WEBHOOK_CREATOR },
        },
        meta,
      );

      return { created: true, leadId: lead.id, ownerId, title: fields.title };
    },
    // A request queued behind another for the same contact waits inside this limit, so it is generous.
    { timeout: 20_000 },
  );
}

export type IntakeLimit = "burst" | "daily";

/** Which limit the webhook has reached on leads it made (a few minutes, or one day), else null. */
export async function intakeLimitHit(now: Date): Promise<IntakeLimit | null> {
  const madeSince = (minutes: number) =>
    prisma.salesAuditLog.count({
      where: {
        actorType: "WEBHOOK",
        entityType: "SalesLead",
        action: "created",
        at: { gte: new Date(now.getTime() - minutes * 60_000) },
      },
    });
  const [burst, daily] = await Promise.all([madeSince(INTAKE_BURST_MINUTES), madeSince(24 * 60)]);
  if (burst >= INTAKE_BURST_LIMIT) return "burst";
  if (daily >= INTAKE_DAILY_LIMIT) return "daily";
  return null;
}

const LIMIT_MESSAGES: Record<IntakeLimit, string> = {
  burst: `The HighLevel lead link refused new leads: more than ${INTAKE_BURST_LIMIT} arrived in ${INTAKE_BURST_MINUTES} minutes. Check HighLevel for a workflow that is looping. The link accepts leads again by itself.`,
  daily: `The HighLevel lead link refused new leads: more than ${INTAKE_DAILY_LIMIT} arrived in one day. If that is real, ask Claude to raise the limit. If not, check HighLevel for a workflow that is looping.`,
};

/**
 * Tells every admin, in the app only, that the link hit a limit, at most once
 * an hour for each limit. Written straight to the table (the way the bot alerts
 * are), because Sales code never messages a shared channel. Best effort: it
 * never fails the request that raised it.
 */
export async function alertAdminsOfIntakeLimit(limit: IntakeLimit, now: Date): Promise<void> {
  try {
    const recent = await prisma.notification.findFirst({
      where: { type: "BOT_ALERT", entityType: "LeadLink", entityId: limit, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } },
      select: { id: true },
    });
    if (recent) return;
    const admins = await prisma.teamMember.findMany({ where: { isAdmin: true }, select: { id: true } });
    if (admins.length === 0) return;
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        recipientId: admin.id,
        type: "BOT_ALERT" as const,
        entityType: "LeadLink",
        entityId: limit,
        entityLabel: "HighLevel lead link",
        message: LIMIT_MESSAGES[limit],
        linkPath: "/sales/leads",
      })),
    });
  } catch (error) {
    console.warn("Lead link alert could not be written:", error instanceof Error ? error.message : "unknown error");
  }
}
