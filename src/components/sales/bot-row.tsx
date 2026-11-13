"use client";

import { useState } from "react";

import type { BotView } from "@/lib/sales/bots-screen";
import {
  callsTodayText,
  expiryInfo,
  lastUsedText,
  permissionSummary,
  pipelinesText,
  roleLabel,
  statusInfo,
} from "@/lib/sales/bots-view-model";
import { cn } from "@/lib/utils";
import { MUTED, NOTE, WARN } from "@/components/sales/bot-card";
import { BotActivity } from "@/components/sales/bot-activity";
import { BotRowActions, type RowCallbacks } from "@/components/sales/bot-row-actions";

// One bot in the list: who it works for, its role and permissions in plain
// words, where it may work, the key ending, last use, calls today, expiry and
// its on/off state (with the app's reason when the app turned it off).

export function BotRow({
  bot,
  pipelines,
  now,
  ...callbacks
}: { bot: BotView; pipelines: { key: string; name: string }[]; now: string; keyBlocked?: string | null } & RowCallbacks) {
  const [showActivity, setShowActivity] = useState(false);
  const status = statusInfo(bot);
  const expiry = expiryInfo(bot.expiresAt, now);

  return (
    <li className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 min-w-0 break-words text-[15px] font-semibold [overflow-wrap:anywhere]">{bot.name}</h3>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium",
            status.on ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground",
          )}
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", status.on ? "bg-emerald-600" : "border border-current")} />
          {status.label}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 text-[13px]">
        <span>
          Works for {bot.actingFor.name} &middot; {roleLabel(bot.scopes)} &middot; {pipelinesText(bot, pipelines)}
        </span>
        <span className={MUTED}>{permissionSummary(bot.scopes)}</span>
        <span className={MUTED}>
          {bot.ownDealsOnly ? `Only ${bot.actingFor.name}'s own deals and leads` : `Everything ${bot.actingFor.name} can see`}
        </span>
        <span className={MUTED}>
          Key ending in <span className="font-mono">{bot.keyLast4}</span> &middot; {lastUsedText(bot.lastUsedAt, now)} &middot; {callsTodayText(bot.callsToday)}
        </span>
        {expiry.warn ? <p className={cn(WARN, "m-0 mt-1")}>{expiry.text}</p> : <span className={MUTED}>{expiry.text}</span>}
        {status.reason ? <p className={cn(NOTE, "m-0 mt-1")}>{status.reason}</p> : null}
      </div>
      <BotRowActions bot={bot} {...callbacks} showActivity={showActivity} onToggleActivity={() => setShowActivity((v) => !v)} />
      {showActivity ? <BotActivity botId={bot.id} /> : null}
    </li>
  );
}
