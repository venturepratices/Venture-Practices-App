"use client";

import { useRef, useState } from "react";

import type { BotView } from "@/lib/sales/bots-screen";
import { deleteBotRequest, rotateBotRequest, updateBotRequest } from "@/lib/sales/bots-client";
import { deleteStep, submitGate } from "@/lib/sales/bot-screen-state";
import { Button } from "@/components/ui/button";
import { TOUCH, WARN } from "@/components/sales/bot-card";
import { PasswordConfirm } from "@/components/sales/bot-password-confirm";

// A bot's buttons. Turning off is one click. Turning on and rotating ask for
// the admin's password in a small inline box (rotate also warns that the old
// key stops at once). Delete asks to confirm. The new key from a rotate goes
// straight to the screen's one-time reveal.

export type RowCallbacks = {
  onEdit: (bot: BotView) => void;
  onChanged: (message: string) => void;
  onKey: (saved: { botId: string; botName: string; secret: string }) => void;
  /** Why making a new key is off right now (a key on screen, or bot keys switched off), or null. */
  keyBlocked?: string | null;
};

type Ask = null | "on" | "rotate" | "delete";

export function BotRowActions({
  bot,
  onEdit,
  onChanged,
  onKey,
  keyBlocked = null,
  showActivity,
  onToggleActivity,
}: { bot: BotView; showActivity: boolean; onToggleActivity: () => void } & RowCallbacks) {
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request at a time, even for a double click before the screen updates.
  const gate = useRef(submitGate());

  async function run(work: () => Promise<string | null>) {
    if (!gate.current.start()) return;
    setBusy(true);
    setError(null);
    const failure = await work();
    gate.current.finish();
    setBusy(false);
    if (failure) setError(failure);
    else setAsk(null);
  }

  const turnOff = () =>
    run(async () => {
      const r = await updateBotRequest(bot.id, { enabled: false });
      if (!r.ok) return r.error;
      onChanged(`${bot.name} is off. Its key stopped working.`);
      return null;
    });
  const turnOn = (password: string) =>
    run(async () => {
      const r = await updateBotRequest(bot.id, { enabled: true, password });
      if (!r.ok) return r.error;
      onChanged(`${bot.name} is on again.`);
      return null;
    });
  const rotate = (password: string) =>
    run(async () => {
      // Never a second key while one is on screen, even if a disabled button is bypassed.
      if (keyBlocked) return keyBlocked;
      const r = await rotateBotRequest(bot.id, password);
      if (!r.ok) return r.error;
      onKey({ botId: bot.id, botName: bot.name, secret: r.data.secret });
      return null;
    });
  const remove = () =>
    run(async () => {
      // Only from the inline confirm.
      if (deleteStep(ask === "delete" ? "asking" : "idle", "confirm") !== "deleting") return null;
      const r = await deleteBotRequest(bot.id);
      if (!r.ok) return r.error;
      onChanged(`${bot.name} was deleted. Its key no longer works.`);
      return null;
    });

  return (
    <div className="flex flex-col gap-2" aria-busy={busy}>
      <div className="flex flex-wrap gap-2">
        {bot.enabled ? (
          <Button type="button" variant="outline" disabled={busy} onClick={turnOff} className={TOUCH}>Turn off</Button>
        ) : (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk("on")} className={TOUCH}>Turn on</Button>
        )}
        <Button type="button" variant="outline" disabled={busy} onClick={() => onEdit(bot)} className={TOUCH}>Edit</Button>
        <Button type="button" variant="outline" disabled={busy || Boolean(keyBlocked)} onClick={() => setAsk("rotate")} className={TOUCH}>Make a new key</Button>
        <Button type="button" variant="outline" aria-expanded={showActivity} onClick={onToggleActivity} className={TOUCH}>Recent activity</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => setAsk("delete")} className={TOUCH}>Delete</Button>
      </div>
      {keyBlocked ? <p className="m-0 text-[12.5px] text-muted-foreground">{keyBlocked}</p> : null}
      {ask === "on" ? (
        <PasswordConfirm label={`Turn ${bot.name} back on`} busy={busy} onCancel={() => setAsk(null)} onConfirm={turnOn} />
      ) : null}
      {ask === "rotate" && !keyBlocked ? (
        <PasswordConfirm
          label="Make the new key"
          warning={`The old key stops working at once. ${bot.name} will need the new key before its next call.`}
          busy={busy}
          onCancel={() => setAsk(null)}
          onConfirm={rotate}
        />
      ) : null}
      {ask === "delete" ? (
        <div className={`${WARN} flex flex-wrap items-center gap-2`} role="group" aria-label={`Delete ${bot.name}`}>
          <span className="flex-1">Delete {bot.name} for good? Its key stops working at once. Its history stays.</span>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk(null)} className={TOUCH}>Keep it</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={remove} className={TOUCH}>Delete bot</Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
