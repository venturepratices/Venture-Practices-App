"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PlanningStatusPill } from "@/components/planning/planning-status-pill";

const CREATABLE_STATUSES = ["IDEA", "STRATEGY"] as const;

export function NewPlanningItemForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("IDEA");
  const [isPending, setIsPending] = useState(false);

  function resetFields() {
    setTitle("");
    setDescription("");
    setStatus("IDEA");
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setIsPending(true);
    const response = await fetch(`/api/clients/${clientId}/planning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed, description: description.trim() || null, status }),
    });
    setIsPending(false);
    if (response.ok) {
      resetFields();
      router.refresh();
    }
  }

  function cancel() {
    setIsAdding(false);
    resetFields();
  }

  if (!isAdding) {
    return (
      <Button type="button" size="sm" className="gap-1.5" onClick={() => setIsAdding(true)}>
        <Plus className="size-4" />
        Add idea
      </Button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
        }}
        placeholder="What's the idea?"
        disabled={isPending}
      />

      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Add more detail (optional)..."
        disabled={isPending}
        className="min-h-16 text-sm"
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={(value) => value && setStatus(value)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue>{(value: string) => <PlanningStatusPill status={value} />}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CREATABLE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <PlanningStatusPill status={s} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !title.trim()}>
          Add idea
        </Button>
      </div>
    </form>
  );
}
