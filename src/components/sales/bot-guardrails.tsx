import { Plug, ShieldCheck } from "lucide-react";

import { BOT_SCOPE_ENDPOINTS } from "@/lib/sales/bot-endpoints";
import { BOT_CAPS, BOT_KEY_MAX_DAYS, BOT_LIMITS, BOT_SCOPE_CATALOGUE } from "@/lib/sales/bot-scopes";
import { BODY, CARD, CardHeader, MUTED } from "@/components/sales/bot-card";

// The two read-only cards under the bot list: what every bot can never do,
// and how a bot connects. The connect panel never shows a real key, only the
// shape of the header.

const n = (value: number) => value.toLocaleString("en-US");

export function BotGuardrails() {
  return (
    <section className={CARD} aria-labelledby="bot-guardrails">
      <CardHeader icon={ShieldCheck} id="bot-guardrails">
        Guardrails
      </CardHeader>
      <ul className={`${BODY} m-0 flex list-disc flex-col gap-1.5 pl-8`}>
        <li>A bot can never delete, export or change settings. Those permissions do not exist.</li>
        <li>
          At most {BOT_LIMITS.perMinute} calls a minute and {n(BOT_LIMITS.perDay)} a day per bot. A bot that keeps going over, or keeps asking
          for things it may not do, is turned off by the app, and admins are told.
        </li>
        <li>A bot only does what its permissions allow, only for the person it works for, only in the pipelines you pick.</li>
        <li>You can turn it off at any time, with one click. It stops at once.</li>
        <li>Every action is logged, and every call by its key is kept for 90 days.</li>
        <li>
          Keys last {BOT_KEY_MAX_DAYS} days at most. At most {BOT_CAPS.perPerson} bots per person and {BOT_CAPS.total} in total.
        </li>
      </ul>
    </section>
  );
}

export function BotConnectPanel({ appUrl }: { appUrl: string | null }) {
  const base = appUrl ?? "https://<this app's web address>";
  return (
    <section className={CARD} aria-labelledby="bot-connect">
      <CardHeader icon={Plug} id="bot-connect">
        How to connect a bot
      </CardHeader>
      <div className={`${BODY} flex flex-col gap-3`}>
        <p className="m-0 font-semibold">This part is for whoever sets up the bot.</p>
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5">
          <li>Make the bot here, with only the permissions it needs. Copy its key when it is shown, once.</li>
          <li>Paste the key straight into the bot&apos;s own secret store. Never into chat, email, Slack or a doc.</li>
          <li>
            The bot sends the key in a header on every call: <code className="break-all font-mono text-[12.5px]">Authorization: Bearer &lt;key&gt;</code>
          </li>
          <li>
            Make one test call, then reload this page. The bot should show &quot;Used a minute ago&quot; and a calls-today count.
            Recent activity lists only changes the bot makes, so a read-only bot shows nothing there.
          </li>
        </ol>
        <div>
          <h3 className="m-0 text-[13.5px] font-semibold">What a bot can call, per permission</h3>
          <p className={MUTED}>Web address: {base}. Everything else in the app refuses a bot key.</p>
          <dl className="m-0 mt-2 flex flex-col gap-2">
            {BOT_SCOPE_ENDPOINTS.map((group) => (
              <div key={group.scope}>
                <dt className="text-[13px] font-semibold">{BOT_SCOPE_CATALOGUE[group.scope].label}</dt>
                {group.endpoints.map((e) => (
                  <dd key={`${e.method} ${e.path}`} className="m-0 text-[12.5px]">
                    {e.what}: <code className="break-all font-mono">{e.method} {base}{e.path}</code>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
