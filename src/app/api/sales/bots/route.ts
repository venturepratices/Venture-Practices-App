import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { recordSalesAudit, requestMeta } from "@/lib/sales/audit";
import {
  adminActor,
  BOT_PUBLIC_SELECT,
  botAuditView,
  checkBotTarget,
  createBotSchema,
  resolveBotScopes,
  toPublicBot,
} from "@/lib/sales/bot-admin";
import { generateBotSecret } from "@/lib/sales/bot-tokens";
import { assertSameOrigin, failResponse } from "@/lib/sales/http";

/** Admin: every bot key, with only the last 4 characters of each key. */
export async function GET() {
  try {
    await requireAdmin();
    const bots = await prisma.botToken.findMany({ select: BOT_PUBLIC_SELECT, orderBy: { createdAt: "asc" } });
    return NextResponse.json({ bots: bots.map(toPublicBot) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Admin: makes a bot key. The key is in this response and nowhere else, ever. */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);

    const parsed = createBotSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const { scopes, error } = resolveBotScopes(parsed.data);
    if (error || !scopes) {
      return NextResponse.json({ error: error ?? "Choose a role or a list of scopes." }, { status: 400 });
    }
    const pipelineKeys = parsed.data.pipelineKeys ?? [];
    const problem = await checkBotTarget({ actingForId: parsed.data.actingForId, pipelineKeys });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const { secret, hash, last4 } = generateBotSecret();
    const bot = await prisma.$transaction(async (tx) => {
      const row = await tx.botToken.create({
        data: {
          name: parsed.data.name,
          actingForId: parsed.data.actingForId,
          scopes,
          pipelineKeys,
          tokenHash: hash,
          tokenLast4: last4,
          createdById: admin.userId,
        },
        select: BOT_PUBLIC_SELECT,
      });
      await recordSalesAudit(
        tx,
        adminActor(admin),
        { entityType: "BotToken", entityId: row.id, action: "created", after: botAuditView(row) },
        requestMeta(request),
      );
      return row;
    });

    return NextResponse.json(
      { bot: toPublicBot(bot), secret },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
