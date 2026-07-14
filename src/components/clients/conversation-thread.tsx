import { formatDateTime } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string;
  ghlTimestamp: string;
};

// One contact's conversation, rendered as a card of chronological messages.
export function ConversationThread({
  contactName,
  messages,
}: {
  contactName: string | null;
  messages: ThreadMessage[];
}) {
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-muted/40 px-4 py-2 text-sm font-medium">{contactName ?? "Unknown contact"}</div>
      <ul className="divide-y">
        {messages.map((m) => {
          const inbound = m.direction === "inbound";
          return (
            <li key={m.id} className="px-4 py-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">{m.channel}</span>
                <span className={inbound ? "text-emerald-600" : "text-sky-600"}>
                  {inbound ? "Received" : "Sent"}
                </span>
                <span>·</span>
                <span>{formatDateTime(m.ghlTimestamp)}</span>
              </div>
              {m.subject ? <p className="text-sm font-medium">{m.subject}</p> : null}
              <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                {m.body || <span className="italic text-muted-foreground">(no text content)</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
