import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { auditDiff, recordSalesAudit } from "@/lib/sales/audit";
import {
  adminActor,
  BOT_PUBLIC_SELECT,
  botAuditView,
  checkBotTarget,
  resolveBotScopes,
  toPublicBot,
  updateBotSchema,
} from "@/lib/sales/bot-admin";
import { generateBotSecret } from "@/lib/sales/bot-tokens";

type Context = { params: Promise<{ botId: string }> };

const NOT_FOUND = { error: "Bot not found." };

/** Admin: turn a bot on or off, or change its role, scopes or pipelines. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin();
    const { botId } = await params;

    const parsed = updateBotSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const { scopes, error } = resolveBotScopes(parsed.data);
    if (error) return NextResponse.json({ error }, { status: 400 });
    const problem = await checkBotTarget({ pipelineKeys: parsed.data.pipelineKeys });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const before = await prisma.botToken.findUnique({ where: { id: botId }, select: BOT_PUBLIC_SELECT });
    if (!before) return NextResponse.json(NOT_FOUND, { status: 404 });

    const bot = await prisma.$transaction(async (tx) => {
      const row = await tx.botToken.update({
        where: { id: botId },
        data: { enabled: parsed.data.enabled, scopes, pipelineKeys: parsed.data.pipelineKeys },
        select: BOT_PUBLIC_SELECT,
      });
      const diff = auditDiff(botAuditView(before), botAuditView(row));
      if (Object.keys(diff.after).length > 0) {
        await recordSalesAudit(tx, adminActor(admin), { entityType: "BotToken", entityId: botId, action: "updated", ...diff });
      }
      return row;
    });

    return NextResponse.json({ bot: toPublicBot(bot) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Admin: `?action=rotate` swaps in a new key. The old one stops working at once. */
export async function POST(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin();
    const { botId } = await params;

    if (new URL(request.url).searchParams.get("action") !== "rotate") {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const existing = await prisma.botToken.findUnique({ where: { id: botId }, select: { id: true } });
    if (!existing) return NextResponse.json(NOT_FOUND, { status: 404 });

    const { secret, hash, last4 } = generateBotSecret();
    const rotatedAt = new Date();
    const bot = await prisma.$transaction(async (tx) => {
      const row = await tx.botToken.update({
        where: { id: botId },
        data: { tokenHash: hash, tokenLast4: last4, rotatedAt },
        select: BOT_PUBLIC_SELECT,
      });
      await recordSalesAudit(tx, adminActor(admin), {
        entityType: "BotToken",
        entityId: botId,
        action: "rotated",
        after: { rotatedAt },
      });
      return row;
    });

    return NextResponse.json({ bot: toPublicBot(bot), secret }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
