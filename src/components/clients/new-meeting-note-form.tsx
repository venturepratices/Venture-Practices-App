"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MentionItem } from "@/components/ui/mention-list";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { stripHtml } from "@/lib/text-format";

export function NewMeetingNoteForm({ clientId, teamMembers }: { clientId: string; teamMembers: MentionItem[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transcript, setTranscript] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim() && meetingDate && stripHtml(transcript).trim() && !isPosting;

  async function submit() {
    if (!canSubmit) return;
    setIsPosting(true);
    setError(null);
    const response = await fetch(`/api/clients/${clientId}/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), meetingDate, transcript: transcript.trim() }),
    });
    setIsPosting(false);
    if (response.ok) {
      setTitle("");
      setTranscript("");
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Something went wrong");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Meeting title (e.g. Magnolia - Weekly Sync)"
          className="sm:flex-1"
        />
        <Input
          type="date"
          value={meetingDate}
          onChange={(event) => setMeetingDate(event.target.value)}
          className="sm:w-40"
        />
      </div>
      <RichTextEditor
        content={transcript}
        onChange={setTranscript}
        teamMembers={teamMembers}
        placeholder="Paste the Fathom transcript here, or type your own notes... type @ to mention someone"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          {isPosting ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
