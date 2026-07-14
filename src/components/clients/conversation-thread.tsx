"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

import { cn, formatDateTime } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string;
  ghlTimestamp: string;
};

// One email in the thread — collapsed to subject + a one-line preview by
// default; click to reveal the full body. "What we're after is the details,
// but only when asked for" — this is the click-to-expand piece of that.
function EmailMessageCard({ message }: { message: ThreadMessage }) {
  const [expanded, setExpanded] = useState(false);
  const inbound = message.direction === "inbound";

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="w-full rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="size-3.5 shrink-0" />
        <span className={inbound ? "text-emerald-600" : "text-sky-600"}>{inbound ? "Received" : "Sent"}</span>
        <span>·</span>
        <span>{formatDateTime(message.ghlTimestamp)}</span>
      </div>
      <p className="mt-0.5 truncate text-sm font-medium">{message.subject || "(no subject)"}</p>
      {expanded ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">
          {message.body || <span className="italic text-muted-foreground">(no text content)</span>}
        </p>
      ) : (
        <p className="truncate text-sm text-muted-foreground">{message.body || "(no text content)"}</p>
      )}
    </button>
  );
}

// SMS (and anything else bucketed non-Email) — a classic chat bubble, always
// fully shown since these are already short lean text.
function SmsBubble({ message }: { message: ThreadMessage }) {
  const inbound = message.direction === "inbound";
  return (
    <div className={cn("flex", inbound ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
          inbound ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.body || "(no text content)"}</p>
        <p className={cn("mt-1 text-[10px]", inbound ? "text-muted-foreground" : "text-primary-foreground/70")}>
          {formatDateTime(message.ghlTimestamp)}
        </p>
      </div>
    </div>
  );
}

// The open conversation for one contact — SMS and Email interleaved
// chronologically, each rendered per its own type.
export function ConversationDetailThread({
  contactName,
  messages,
}: {
  contactName: string | null;
  messages: ThreadMessage[];
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-muted/40 px-4 py-2 text-sm font-medium">
        {contactName ?? "Unknown contact"}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m) =>
          m.channel === "Email" ? (
            <EmailMessageCard key={m.id} message={m} />
          ) : (
            <SmsBubble key={m.id} message={m} />
          )
        )}
      </div>
    </div>
  );
}
