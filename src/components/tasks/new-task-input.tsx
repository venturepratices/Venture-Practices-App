"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  clientId?: string | null;
  assigneeId?: string | null;
};

export function NewTaskInput({ clientId, assigneeId }: Props) {
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;

    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed, clientId: clientId ?? null, assigneeId: assigneeId ?? null }),
    });

    if (response.ok) {
      setTitle("");
      startTransition(() => router.refresh());
    }
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Plus className="size-4 shrink-0 text-muted-foreground" />
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a task and press Enter..."
        disabled={isPending}
        className="border-none px-0 shadow-none focus-visible:ring-0"
      />
    </form>
  );
}
