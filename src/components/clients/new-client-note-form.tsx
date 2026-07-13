"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function NewClientNoteForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  async function submit() {
    if (!body.trim()) return;
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
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="What's the latest on this client? (e.g. summarize an email, call, or update)"
        className="min-h-20 text-sm"
      />
      <Button size="sm" disabled={isPosting || !body.trim()} onClick={submit}>
        {isPosting ? "Adding..." : "Add note"}
      </Button>
    </div>
  );
}
