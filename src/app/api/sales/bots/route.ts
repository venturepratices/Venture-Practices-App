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
  hasNoPipelines,
  resolveBotScopes,
  toPublicBot,
} from "@/lib/sales/bot-admin";
import {
  verifyAdminPassword,
  checkBotCaps,
  expiryFrom,
  NO_PIPELINES,
  PAUSED_MESSAGE,
} from "@/lib/sales/bot-admin-checks";
import { alertAdmins } from "@/lib/sales/bot-alerts";
import { botsEnabled } from "@/lib/sales/bot-guard";
import { generateBotSecret } from "@/lib/sales/bot-tokens";
import { assertSameOrigin, failResponse } from "@/lib/sales/http";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

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

/**
 * Admin: makes a bot key, after the admin types their password again. The key
 * is in this response and nowhere else, ever. Refused while bot keys are paused.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    if (!botsEnabled()) return bad(PAUSED_MESSAGE, 403);

    const parsed = createBotSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return bad("Invalid input");
    const { scopes, error } = resolveBotScopes(parsed.data);
    if (error || !scopes) return bad(error ?? "Choose a role or a list of scopes.");
    const pipelineKeys = parsed.data.pipelineKeys ?? [];
    const allPipelines = parsed.data.allPipelines ?? false;
    if (hasNoPipelines(allPipelines, pipelineKeys)) return bad(NO_PIPELINES);
    const pw = await verifyAdminPassword(admin.userId, parsed.data.password);
    if (!pw.ok) return bad(pw.error, pw.status);
    const problem =
      (await checkBotTarget({ actingForId: parsed.data.actingForId, pipelineKeys })) ??
      (await checkBotCaps(parsed.data.actingForId));
    if (problem) return bad(problem);

    const { secret, hash, last4 } = generateBotSecret();
    const bot = await prisma.$transaction(async (tx) => {
      const row = await tx.botToken.create({
        data: {
          name: parsed.data.name,
          actingForId: parsed.data.actingForId,
          scopes,
          pipelineKeys: allPipelines ? [] : pipelineKeys,
          allPipelines,
          ownDealsOnly: parsed.data.ownDealsOnly ?? true,
          expiresAt: expiryFrom(new Date(), parsed.data.expiresInDays),
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
    await alertAdmins(bot, `A new bot key was made: "${bot.name}". If you did not expect this, turn it off.`);

    return NextResponse.json(
      { bot: toPublicBot(bot), secret },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
