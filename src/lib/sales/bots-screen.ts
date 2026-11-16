// What the Bots screen shows on load: every bot (key ending only, never the key
// or its hash), today's call count per bot, the Sales members a bot may work
// for, the pipelines, and whether bot keys are switched on. Plus one bot's
// recent activity from the Sales history log. Reads the database only.

import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";
import { BOT_PUBLIC_SELECT, toPublicBot } from "@/lib/sales/bot-admin";
import { windowStarts } from "@/lib/sales/bot-counters";
import { botsEnabled } from "@/lib/sales/bot-guard";

export type BotView = {
  id: string;
  name: string;
  actingFor: { id: string; name: string };
  scopes: string[];
  pipelineKeys: string[];
  allPipelines: boolean;
  ownDealsOnly: boolean;
  keyLast4: string;
  enabled: boolean;
  mustRotate: boolean;
  offReason: string | null;
  offAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  rotatedAt: string | null;
  expiresAt: string | null;
  callsToday: number;
};

export type BotsScreenData = {
  bots: BotView[];
  members: { id: string; name: string }[];
  pipelines: { key: string; name: string }[];
  botsEnabled: boolean;
  /** The app's web address, for the "How to connect" panel; null when not set. */
  appUrl: string | null;
  /** The server's clock when this was read, so time words match on server and browser. */
  now: string;
};

export type BotActivityItem = {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Only the reason the app turned the bot off; never the content the bot wrote. */
  detail: string | null;
};

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

type PublicRow = ReturnType<typeof toPublicBot<Awaited<ReturnType<typeof loadRows>>[number]>>;

function loadRows() {
  return prisma.botToken.findMany({ select: BOT_PUBLIC_SELECT, orderBy: { createdAt: "asc" } });
}

function toView(bot: PublicRow, callsToday: number): BotView {
  return {
    id: bot.id,
    name: bot.name,
    actingFor: { id: bot.actingFor.id, name: bot.actingFor.name },
    scopes: bot.scopes,
    pipelineKeys: bot.pipelineKeys,
    allPipelines: bot.allPipelines,
    ownDealsOnly: bot.ownDealsOnly,
    keyLast4: bot.maskedKey.slice(-4),
    enabled: bot.enabled,
    mustRotate: bot.mustRotate,
    offReason: bot.offReason,
    offAt: iso(bot.offAt),
    createdAt: bot.createdAt.toISOString(),
    lastUsedAt: iso(bot.lastUsedAt),
    lastUsedIp: bot.lastUsedIp,
    rotatedAt: iso(bot.rotatedAt),
    expiresAt: iso(bot.expiresAt),
    callsToday,
  };
}

export async function loadBotsScreen(
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<BotsScreenData> {
  const [rows, usage, members, pipelines] = await Promise.all([
    loadRows(),
    prisma.botTokenUsage.findMany({
      where: { kind: "day", windowStart: windowStarts(now).day },
      select: { tokenId: true, count: true },
    }),
    prisma.teamMember.findMany({ where: SALES_MEMBER_WHERE, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.salesPipeline.findMany({ select: { key: true, name: true }, orderBy: { position: "asc" } }),
  ]);
  const today = new Map(usage.map((u) => [u.tokenId, u.count]));
  return {
    bots: rows.map((row) => toView(toPublicBot(row), today.get(row.id) ?? 0)),
    members: members.map((m) => ({ id: m.id, name: m.name })),
    pipelines: pipelines.map((p) => ({ key: p.key, name: p.name })),
    botsEnabled: botsEnabled(env),
    appUrl: env.NEXT_PUBLIC_APP_URL?.trim() || null,
    now: now.toISOString(),
  };
}

/** The bot's last 20 history rows, newest first, or null when there is no such bot. */
export async function loadBotActivity(botId: string): Promise<BotActivityItem[] | null> {
  const bot = await prisma.botToken.findUnique({ where: { id: botId }, select: { id: true } });
  if (!bot) return null;
  const rows = await prisma.salesAuditLog.findMany({
    where: { botTokenId: botId },
    orderBy: { at: "desc" },
    take: 20,
    select: { id: true, at: true, action: true, entityType: true, entityId: true, after: true },
  });
  return rows.map((row) => {
    const after = row.after as { offReason?: unknown } | null;
    const detail = row.action === "auto_turned_off" && typeof after?.offReason === "string" ? after.offReason : null;
    return { id: row.id, at: row.at.toISOString(), action: row.action, entityType: row.entityType, entityId: row.entityId, detail };
  });
}
