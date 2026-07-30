"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function NewPlanningItemForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setIsPosting(true);
    const response = await fetch(`/api/clients/${clientId}/planning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed, description: description.trim() || null }),
    });
    setIsPosting(false);
    if (response.ok) {
      setTitle("");
      setDescription("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder="What's the idea?"
      />
      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Add more detail (optional)..."
        className="min-h-16 text-sm"
      />
      <Button size="sm" disabled={isPosting || !title.trim()} onClick={submit}>
        {isPosting ? "Adding..." : "Add idea"}
      </Button>
    </div>
  );
}
