import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isPrismaError } from "@/lib/prisma-errors";
import { auditDiff, recordSalesAudit, requestMeta } from "@/lib/sales/audit";
import {
  adminActor,
  BOT_PUBLIC_SELECT,
  botAuditView,
  checkBotTarget,
  hasNoPipelines,
  resolveBotScopes,
  rotateBotSchema,
  toPublicBot,
  updateBotSchema,
} from "@/lib/sales/bot-admin";
import {
  checkAdminPassword,
  expiryFrom,
  NO_PIPELINES,
  PASSWORD_NEEDED,
  PAUSED_MESSAGE,
  ROTATE_FIRST,
  WRONG_PASSWORD,
} from "@/lib/sales/bot-admin-checks";
import { alertAdmins } from "@/lib/sales/bot-alerts";
import { botsEnabled } from "@/lib/sales/bot-guard";
import { generateBotSecret } from "@/lib/sales/bot-tokens";
import { assertSameOrigin, failResponse } from "@/lib/sales/http";

type Context = { params: Promise<{ botId: string }> };

const NOT_FOUND = { error: "Bot not found." };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A bot deleted between the lookup and the update (P2025) is just "not found". */
function nullIfDeleted(error: unknown): null {
  if (isPrismaError(error, "P2025")) return null;
  throw error;
}

/**
 * Admin: turn a bot on or off, or change its role, scopes, pipelines, deal rule
 * or expiry. Turning off is one click; turning on or changing the expiry needs
 * the admin's password, and turning on is refused while bot keys are paused.
 */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const { botId } = await params;

    const parsed = updateBotSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return bad("Invalid input");
    const change = parsed.data;
    const { scopes, error } = resolveBotScopes(change);
    if (error) return bad(error);

    const before = await prisma.botToken.findUnique({ where: { id: botId }, select: BOT_PUBLIC_SELECT });
    if (!before) return NextResponse.json(NOT_FOUND, { status: 404 });

    const turningOn = change.enabled === true && !before.enabled;
    if (turningOn && !botsEnabled()) return bad(PAUSED_MESSAGE, 403);
    if (turningOn && before.mustRotate) return bad(ROTATE_FIRST);
    if (turningOn || change.expiresInDays !== undefined) {
      if (!change.password) return bad(PASSWORD_NEEDED);
      if (!(await checkAdminPassword(admin.userId, change.password))) return bad(WRONG_PASSWORD, 403);
    }

    const allPipelines = change.allPipelines ?? before.allPipelines;
    const pipelineKeys = allPipelines ? [] : (change.pipelineKeys ?? before.pipelineKeys);
    if (hasNoPipelines(allPipelines, pipelineKeys)) return bad(NO_PIPELINES);
    const problem = await checkBotTarget({ pipelineKeys: change.pipelineKeys });
    if (problem) return bad(problem);

    const bot = await prisma
      .$transaction(async (tx) => {
        const row = await tx.botToken.update({
          where: { id: botId },
          data: {
            enabled: change.enabled,
            scopes,
            pipelineKeys,
            allPipelines,
            ownDealsOnly: change.ownDealsOnly,
            expiresAt: change.expiresInDays === undefined ? undefined : expiryFrom(new Date(), change.expiresInDays),
            ...(turningOn ? { offReason: null, offAt: null } : {}),
          },
          select: BOT_PUBLIC_SELECT,
        });
        const diff = auditDiff(botAuditView(before), botAuditView(row));
        if (change.expiresInDays !== undefined) diff.after = { ...diff.after, expiresAt: row.expiresAt?.toISOString() };
        if (Object.keys(diff.after).length > 0) {
          await recordSalesAudit(
            tx,
            adminActor(admin),
            { entityType: "BotToken", entityId: botId, action: "updated", ...diff },
            requestMeta(request),
          );
        }
        return row;
      })
      .catch(nullIfDeleted);
    if (!bot) return NextResponse.json(NOT_FOUND, { status: 404 });
    if (turningOn) await alertAdmins(bot, `The bot "${bot.name}" was turned back on.`);

    return NextResponse.json({ bot: toPublicBot(bot) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Admin: `?action=rotate` swaps in a new key, after the password. The old one stops working at once. */
export async function POST(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const { botId } = await params;

    if (new URL(request.url).searchParams.get("action") !== "rotate") return bad("Unknown action.");
    if (!botsEnabled()) return bad(PAUSED_MESSAGE, 403);
    const parsed = rotateBotSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return bad(PASSWORD_NEEDED);
    const existing = await prisma.botToken.findUnique({ where: { id: botId }, select: { id: true } });
    if (!existing) return NextResponse.json(NOT_FOUND, { status: 404 });
    if (!(await checkAdminPassword(admin.userId, parsed.data.password))) return bad(WRONG_PASSWORD, 403);

    const { secret, hash, last4 } = generateBotSecret();
    const rotatedAt = new Date();
    const expiresAt = expiryFrom(rotatedAt, parsed.data.expiresInDays);
    const bot = await prisma
      .$transaction(async (tx) => {
        const row = await tx.botToken.update({
          where: { id: botId },
          data: { tokenHash: hash, tokenLast4: last4, rotatedAt, expiresAt, mustRotate: false, expiryWarnedAt: null },
          select: BOT_PUBLIC_SELECT,
        });
        await recordSalesAudit(
          tx,
          adminActor(admin),
          // ISO strings, the form Json stores, rather than Dates for Prisma to convert.
          {
            entityType: "BotToken",
            entityId: botId,
            action: "rotated",
            after: { rotatedAt: rotatedAt.toISOString(), expiresAt: expiresAt.toISOString() },
          },
          requestMeta(request),
        );
        return row;
      })
      .catch(nullIfDeleted);
    if (!bot) return NextResponse.json(NOT_FOUND, { status: 404 });
    await alertAdmins(bot, `The key of the bot "${bot.name}" was rotated. The old key no longer works.`);

    return NextResponse.json({ bot: toPublicBot(bot), secret }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Admin: deletes a bot and its key for good. Its history rows stay. No password: deleting only lowers risk. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const { botId } = await params;

    const before = await prisma.botToken.findUnique({ where: { id: botId }, select: BOT_PUBLIC_SELECT });
    if (!before) return NextResponse.json(NOT_FOUND, { status: 404 });
    const done = await prisma
      .$transaction(async (tx) => {
        await tx.botToken.delete({ where: { id: botId } });
        await recordSalesAudit(
          tx,
          adminActor(admin),
          { entityType: "BotToken", entityId: botId, action: "deleted", before: botAuditView(before) },
          requestMeta(request),
        );
        return true;
      })
      .catch(nullIfDeleted);
    if (!done) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
