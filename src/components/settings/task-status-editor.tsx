"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";

import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TaskStatusOption = {
  id: string;
  label: string;
  tone: string;
  sequenceNumber: number;
  isComplete: boolean;
};

const TONE_OPTIONS: { value: StatusTone; label: string }[] = [
  { value: "success", label: "Success (green)" },
  { value: "warning", label: "Warning (amber)" },
  { value: "danger", label: "Danger (red)" },
  { value: "neutral", label: "Neutral (gray)" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "teal", label: "Teal" },
  { value: "sky", label: "Sky" },
  { value: "slate", label: "Slate" },
];

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error) || fallback;
}

export function TaskStatusEditor({ initialOptions }: { initialOptions: TaskStatusOption[] }) {
  const router = useRouter();
  const [options, setOptions] = useState(initialOptions);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newTone, setNewTone] = useState<StatusTone>("neutral");
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ option: TaskStatusOption; tasksInUse: number } | null>(null);
  const [replacementId, setReplacementId] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  function sync(next: TaskStatusOption[]) {
    setOptions([...next].sort((a, b) => a.sequenceNumber - b.sequenceNumber));
  }

  async function handleRename(option: TaskStatusOption, label: string) {
    if (!label.trim() || label === option.label) return;
    setPendingId(option.id);
    setError(null);
    try {
      const res = await fetch(`/api/task-statuses/${option.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to rename status."));
        return;
      }
      const updated = await res.json();
      sync(options.map((o) => (o.id === option.id ? updated : o)));
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function handleRetone(option: TaskStatusOption, tone: StatusTone) {
    setPendingId(option.id);
    setError(null);
    try {
      const res = await fetch(`/api/task-statuses/${option.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to recolor status."));
        return;
      }
      const updated = await res.json();
      sync(options.map((o) => (o.id === option.id ? updated : o)));
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function handleMove(option: TaskStatusOption, direction: -1 | 1) {
    const sorted = [...options].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const index = sorted.findIndex((o) => o.id === option.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const other = sorted[swapIndex];

    setPendingId(option.id);
    setError(null);
    try {
      const [res1, res2] = await Promise.all([
        fetch(`/api/task-statuses/${option.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequenceNumber: other.sequenceNumber }),
        }),
        fetch(`/api/task-statuses/${other.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequenceNumber: option.sequenceNumber }),
        }),
      ]);
      if (!res1.ok || !res2.ok) {
        setError("Failed to reorder statuses.");
        return;
      }
      const [updated1, updated2] = await Promise.all([res1.json(), res2.json()]);
      sync(
        options.map((o) => {
          if (o.id === updated1.id) return updated1;
          if (o.id === updated2.id) return updated2;
          return o;
        }),
      );
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function handleAdd() {
    if (!newLabel.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/task-statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), tone: newTone }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to add status."));
        return;
      }
      const created = await res.json();
      sync([...options, created]);
      setNewLabel("");
      setNewTone("neutral");
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  async function requestDelete(option: TaskStatusOption) {
    setError(null);
    const res = await fetch(`/api/task-statuses/${option.id}`, { method: "DELETE" });
    if (res.ok) {
      sync(options.filter((o) => o.id !== option.id));
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => null);
    if (res.status === 400 && body && typeof body.tasksInUse === "number") {
      setDeleteTarget({ option, tasksInUse: body.tasksInUse });
      setReplacementId("");
      return;
    }
    setError((body && body.error) || "Failed to delete status.");
  }

  async function confirmDeleteWithReplacement() {
    if (!deleteTarget || !replacementId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/task-statuses/${deleteTarget.option.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacementId }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to delete status."));
        return;
      }
      sync(options.filter((o) => o.id !== deleteTarget.option.id));
      setDeleteTarget(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  const sorted = [...options].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <div className="divide-y rounded-lg border">
        {sorted.map((option, index) => (
          <div key={option.id} className="flex items-center gap-3 p-3">
            <div className="flex flex-col">
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={index === 0 || pendingId === option.id || option.isComplete}
                onClick={() => handleMove(option, -1)}
                aria-label="Move up"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={index === sorted.length - 1 || pendingId === option.id || option.isComplete}
                onClick={() => handleMove(option, 1)}
                aria-label="Move down"
              >
                <ArrowDown className="size-3.5" />
              </Button>
            </div>

            <StatusPillBase tone={option.tone as StatusTone} label={option.label} className="shrink-0" />

            {option.isComplete ? (
              <Tooltip>
                <TooltipTrigger render={<span className="flex flex-1 items-center gap-2 text-sm text-muted-foreground" />}>
                  <Lock className="size-3.5" />
                  {option.label} — protected, wired into workflow completion
                </TooltipTrigger>
                <TooltipContent>This status can't be renamed, recolored, reordered, or deleted.</TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Input
                  defaultValue={option.label}
                  className="h-8 max-w-56 flex-1"
                  disabled={pendingId === option.id}
                  onBlur={(e) => handleRename(option, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                <Select
                  value={option.tone}
                  onValueChange={(value) => handleRetone(option, value as StatusTone)}
                  disabled={pendingId === option.id}
                >
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pendingId === option.id}
                  onClick={() => requestDelete(option)}
                  aria-label={`Delete ${option.label}`}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3">
        <Input
          placeholder="New status name"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="h-8 max-w-56 flex-1"
        />
        <Select value={newTone} onValueChange={(v) => setNewTone(v as StatusTone)}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleAdd} disabled={!newLabel.trim() || adding}>
          <Plus className="size-4" />
          Add status
        </Button>
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move tasks before deleting</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${deleteTarget.tasksInUse} task${deleteTarget.tasksInUse === 1 ? " is" : "s are"} still set to "${deleteTarget.option.label}". Choose a status to move them to.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <Select value={replacementId} onValueChange={(value) => setReplacementId(value ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a replacement status" />
            </SelectTrigger>
            <SelectContent>
              {options
                .filter((o) => o.id !== deleteTarget?.option.id)
                .map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!replacementId || deleting} onClick={confirmDeleteWithReplacement}>
              Move tasks and delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
