"use client";

import { useEffect, useState } from "react";

import type { BotActivityItem } from "@/lib/sales/bots-screen";
import { botActivityRequest } from "@/lib/sales/bots-client";
import { describeActivity, whenText } from "@/lib/sales/bots-view-model";
import { MUTED } from "@/components/sales/bot-card";

// A bot's last 20 actions from the Sales history log, in plain words, loaded
// when the admin opens it. Never shows what the bot wrote, only what it did.

type State = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; items: BotActivityItem[] };

export function BotActivity({ botId }: { botId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void botActivityRequest(botId).then((result) => {
      if (!live) return;
      setState(result.ok ? { kind: "ready", items: result.data.activity } : { kind: "error", error: result.error });
    });
    return () => {
      live = false;
    };
  }, [botId]);

  return (
    <div className="rounded-[10px] border px-3 py-2" aria-live="polite" aria-busy={state.kind === "loading"}>
      <h4 className="m-0 mb-1 text-[13px] font-semibold">Recent activity</h4>
      {state.kind === "loading" ? <p className={`${MUTED} m-0`}>Loading...</p> : null}
      {state.kind === "error" ? <p className="m-0 text-[13px] text-destructive">{state.error}</p> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <p className={`${MUTED} m-0`}>Nothing yet. Every change this bot makes will show here.</p>
      ) : null}
      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {state.items.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-x-3">
              <span>{describeActivity(item)}</span>
              <time dateTime={item.at} className={MUTED}>
                {whenText(item.at)}
              </time>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
