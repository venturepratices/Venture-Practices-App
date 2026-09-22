"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Deliberately minimal — just a title — unlike the full NewTaskInput (client,
// assignees, occurrence, etc). A private task has no client and is always
// assigned to its own creator, so none of that applies; richer editing (if
// ever needed) still happens from the task's own detail panel, same as any
// other task.
export function PrivateTaskQuickAdd({ currentUserId, privateProjectId }: { currentUserId: string; privateProjectId?: string | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          isPrivate: true,
          assigneeIds: [currentUserId],
          privateProjectId: privateProjectId ?? null,
        }),
      });
      if (res.ok) {
        setTitle("");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New private task"
        disabled={pending}
        className="h-8 min-w-[160px] flex-1"
      />
      <Button size="sm" type="submit" disabled={!title.trim() || pending}>
        <Plus className="size-4" />
        Add task
      </Button>
    </form>
  );
}
