"use client";

import { useId, useState } from "react";
import { Bot } from "lucide-react";

import type { BotView } from "@/lib/sales/bots-screen";
import { createBodyRequestSafe, type MadeKeyHandler } from "@/components/sales/bot-editor-submit";
import { BOT_KEY_DAY_CHOICES } from "@/lib/sales/bot-scopes";
import { type BotDraft, draftError, draftFromBot, emptyDraft } from "@/lib/sales/bots-view-model";
import { Button } from "@/components/ui/button";
import { BODY, CARD, CardHeader, TOUCH } from "@/components/sales/bot-card";
import { BotPermissions } from "@/components/sales/bot-permissions";
import { BotReachFields } from "@/components/sales/bot-reach-fields";

// The bot form, inline on the page (not a pop-up). Create: name, who it works
// for (Sales members only), role and permissions, pipelines, deal rule, how
// long the key lasts, and the admin's password. Edit: permissions and reach
// only; the name and person are fixed once a key exists.

const FIELD = "min-h-10 w-full rounded-lg border bg-background px-3 text-[14px] focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11";
const LABEL = "mb-1 block text-[13px] font-semibold";

type Props = {
  mode: "create" | "edit";
  bot?: BotView;
  members: { id: string; name: string }[];
  pipelines: { key: string; name: string }[];
  onCancel: () => void;
  onSaved: MadeKeyHandler;
};

export function BotEditor({ mode, bot, members, pipelines, onCancel, onSaved }: Props) {
  const [draft, setDraft] = useState<BotDraft>(() => (bot ? draftFromBot(bot) : emptyDraft()));
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const personName = members.find((m) => m.id === draft.actingForId)?.name ?? "the person";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = draftError(draft) ?? (mode === "create" && !password ? "Type your password to make the key." : null);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    const failure = await createBodyRequestSafe(mode, draft, password, bot, onSaved);
    setSaving(false);
    if (failure) setError(failure);
  }

  return (
    <section className={CARD} aria-labelledby={`${id}-title`}>
      <CardHeader icon={Bot} id={`${id}-title`}>
        {mode === "create" ? "New bot" : `Edit ${bot?.name}`}
      </CardHeader>
      <form onSubmit={submit} aria-busy={saving} className={`${BODY} flex flex-col gap-4`} noValidate>
        {mode === "create" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-name`} className={LABEL}>Name</label>
              <input id={`${id}-name`} className={FIELD} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${id}-person`} className={LABEL}>Works for</label>
              <select id={`${id}-person`} className={FIELD} value={draft.actingForId} onChange={(e) => setDraft({ ...draft, actingForId: e.target.value })}>
                <option value="">Pick a person with Sales access</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
        <BotPermissions draft={draft} onChange={setDraft} />
        <BotReachFields draft={draft} pipelines={pipelines} personName={personName} onChange={setDraft} />
        {mode === "create" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-days`} className={LABEL}>Key lasts</label>
              <select id={`${id}-days`} className={FIELD} value={draft.expiresInDays} onChange={(e) => setDraft({ ...draft, expiresInDays: Number(e.target.value) })}>
                {BOT_KEY_DAY_CHOICES.map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-pw`} className={LABEL}>Your password</label>
              <input id={`${id}-pw`} type="password" autoComplete="current-password" className={FIELD} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
        ) : null}
        <p role="alert" className="m-0 min-h-5 text-[13px] text-destructive">{error}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving} className={TOUCH}>Cancel</Button>
          <Button type="submit" disabled={saving} className={TOUCH}>
            {saving ? "Saving..." : mode === "create" ? "Make the key" : "Save changes"}
          </Button>
        </div>
      </form>
    </section>
  );
}
