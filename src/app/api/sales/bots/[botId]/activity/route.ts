import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { loadBotActivity } from "@/lib/sales/bots-screen";

type Context = { params: Promise<{ botId: string }> };

/** Admin: the last 20 things this bot did (from the Sales history log), newest first. Never the key. */
export async function GET(_request: Request, { params }: Context) {
  try {
    await requireAdmin();
    const { botId } = await params;
    const activity = await loadBotActivity(botId);
    if (!activity) return NextResponse.json({ error: "Bot not found." }, { status: 404 });
    return NextResponse.json({ activity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
