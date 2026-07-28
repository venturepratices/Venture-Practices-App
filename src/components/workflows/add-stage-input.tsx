"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Appends a new stage to a live workflow instance's stagesSnapshot. Existing
 * stage names are passed in so the PATCH can send the full replacement array
 * (the route takes a full-array replace, not a single-stage insert) without
 * this component needing to know anything about tasks/task counts.
 */
export function AddStageInput({ instanceId, existingStages }: { instanceId: string; existingStages: { name: string; description: string | null }[] }) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);

    const response = await fetch(`/api/workflows/${instanceId}/stages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stages: [...existingStages, { name: trimmed, description: null }] }),
    });

    if (response.ok) {
      setName("");
      setIsAdding(false);
      startTransition(() => router.refresh());
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't add that stage.");
    }
  }

  if (!isAdding) {
    return (
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setIsAdding(true)}>
        <Plus className="size-4" />
        Add stage
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsAdding(false);
            setName("");
          }
        }}
        placeholder="Stage name..."
        disabled={isPending}
        className="w-56"
      />
      <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
        Add
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setIsAdding(false);
          setName("");
        }}
      >
        Cancel
      </Button>
      {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
