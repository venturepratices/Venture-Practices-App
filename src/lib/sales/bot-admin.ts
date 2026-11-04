import { z } from "zod";

import type { Permissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import { BOT_ROLE_PRESETS, BOT_ROLES, BOT_SCOPES, BOT_SECRET_PREFIX, type BotScope } from "@/lib/sales/bot-scopes";

// Shared by the admin Bots routes (src/app/api/sales/bots/**). The key's hash is
// never selected here, so it can't end up in a response or a history row.

export const BOT_PUBLIC_SELECT = {
  id: true,
  name: true,
  actingForId: true,
  actingFor: { select: { id: true, name: true } },
  scopes: true,
  pipelineKeys: true,
  tokenLast4: true,
  enabled: true,
  createdById: true,
  createdAt: true,
  lastUsedAt: true,
  rotatedAt: true,
} as const;

type PublicBotRow = {
  id: string;
  name: string;
  actingForId: string;
  scopes: string[];
  pipelineKeys: string[];
  tokenLast4: string;
  enabled: boolean;
};

/** What the Bots screen gets: the last 4 characters of the key, never more. */
export function toPublicBot<T extends PublicBotRow>(row: T) {
  const { tokenLast4, ...rest } = row;
  return { ...rest, maskedKey: `${BOT_SECRET_PREFIX}••••${tokenLast4}` };
}

/** The fields a history row records for a bot: no key, no hash, no last 4. */
export function botAuditView(row: PublicBotRow) {
  return {
    name: row.name,
    actingForId: row.actingForId,
    scopes: row.scopes,
    pipelineKeys: row.pipelineKeys,
    enabled: row.enabled,
  };
}

/** The admin managing bots, as the actor on their history rows. */
export function adminActor(perms: Permissions): SalesActor {
  return { userId: perms.userId, isAdmin: true, seesAllDeals: true, via: "user" };
}

const accessFields = {
  role: z.enum(BOT_ROLES).optional(),
  scopes: z.array(z.enum(BOT_SCOPES)).min(1).optional(),
  pipelineKeys: z
    .array(z.string().trim().min(1))
    .max(50)
    .transform((keys) => [...new Set(keys)])
    .optional(),
};

export const createBotSchema = z.object({
  name: z.string().trim().min(1).max(80),
  actingForId: z.string().min(1),
  ...accessFields,
});

export const updateBotSchema = z
  .object({ enabled: z.boolean().optional(), ...accessFields })
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: "Nothing to change." });

/**
 * A role picks a preset; a scope list is used as given (once each, standard
 * order). Undefined when neither was sent, an error when both were.
 */
export function resolveBotScopes(input: {
  role?: keyof typeof BOT_ROLE_PRESETS;
  scopes?: BotScope[];
}): { scopes?: BotScope[]; error?: string } {
  if (input.role && input.scopes) return { error: "Choose a role or a list of scopes, not both." };
  if (input.role) return { scopes: [...BOT_ROLE_PRESETS[input.role]] };
  if (input.scopes) return { scopes: BOT_SCOPES.filter((scope) => input.scopes!.includes(scope)) };
  return {};
}

/** Error message when the person or a pipeline is not allowed, else null. */
export async function checkBotTarget(input: { actingForId?: string; pipelineKeys?: string[] }): Promise<string | null> {
  if (input.actingForId !== undefined) {
    const person = await prisma.teamMember.findFirst({
      where: { id: input.actingForId, ...SALES_MEMBER_WHERE },
      select: { id: true },
    });
    if (!person) return "Choose a team member with Sales access.";
  }
  if (input.pipelineKeys?.length) {
    const found = await prisma.salesPipeline.findMany({ where: { key: { in: input.pipelineKeys } }, select: { key: true } });
    const known = new Set(found.map((p) => p.key));
    const missing = input.pipelineKeys.filter((key) => !known.has(key));
    if (missing.length) return `Unknown pipeline: ${missing.join(", ")}.`;
  }
  return null;
}
