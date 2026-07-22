"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

type Props = {
  clientId: string;
  meetingNote: {
    id: string;
    title: string;
    meetingDate: string | Date;
    transcript: string;
    summary: string;
    author: { name: string } | null;
  };
};

export function MeetingNoteItem({ clientId, meetingNote }: Props) {
  const router = useRouter();
  const [showTranscript, setShowTranscript] = useState(false);

  async function remove() {
    if (!window.confirm("Delete this meeting note? This can't be undone.")) return;
    const response = await fetch(`/api/clients/${clientId}/meetings/${meetingNote.id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{meetingNote.title}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(meetingNote.meetingDate).toLocaleDateString()}
            {meetingNote.author?.name ? ` · added by ${meetingNote.author.name}` : ""}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Delete meeting note" onClick={remove}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{meetingNote.summary}</div>

      <button
        type="button"
        onClick={() => setShowTranscript((value) => !value)}
        className="mt-2 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {showTranscript ? "Hide transcript" : "Show full transcript"}
      </button>
      {showTranscript ? (
        <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          {meetingNote.transcript}
        </p>
      ) : null}

      <p className="mt-1 text-xs text-muted-foreground/70">Added {formatDateTime(meetingNote.meetingDate)}</p>
    </div>
  );
}
