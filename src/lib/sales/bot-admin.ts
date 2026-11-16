import { z } from "zod";

import type { Permissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import {
  BOT_KEY_DAY_CHOICES,
  BOT_ROLE_PRESETS,
  BOT_ROLES,
  BOT_SCOPES,
  BOT_SECRET_PREFIX,
  type BotScope,
  isCatalogueScope,
} from "@/lib/sales/bot-scopes";

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
  expiresAt: true,
  allPipelines: true,
  ownDealsOnly: true,
  mustRotate: true,
  offReason: true,
  offAt: true,
  lastUsedIp: true,
} as const;

type PublicBotRow = {
  id: string;
  name: string;
  actingForId: string;
  scopes: string[];
  pipelineKeys: string[];
  tokenLast4: string;
  enabled: boolean;
  allPipelines?: boolean;
  ownDealsOnly?: boolean;
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
    allPipelines: row.allPipelines,
    ownDealsOnly: row.ownDealsOnly,
    enabled: row.enabled,
  };
}

/** The admin managing bots, as the actor on their history rows. */
export function adminActor(perms: Permissions): SalesActor {
  return { userId: perms.userId, isAdmin: true, seesAllDeals: true, via: "user" };
}

// Every permission must be in the catalogue (bot-scopes.ts); anything else,
// such as "delete" or "export", is refused. Strict objects: an unknown field
// is refused too, so nothing like `isAdmin` or `tokenHash` can be slipped in.
const catalogueScope = z.string().refine(isCatalogueScope, { message: "Unknown permission." });

/** How long a key may last: only the choices the screen offers. */
const keyDays = z.union(BOT_KEY_DAY_CHOICES.map((days) => z.literal(days)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]);

const accessFields = {
  role: z.enum(BOT_ROLES).optional(),
  scopes: z.array(catalogueScope).min(1).optional(),
  pipelineKeys: z
    .array(z.string().trim().min(1))
    .max(50)
    .transform((keys) => [...new Set(keys)])
    .optional(),
  allPipelines: z.boolean().optional(),
  ownDealsOnly: z.boolean().optional(),
  expiresInDays: keyDays.optional(),
};

/** The admin's own password, typed again before a key is made, rotated or turned on. Never stored or logged. */
const password = z.string().min(1).max(200);

export const createBotSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  actingForId: z.string().min(1),
  ...accessFields,
  password,
});

export const updateBotSchema = z
  .strictObject({ enabled: z.boolean().optional(), ...accessFields, password: password.optional() })
  // The password alone is not a change.
  .refine(
    (data) => Object.entries(data).some(([key, value]) => key !== "password" && value !== undefined),
    { message: "Nothing to change." },
  );

export const rotateBotSchema = z.strictObject({
  password,
  expiresInDays: keyDays.optional(),
});

/** True when the bot would be left able to touch no pipeline at all. */
export function hasNoPipelines(allPipelines: boolean, pipelineKeys: readonly string[]): boolean {
  return !allPipelines && pipelineKeys.length === 0;
}

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
