import { prisma } from "@/lib/prisma";
import { TRACKING_LABEL_MAX } from "@/lib/calls/tracking-label-limits";

/**
 * Names for tracking numbers ("Direct Mail", "Google Ads"), so the Calls page
 * can show what a number is next to the number itself.
 *
 * HighLevel does not hand these names over with the permissions the sync
 * token has, so people type each one once. A name is saved per client (a
 * number belongs to a client's own HighLevel account). Naming a number from
 * the main Calls page names it for every client the person can see that has
 * calls on that number.
 */

export { TRACKING_LABEL_MAX };

type Actor = { userId: string; isAdmin: boolean; allClientsAccess: boolean };

export type ParsedTrackingLabelInput =
  | { ok: true; number: string; label: string }
  | { ok: false; error: string };

/** Checks what the browser sent. An empty name is allowed and means "remove the name". */
export function parseTrackingLabelInput(body: unknown): ParsedTrackingLabelInput {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a tracking number and a name." };
  const { number, label } = body as { number?: unknown; label?: unknown };

  if (typeof number !== "string") return { ok: false, error: "Choose a tracking number." };
  const cleanNumber = number.trim();
  if (cleanNumber.length < 4 || cleanNumber.length > 32 || !/^[+\d][\d+\-() ]*$/.test(cleanNumber)) {
    return { ok: false, error: "That doesn't look like a phone number." };
  }

  if (label !== undefined && label !== null && typeof label !== "string") {
    return { ok: false, error: "The name must be text." };
  }
  const cleanLabel = (label ?? "")
    .toString()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleanLabel.length > TRACKING_LABEL_MAX) {
    return { ok: false, error: `Names can be up to ${TRACKING_LABEL_MAX} characters.` };
  }

  return { ok: true, number: cleanNumber, label: cleanLabel };
}

export type SetTrackingLabelResult =
  | { ok: true; clients: number; removed: boolean }
  | { ok: false; status: 404; error: string };

/**
 * Saves (or, with an empty name, removes) the name for one tracking number on
 * every client the person can see that has calls on it.
 */
export async function setTrackingLabel(args: {
  actor: Actor;
  number: string;
  label: string;
}): Promise<SetTrackingLabelResult> {
  const { actor, number, label } = args;

  let allowedClientIds: string[] | null = null;
  if (!actor.isAdmin && !actor.allClientsAccess) {
    const rows = await prisma.clientAccess.findMany({
      where: { teamMemberId: actor.userId },
      select: { clientId: true },
    });
    allowedClientIds = rows.map((r) => r.clientId);
  }

  const withCalls = await prisma.highLevelCallSummary.findMany({
    where: {
      trackingNumber: number,
      ...(allowedClientIds !== null ? { clientId: { in: allowedClientIds } } : {}),
    },
    distinct: ["clientId"],
    select: { clientId: true },
  });
  if (withCalls.length === 0) {
    return { ok: false, status: 404, error: "No calls found on that number." };
  }
  const clientIds = withCalls.map((c) => c.clientId);

  if (label === "") {
    await prisma.highLevelTrackingNumber.deleteMany({ where: { number, clientId: { in: clientIds } } });
    return { ok: true, clients: clientIds.length, removed: true };
  }

  await prisma.$transaction(
    clientIds.map((clientId) =>
      prisma.highLevelTrackingNumber.upsert({
        where: { clientId_number: { clientId, number } },
        create: { clientId, number, label },
        update: { label },
      }),
    ),
  );
  return { ok: true, clients: clientIds.length, removed: false };
}
