import { prisma } from "@/lib/prisma";

import { TEST_PREFIX } from "./demo-seed";

// Removes the TEST * demo rows and nothing else. Deletes children before parents,
// because Sales relations are onDelete: Restrict.
//
// Deals, leads, people and organizations the team added themselves are never
// touched. A TEST row that something outside the TEST set still points at (a
// non-TEST deal added for a TEST contact, a non-TEST note written on a TEST
// deal) is kept whole, with its own TEST notes and activities. The database
// would refuse to delete it anyway. With `includeAdded`, non-TEST notes,
// activities, files and field values added on TEST rows are also removed.
//
// The history log (SalesAuditLog) cannot be deleted by design, so the history
// lines written for the demo stay. They point at rows that no longer exist and
// show nowhere in the app.

type Kind = "org" | "person" | "lead" | "deal" | "activity" | "note" | "file" | "value";
/** One row in the picture: what it is, what it points at (Restrict), and who it belongs to first. */
type Node = { key: string; kind: Kind; refs: string[]; primary: string | null; listed: boolean };

const k = (kind: Kind, id: string | null | undefined) => (id ? `${kind}:${id}` : null);
const compact = (xs: (string | null)[]) => xs.filter((x): x is string => x !== null);

export type DemoCleanSummary = {
  removed: {
    organizations: number;
    people: number;
    leads: number;
    deals: number;
    activities: number;
    notes: number;
    files: number;
    customFieldValues: number;
  };
  kept: { organizations: number; people: number; leads: number; deals: number };
  addedStaying: number;
  dryRun: boolean;
  includeAdded: boolean;
};

/**
 * Remove the TEST * demo rows. Pass `dryRun: true` to see what it would do.
 * Pass `includeAdded: true` to also remove non-TEST notes, activities, files
 * and custom values added directly on TEST rows.
 */
export async function removeDemoData(
  options: { dryRun?: boolean; includeAdded?: boolean } = {},
): Promise<DemoCleanSummary> {
  const dryRun = options.dryRun ?? false;
  const includeAdded = options.includeAdded ?? false;

  return prisma.$transaction(
    async (tx) => {
      // --- Every TEST row: ids come from the current database, not a file ---
      const [orgRows, personRows, leadRows, dealRows, activityRows, noteRows] = await Promise.all([
        tx.salesOrganization.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } }),
        tx.salesPerson.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } }),
        tx.salesLead.findMany({ where: { title: { startsWith: TEST_PREFIX } }, select: { id: true } }),
        tx.salesDeal.findMany({ where: { title: { startsWith: TEST_PREFIX } }, select: { id: true } }),
        tx.salesActivity.findMany({ where: { subject: { startsWith: TEST_PREFIX } }, select: { id: true } }),
        tx.salesNote.findMany({ where: { body: { startsWith: "TEST note:" } }, select: { id: true } }),
      ]);

      const L = {
        org: orgRows.map((r) => r.id),
        person: personRows.map((r) => r.id),
        lead: leadRows.map((r) => r.id),
        deal: dealRows.map((r) => r.id),
        activity: activityRows.map((r) => r.id),
        note: noteRows.map((r) => r.id),
      };
      // Custom field values have no name of their own: every value on a TEST deal or lead counts as listed.
      const listedValues = await tx.salesCustomFieldValue.findMany({
        where: { OR: [{ dealId: { in: L.deal } }, { leadId: { in: L.lead } }] },
        select: { id: true },
      });
      const listedValueIds = listedValues.map((r) => r.id);

      const listedKeys = new Set<string>([
        ...L.org.map((id) => `org:${id}`),
        ...L.person.map((id) => `person:${id}`),
        ...L.lead.map((id) => `lead:${id}`),
        ...L.deal.map((id) => `deal:${id}`),
        ...L.activity.map((id) => `activity:${id}`),
        ...L.note.map((id) => `note:${id}`),
        ...listedValueIds.map((id) => `value:${id}`),
      ]);

      // --- Look at every row that is listed or points at something listed ---
      const [deals, leads, people, orgs, activities, notes, files, values] = await Promise.all([
        tx.salesDeal.findMany({
          where: { OR: [{ id: { in: L.deal } }, { personId: { in: L.person } }, { organizationId: { in: L.org } }] },
          select: { id: true, personId: true, organizationId: true },
        }),
        tx.salesLead.findMany({
          where: {
            OR: [
              { id: { in: L.lead } },
              { personId: { in: L.person } },
              { organizationId: { in: L.org } },
              { convertedDealId: { in: L.deal } },
            ],
          },
          select: { id: true, personId: true, organizationId: true, convertedDealId: true },
        }),
        tx.salesPerson.findMany({
          where: { OR: [{ id: { in: L.person } }, { organizationId: { in: L.org } }] },
          select: { id: true, organizationId: true },
        }),
        tx.salesOrganization.findMany({ where: { id: { in: L.org } }, select: { id: true } }),
        tx.salesActivity.findMany({
          where: {
            OR: [
              { id: { in: L.activity } },
              { dealId: { in: L.deal } },
              { leadId: { in: L.lead } },
              { personId: { in: L.person } },
            ],
          },
          select: { id: true, dealId: true, leadId: true, personId: true },
        }),
        tx.salesNote.findMany({
          where: {
            OR: [
              { id: { in: L.note } },
              { dealId: { in: L.deal } },
              { leadId: { in: L.lead } },
              { personId: { in: L.person } },
              { organizationId: { in: L.org } },
            ],
          },
          select: { id: true, dealId: true, leadId: true, personId: true, organizationId: true },
        }),
        tx.salesFile.findMany({
          where: { OR: [{ dealId: { in: L.deal } }, { leadId: { in: L.lead } }] },
          select: { id: true, dealId: true, leadId: true },
        }),
        tx.salesCustomFieldValue.findMany({
          where: { OR: [{ id: { in: listedValueIds } }, { dealId: { in: L.deal } }, { leadId: { in: L.lead } }] },
          select: { id: true, dealId: true, leadId: true },
        }),
      ]);

      const nodes: Node[] = [
        ...orgs.map((r) => ({ key: `org:${r.id}`, kind: "org" as const, refs: [], primary: null })),
        ...people.map((r) => ({ key: `person:${r.id}`, kind: "person" as const, refs: compact([k("org", r.organizationId)]), primary: null })),
        ...deals.map((r) => ({
          key: `deal:${r.id}`,
          kind: "deal" as const,
          refs: compact([k("person", r.personId), k("org", r.organizationId)]),
          primary: null,
        })),
        ...leads.map((r) => ({
          key: `lead:${r.id}`,
          kind: "lead" as const,
          refs: compact([k("person", r.personId), k("org", r.organizationId), k("deal", r.convertedDealId)]),
          primary: null,
        })),
        ...activities.map((r) => ({
          key: `activity:${r.id}`,
          kind: "activity" as const,
          refs: compact([k("deal", r.dealId), k("lead", r.leadId), k("person", r.personId)]),
          primary: k("deal", r.dealId) ?? k("lead", r.leadId) ?? k("person", r.personId),
        })),
        ...notes.map((r) => ({
          key: `note:${r.id}`,
          kind: "note" as const,
          refs: compact([k("deal", r.dealId), k("lead", r.leadId), k("person", r.personId), k("org", r.organizationId)]),
          primary: k("deal", r.dealId) ?? k("lead", r.leadId) ?? k("person", r.personId) ?? k("org", r.organizationId),
        })),
        ...files.map((r) => ({
          key: `file:${r.id}`,
          kind: "file" as const,
          refs: compact([k("deal", r.dealId), k("lead", r.leadId)]),
          primary: k("deal", r.dealId) ?? k("lead", r.leadId),
        })),
        ...values.map((r) => ({
          key: `value:${r.id}`,
          kind: "value" as const,
          refs: compact([k("deal", r.dealId), k("lead", r.leadId)]),
          primary: k("deal", r.dealId) ?? k("lead", r.leadId),
        })),
      ].map((n) => ({ ...n, listed: listedKeys.has(n.key) }));
      const byKey = new Map(nodes.map((n) => [n.key, n]));

      // --- Decide what goes: start with the list, then keep whatever the database would refuse to lose ---
      const deleting = new Set<string>();
      for (const n of nodes) {
        if (n.listed) {
          deleting.add(n.key);
        } else if (includeAdded && ["activity", "note", "file", "value"].includes(n.kind)) {
          if (n.refs.every((r) => listedKeys.has(r))) deleting.add(n.key);
        }
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of nodes) {
          if (!deleting.has(n.key)) {
            for (const r of n.refs) {
              if (deleting.delete(r)) changed = true;
            }
          }
          if (
            deleting.has(n.key) &&
            n.primary &&
            byKey.has(n.primary) &&
            !deleting.has(n.primary) &&
            n.kind !== "person" &&
            n.kind !== "org" &&
            n.kind !== "deal" &&
            n.kind !== "lead"
          ) {
            deleting.delete(n.key);
            changed = true;
          }
        }
      }

      const count = (kind: Kind) => nodes.filter((n) => n.kind === kind && deleting.has(n.key)).length;
      const ids = (kind: Kind) =>
        nodes.filter((n) => n.kind === kind && deleting.has(n.key)).map((n) => n.key.slice(kind.length + 1));
      const keptListed = (kind: Kind) => nodes.filter((n) => n.kind === kind && n.listed && !deleting.has(n.key)).length;
      const notListedAndStaying = nodes.filter(
        (n) =>
          !n.listed &&
          !deleting.has(n.key) &&
          ["activity", "note", "file", "value"].includes(n.kind) &&
          n.refs.some((r) => listedKeys.has(r)),
      );

      if (!dryRun) {
        await tx.salesCustomFieldValue.deleteMany({ where: { id: { in: ids("value") } } });
        await tx.salesFile.deleteMany({ where: { id: { in: ids("file") } } });
        await tx.salesActivity.deleteMany({ where: { id: { in: ids("activity") } } });
        await tx.salesNote.deleteMany({ where: { id: { in: ids("note") } } });
        await tx.salesLead.deleteMany({ where: { id: { in: ids("lead") } } });
        await tx.salesDeal.deleteMany({ where: { id: { in: ids("deal") } } });
        await tx.salesPerson.deleteMany({ where: { id: { in: ids("person") } } });
        await tx.salesOrganization.deleteMany({ where: { id: { in: ids("org") } } });
      }

      return {
        removed: {
          organizations: count("org"),
          people: count("person"),
          leads: count("lead"),
          deals: count("deal"),
          activities: count("activity"),
          notes: count("note"),
          files: count("file"),
          customFieldValues: count("value"),
        },
        kept: {
          organizations: keptListed("org"),
          people: keptListed("person"),
          leads: keptListed("lead"),
          deals: keptListed("deal"),
        },
        addedStaying: notListedAndStaying.length,
        dryRun,
        includeAdded,
      };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}
