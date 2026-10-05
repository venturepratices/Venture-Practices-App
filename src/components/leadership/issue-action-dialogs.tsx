"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";
import { todayDateString } from "@/lib/utils";

type Option = { id: string; name: string };

function oneWeekOut(): string {
  const today = new Date(`${todayDateString()}T12:00:00Z`);
  return new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function postJson(url: string, body: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.error ?? "Something went wrong.";
}

// "Turn into task" — due date defaults to one week out (EOS: an issue's
// to-do should be done by next week's meeting).
export function IssueToTaskDialog({
  open,
  onOpenChange,
  issueId,
  teamMembers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueId: string;
  teamMembers: Option[];
  onDone: () => void;
}) {
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState(oneWeekOut);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (assigneeIds.length === 0) {
      setError("Pick who's doing it.");
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await postJson(`/api/issues/${issueId}/convert-task`, { assigneeIds, deadline });
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setAssigneeIds([]);
    setDeadline(oneWeekOut());
    onOpenChange(false);
    onDone();
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
          <DialogTitle>Turn into task</DialogTitle>
          <DialogDescription>Creates a real task. The issue stays on the list until you mark it solved.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Who&apos;s doing it?</Label>
          <TaskAssigneesPicker teamMembers={teamMembers} value={assigneeIds} onChange={setAssigneeIds} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="issue-task-deadline">Due</Label>
          <Input
            id="issue-task-deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full sm:w-48"
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={saving || !deadline}>
            {saving ? "Creating..." : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Make it a Rock" — for an issue too big to fix in a week; becomes a
// 90-day priority in the current quarter.
export function IssueToRockDialog({
  open,
  onOpenChange,
  issueId,
  leadershipMembers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueId: string;
  leadershipMembers: Option[];
  onDone: () => void;
}) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isCompany, setIsCompany] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameById = new Map(leadershipMembers.map((m) => [m.id, m.name]));

  async function confirm() {
    if (!ownerId) {
      setError("Pick who owns this Rock.");
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await postJson(`/api/issues/${issueId}/make-rock`, { ownerId, isCompany });
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setOwnerId(null);
    setIsCompany(false);
    onOpenChange(false);
    onDone();
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
          <DialogTitle>Make it a Rock</DialogTitle>
          <DialogDescription>Adds it to this quarter&apos;s Rocks. You can add the &quot;Done when&quot; on the Rocks page.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Owner</Label>
          <Select value={ownerId ?? ""} onValueChange={(v) => setOwnerId(v || null)}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue>{(v: string) => nameById.get(v) ?? "Pick an owner"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {leadershipMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isCompany} onCheckedChange={(checked) => setIsCompany(checked === true)} />
          Company Rock (the whole team&apos;s priority, not just the owner&apos;s)
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={saving}>
            {saving ? "Adding..." : "Add Rock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
