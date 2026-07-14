"use client";

import { useState } from "react";
import { Mail, Phone, Voicemail } from "lucide-react";

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
// default; click to reveal the full body. Icon sits in its own fixed column
// so the meta row, subject, and body all share ONE left edge (the previous
// version put the icon inline with the meta row only, so subject/body — which
// start flush with the card edge — looked staggered/misaligned under it).
function EmailMessageCard({ message }: { message: ThreadMessage }) {
  const [expanded, setExpanded] = useState(false);
  const inbound = message.direction === "inbound";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
      }}
      className="flex w-full cursor-pointer gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
    >
      <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className={inbound ? "text-emerald-600" : "text-sky-600"}>{inbound ? "Received" : "Sent"}</span>
          <span className="shrink-0">{formatDateTime(message.ghlTimestamp)}</span>
        </div>
        <p className={cn("text-sm font-medium", !expanded && "truncate")}>{message.subject || "(no subject)"}</p>
        {expanded ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
            {message.body || <span className="italic text-muted-foreground">(no text content)</span>}
          </p>
        ) : (
          <p className="truncate text-sm text-muted-foreground">{message.body || "(no text content)"}</p>
        )}
      </div>
    </div>
  );
}

// A call or voicemail — shown as a compact system-style line (not a chat
// bubble or card, since it's an event rather than something someone wrote),
// matching how HighLevel's own conversation view treats calls inline.
function CallEventLine({ message }: { message: ThreadMessage }) {
  const inbound = message.direction === "inbound";
  const Icon = message.channel === "Voicemail" ? Voicemail : Phone;
  return (
    <div className="flex justify-center py-1">
      <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span>
          {inbound ? "Inbound" : "Outbound"} {message.channel.toLowerCase()}
          {message.body ? ` · ${message.body}` : ""}
        </span>
        <span>·</span>
        <span>{formatDateTime(message.ghlTimestamp)}</span>
      </div>
    </div>
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
        {messages.map((m) => {
          if (m.channel === "Email") return <EmailMessageCard key={m.id} message={m} />;
          if (m.channel === "Call" || m.channel === "Voicemail") return <CallEventLine key={m.id} message={m} />;
          return <SmsBubble key={m.id} message={m} />;
        })}
      </div>
    </div>
  );
}
