"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";

export function ConvertToTaskDialog({
  open,
  onOpenChange,
  itemId,
  teamMembers,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  teamMembers: { id: string; name: string }[];
  onConverted: () => void;
}) {
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    // Matches the API's own guard — no assignee, no task. Checked here too so
    // the message shows inline without a round-trip.
    if (assigneeIds.length === 0) {
      setError("Assign this to someone to turn it into a task.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const response = await fetch(`/api/planning-items/${itemId}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeIds }),
    });
    setIsSubmitting(false);
    if (response.ok) {
      setAssigneeIds([]);
      onOpenChange(false);
      onConverted();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't convert this idea.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to task</DialogTitle>
          <DialogDescription>Assign this idea to at least one person to turn it into a real, visible task.</DialogDescription>
        </DialogHeader>
        <TaskAssigneesPicker teamMembers={teamMembers} value={assigneeIds} onChange={setAssigneeIds} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={isSubmitting}>
            {isSubmitting ? "Converting..." : "Convert to task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
