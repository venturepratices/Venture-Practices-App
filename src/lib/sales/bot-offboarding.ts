import { prisma } from "@/lib/prisma";

// Offboarding for bot keys: when a person loses Sales access (and is not an
// admin), every bot that works for them is turned off at once. The key check
// would refuse them anyway on every call; this makes it visible on the Bots
// screen and keeps them off if the access ever comes back.

export async function turnOffBotsWithoutAccess(
  member: { id: string; isAdmin: boolean; canUseSales: boolean },
  now = new Date(),
): Promise<void> {
  if (member.isAdmin || member.canUseSales) return;
  await prisma.botToken.updateMany({
    where: { actingForId: member.id, enabled: true },
    data: { enabled: false, offReason: "the person it works for lost access.", offAt: now },
  });
}
