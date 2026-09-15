"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { StatusPillBase } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/settings/color-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Same editable-list pattern as TaskStatusEditor (rename/recolor/reorder,
// delete-requires-replacement-if-in-use), minus the isComplete-protected row
// — no priority level is wired into anything that requires protecting one.

type PriorityLevelOption = {
  id: string;
  label: string;
  color: string;
  sequenceNumber: number;
  autoApplyDaysBeforeDue: number | null;
};

function parseDaysInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) return null;
  return parsed;
}

const DEFAULT_NEW_COLOR = "#71717a";
// Pre-filled the first time a level's auto-apply Switch is flipped on, so
// turning it on always lands on a valid, immediately-meaningful threshold
// instead of an empty box.
const DEFAULT_AUTO_APPLY_DAYS = 7;

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error) || fallback;
}

export function PriorityLevelEditor({ initialOptions }: { initialOptions: PriorityLevelOption[] }) {
  const router = useRouter();
  const [options, setOptions] = useState(initialOptions);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_NEW_COLOR);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ option: PriorityLevelOption; tasksInUse: number } | null>(null);
  const [replacementId, setReplacementId] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  function sync(next: PriorityLevelOption[]) {
    setOptions([...next].sort((a, b) => a.sequenceNumber - b.sequenceNumber));
  }

  async function handleRename(option: PriorityLevelOption, label: string) {
    if (!label.trim() || label === option.label) return;
    setPendingId(option.id);
    setError(null);
    try {
      const res = await fetch(`/api/priority-levels/${option.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to rename priority level."));
        return;
      }
      const updated = await res.json();
      sync(options.map((o) => (o.id === option.id ? updated : o)));
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function handleRecolor(option: PriorityLevelOption, color: string) {
    setPendingId(option.id);
    setError(null);
    try {
      const res = await fetch(`/api/priority-levels/${option.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to recolor priority level."));
        return;
      }
      const updated = await res.json();
      sync(options.map((o) => (o.id === option.id ? updated : o)));
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function commitAutoApply(option: PriorityLevelOption, days: number | null) {
    if (days === option.autoApplyDaysBeforeDue) return;
    setPendingId(option.id);
    setError(null);
    try {
      const res = await fetch(`/api/priority-levels/${option.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApplyDaysBeforeDue: days }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to update auto-apply setting."));
        return;
      }
      const updated = await res.json();
      sync(options.map((o) => (o.id === option.id ? updated : o)));
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  // The Switch is the one and only way to turn a level's automation off —
  // typing into the days box never implicitly turns it off (an empty or
  // invalid entry just falls back to the last good value instead), so the
  // Switch's on/off state and "is a number actually configured" can never
  // drift out of sync with each other.
  async function handleAutoApplyInputChange(option: PriorityLevelOption, rawValue: string) {
    const parsed = parseDaysInput(rawValue);
    await commitAutoApply(option, parsed ?? option.autoApplyDaysBeforeDue ?? DEFAULT_AUTO_APPLY_DAYS);
  }

  async function handleAutoApplyToggle(option: PriorityLevelOption, checked: boolean) {
    await commitAutoApply(option, checked ? (option.autoApplyDaysBeforeDue ?? DEFAULT_AUTO_APPLY_DAYS) : null);
  }

  async function handleMove(option: PriorityLevelOption, direction: -1 | 1) {
    const sorted = [...options].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const index = sorted.findIndex((o) => o.id === option.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const other = sorted[swapIndex];

    setPendingId(option.id);
    setError(null);
    try {
      const [res1, res2] = await Promise.all([
        fetch(`/api/priority-levels/${option.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequenceNumber: other.sequenceNumber }),
        }),
        fetch(`/api/priority-levels/${other.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequenceNumber: option.sequenceNumber }),
        }),
      ]);
      if (!res1.ok || !res2.ok) {
        setError("Failed to reorder priority levels.");
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
      const res = await fetch("/api/priority-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), color: newColor }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to add priority level."));
        return;
      }
      const created = await res.json();
      sync([...options, created]);
      setNewLabel("");
      setNewColor(DEFAULT_NEW_COLOR);
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  async function requestDelete(option: PriorityLevelOption) {
    setError(null);
    const res = await fetch(`/api/priority-levels/${option.id}`, { method: "DELETE" });
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
    setError((body && body.error) || "Failed to delete priority level.");
  }

  async function confirmDeleteWithReplacement() {
    if (!deleteTarget || !replacementId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/priority-levels/${deleteTarget.option.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacementId }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res, "Failed to delete priority level."));
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

      <p className="text-xs text-muted-foreground">
        Turn on <b>auto-apply</b> on a level to have it apply itself once a task&apos;s deadline gets within a
        chosen number of days — e.g. 7 for Urgent. This only ever raises a task&apos;s priority, never lowers it: you
        can always set a task back down by hand, and it&apos;ll simply auto-raise again on the next daily check if
        the deadline is still inside the window.
      </p>

      <div className="divide-y rounded-lg border">
        {sorted.map((option, index) => (
          <div key={option.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex flex-col">
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={index === 0 || pendingId === option.id}
                onClick={() => handleMove(option, -1)}
                aria-label="Move up"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={index === sorted.length - 1 || pendingId === option.id}
                onClick={() => handleMove(option, 1)}
                aria-label="Move down"
              >
                <ArrowDown className="size-3.5" />
              </Button>
            </div>

            <StatusPillBase tone="neutral" color={option.color} label={option.label} className="shrink-0" />

            {/* Level identity (name + color) — kept visually separate from the
                auto-apply box below so it's unambiguous which control configures
                what the level looks like vs. when it applies itself. */}
            <div className="flex min-w-[180px] flex-1 items-center gap-2">
              <Input
                defaultValue={option.label}
                className="h-8 min-w-0 max-w-56 flex-1"
                disabled={pendingId === option.id}
                onBlur={(e) => handleRename(option, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <ColorPicker value={option.color} onCommit={(color) => handleRecolor(option, color)} disabled={pendingId === option.id} />
            </div>

            {/* Auto-apply — a bordered box of its own so it reads as a
                distinct "when this level kicks in automatically" setting,
                not part of the level's name/color. */}
            <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
              <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">Auto-apply</span>
              <Switch
                checked={option.autoApplyDaysBeforeDue != null}
                onCheckedChange={(checked) => handleAutoApplyToggle(option, checked)}
                disabled={pendingId === option.id}
                aria-label={`Auto-apply ${option.label} as deadlines approach`}
              />
              {option.autoApplyDaysBeforeDue != null ? (
                <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                  <label htmlFor={`auto-apply-days-${option.id}`}>Days before due:</label>
                  <Input
                    id={`auto-apply-days-${option.id}`}
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={option.autoApplyDaysBeforeDue}
                    className="h-8 w-16 text-center"
                    disabled={pendingId === option.id}
                    onBlur={(e) => handleAutoApplyInputChange(option, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </span>
              ) : (
                <span className="text-xs whitespace-nowrap text-muted-foreground">Off</span>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pendingId === option.id}
              onClick={() => requestDelete(option)}
              aria-label={`Delete ${option.label}`}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
        <Input
          placeholder="New priority level name"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="h-8 min-w-[140px] max-w-56 flex-1"
        />
        <ColorPicker value={newColor} onCommit={setNewColor} />
        <Button size="sm" onClick={handleAdd} disabled={!newLabel.trim() || adding}>
          <Plus className="size-4" />
          Add priority level
        </Button>
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move tasks before deleting</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${deleteTarget.tasksInUse} task${deleteTarget.tasksInUse === 1 ? " is" : "s are"} still set to "${deleteTarget.option.label}". Choose a priority level to move them to.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <Select value={replacementId} onValueChange={(value) => setReplacementId(value ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a replacement priority level" />
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
