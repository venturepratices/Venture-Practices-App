"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import type { MentionItem } from "@/components/ui/mention-list";
import { stripHtml } from "@/lib/text-format";

export function NewClientNoteForm({ clientId, teamMembers }: { clientId: string; teamMembers: MentionItem[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  async function submit() {
    if (!stripHtml(body).trim()) return;
    setIsPosting(true);
    const response = await fetch(`/api/clients/${clientId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim() }),
    });
    setIsPosting(false);
    if (response.ok) {
      setBody("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <RichTextEditor
        content={body}
        onChange={setBody}
        teamMembers={teamMembers}
        placeholder="Summarize an email, call, or update... type @ to mention someone"
      />
      <Button size="sm" disabled={isPosting || !stripHtml(body).trim()} onClick={submit}>
        {isPosting ? "Saving..." : "Add note"}
      </Button>
    </div>
  );
}
