"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Bot } from "lucide-react";

import type { BotsScreenData, BotView } from "@/lib/sales/bots-screen";
import { Button } from "@/components/ui/button";
import { CARD, CardHeader, MUTED, TOUCH, WARN } from "@/components/sales/bot-card";
import { BotEditor } from "@/components/sales/bot-editor";
import type { SavedBot } from "@/components/sales/bot-editor-submit";
import { BotConnectPanel, BotGuardrails } from "@/components/sales/bot-guardrails";
import { BotKeyReveal, RevealGuard } from "@/components/sales/bot-key-reveal";
import { BotRow } from "@/components/sales/bot-row";

// The Bots screen (admins only; the page gates it). Everything comes from the
// server; after a change the page data is read again with router.refresh().
// A new key is held in this component's memory only, shown once in the
// reveal box, and dropped when the admin says it is saved.

type Editing = null | { mode: "create" } | { mode: "edit"; bot: BotView };
type Reveal = { botId: string; botName: string; secret: string };

export function BotsView({ data }: { data: BotsScreenData }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [status, setStatus] = useState("");
  const [refreshing, startRefresh] = useTransition();

  const refresh = (message: string) => {
    setStatus(message);
    startRefresh(() => router.refresh());
  };
  const onSaved = (saved: SavedBot) => {
    // The key first, before anything else can fail.
    if (saved.secret) setReveal({ botId: saved.botId, botName: saved.botName, secret: saved.secret });
    setEditing(null);
    refresh(saved.secret ? `${saved.botName} is ready. Save its key below.` : `${saved.botName} was saved.`);
  };
  const onKey = (saved: Reveal) => {
    setReveal(saved);
    refresh(`${saved.botName} has a new key. The old one no longer works.`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <Link href="/sales/settings" className={`inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground ${TOUCH}`}>
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Sales settings
        </Link>
        <h1 className="m-0 text-[21px] font-semibold">Bots</h1>
        <p className="mt-1 max-w-[65ch] text-[13px] text-muted-foreground">
          Admins only. A bot key lets a helper app, such as Muse, work in Sales for one person, with only the permissions you give it.
        </p>
      </div>

      {!data.botsEnabled ? (
        <p className={`${WARN} m-0`} role="status">
          Bot keys are paused. No bot can call the app and no key can be made until bot keys are switched on in the hosting settings
          (SALES_BOTS_ENABLED). That happens only after the key checklist is done.
        </p>
      ) : null}

      <p className="sr-only" aria-live="polite">{status}</p>

      {reveal ? (
        <RevealGuard botName={reveal.botName}>
          <BotKeyReveal secret={reveal.secret} botName={reveal.botName} onDone={() => setReveal(null)} />
        </RevealGuard>
      ) : null}

      {editing ? (
        <BotEditor
          key={editing.mode === "edit" ? editing.bot.id : "new"}
          mode={editing.mode}
          bot={editing.mode === "edit" ? editing.bot : undefined}
          members={data.members}
          pipelines={data.pipelines}
          onCancel={() => setEditing(null)}
          onSaved={onSaved}
        />
      ) : null}

      <section className={CARD} aria-labelledby="bots-list" aria-busy={refreshing}>
        <CardHeader
          icon={Bot}
          id="bots-list"
          action={
            <Button type="button" onClick={() => setEditing({ mode: "create" })} disabled={editing?.mode === "create"} className={TOUCH}>
              New bot
            </Button>
          }
        >
          Your bots
        </CardHeader>
        {data.bots.length === 0 ? (
          <div className="px-4 py-6 text-[13.5px]">
            <p className="m-0 font-semibold">No bots yet</p>
            <p className={`${MUTED} m-0 mt-1 max-w-[60ch]`}>
              Make one when a helper app needs to read or add to Sales for someone. Start with Read only; you can give it more later.
            </p>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y p-0">
            {data.bots.map((bot) => (
              <BotRow
                key={bot.id}
                bot={bot}
                pipelines={data.pipelines}
                now={data.now}
                onEdit={(b) => setEditing({ mode: "edit", bot: b })}
                onChanged={refresh}
                onKey={onKey}
              />
            ))}
          </ul>
        )}
        {refreshing ? <p className={`${MUTED} m-0 border-t px-4 py-2`}>Updating the list...</p> : null}
      </section>

      <BotGuardrails />
      <BotConnectPanel appUrl={data.appUrl} />
    </div>
  );
}
