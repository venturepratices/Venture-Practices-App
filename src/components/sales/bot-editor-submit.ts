import type { BotView } from "@/lib/sales/bots-screen";
import { createBotRequest, updateBotRequest } from "@/lib/sales/bots-client";
import { type BotDraft, createBody, updateBody } from "@/lib/sales/bots-view-model";

// Sends the bot form. On create the new key is handed straight to the screen
// (memory only) before anything else happens, so a later failure cannot lose it.

export type SavedBot = { botId: string; botName: string; secret: string | null };
export type MadeKeyHandler = (saved: SavedBot) => void;

/** Returns a plain error message, or null when it worked (and `onSaved` was called). */
export async function createBodyRequestSafe(
  mode: "create" | "edit",
  draft: BotDraft,
  password: string,
  bot: BotView | undefined,
  onSaved: MadeKeyHandler,
): Promise<string | null> {
  if (mode === "create") {
    const result = await createBotRequest(createBody(draft, password));
    if (!result.ok) return result.error;
    onSaved({ botId: result.data.bot.id, botName: result.data.bot.name, secret: result.data.secret });
    return null;
  }
  if (!bot) return "This bot is gone. Refresh the page.";
  const body = updateBody(draft, bot);
  if (!body) return "Nothing changed.";
  // The password goes only with a change that gives the bot more power.
  const result = await updateBotRequest(bot.id, password ? { ...body, password } : body);
  if (!result.ok) return result.error;
  onSaved({ botId: bot.id, botName: bot.name, secret: null });
  return null;
}
