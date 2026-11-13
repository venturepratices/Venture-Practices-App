"use client";

import { Component, useId, useRef, useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";

import { copyMessage } from "@/lib/sales/bots-view-model";
import { Button } from "@/components/ui/button";
import { BODY, CARD, CardHeader, TOUCH, WARN } from "@/components/sales/bot-card";

// The one-time key box. The key lives only in this component's props (React
// memory): never in storage, the address bar or a toast. Copy can fail (no
// permission, not a secure page); then the key is selected so it can be copied
// by hand. The box closes only after "I have saved it" is ticked.

export function BotKeyReveal({ secret, botName, onDone }: { secret: string; botName: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const keyRef = useRef<HTMLElement>(null);
  const savedId = useId();

  function selectKey() {
    const el = keyRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!el || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(secret);
      setMessage(copyMessage(true));
    } catch {
      selectKey();
      setMessage(copyMessage(false));
    }
  }

  return (
    <section className={`${CARD} border-primary/40`} aria-labelledby="bot-key-title">
      <CardHeader icon={KeyRound} id="bot-key-title">
        Save the key for {botName} now
      </CardHeader>
      <div className={`${BODY} flex flex-col gap-3`}>
        <p className="m-0">
          This is the only time you will see it. Paste it straight into the bot&apos;s secret store. Never into chat, email, Slack, a doc or a
          screenshot.
        </p>
        <code
          ref={keyRef}
          tabIndex={0}
          onFocus={selectKey}
          className="block select-all break-all rounded-[10px] border bg-muted px-3 py-2.5 font-mono text-[13px]"
        >
          {secret}
        </code>
        <p className="m-0 min-h-5 text-[13px]" aria-live="polite">
          {message}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={copy} className={TOUCH}>
            Copy key
          </Button>
          <label htmlFor={savedId} className={`flex items-center gap-2 text-[13.5px] ${TOUCH}`}>
            <input id={savedId} type="checkbox" className="size-5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I have saved it
          </label>
          <Button type="button" disabled={!saved} onClick={onDone} className={`ml-auto ${TOUCH}`}>
            Done
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Shown when a key was made but the box could not be drawn. The key cannot be shown again. */
export function RevealFailed({ botName }: { botName: string }) {
  return (
    <div role="alert" className={`${WARN} flex gap-2`}>
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="m-0">
        A key was made for {botName}, but the screen could not show it, and it cannot be shown again. Use Rotate key on {botName} to get a new
        one. The old one stops working at once.
      </p>
    </div>
  );
}

/** Catches a failure while drawing the key box, so the admin is told instead of losing the key silently. */
export class RevealGuard extends Component<{ botName: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <RevealFailed botName={this.props.botName} /> : this.props.children;
  }
}
