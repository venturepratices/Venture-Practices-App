"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APP_TIME_ZONE } from "@/lib/utils";

export type RockFormValues = {
  id?: string;
  title: string;
  doneDefinition: string | null;
  ownerId: string | null;
  isCompany: boolean;
  dueDate: string | null; // ISO
};

function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }) : "";
}

// Add or edit one Rock. Opened with `rock` undefined to add, or a Rock to edit.
export function RockDialog({
  open,
  onOpenChange,
  rock,
  quarter,
  leadershipMembers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rock: RockFormValues | null;
  quarter: string;
  leadershipMembers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const editing = Boolean(rock?.id);
  const [title, setTitle] = useState(rock?.title ?? "");
  const [doneDefinition, setDoneDefinition] = useState(rock?.doneDefinition ?? "");
  const [ownerId, setOwnerId] = useState<string | null>(rock?.ownerId ?? null);
  const [isCompany, setIsCompany] = useState(rock?.isCompany ?? false);
  const [dueDate, setDueDate] = useState(toDateInput(rock?.dueDate ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameById = new Map(leadershipMembers.map((m) => [m.id, m.name]));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return setError("Give the Rock a name.");
    if (!ownerId) return setError("Pick who owns it.");
    setSaving(true);
    setError(null);
    const body = {
      title: title.trim(),
      doneDefinition: doneDefinition.trim() || null,
      ownerId,
      isCompany,
      ...(dueDate ? { dueDate } : {}),
      ...(editing ? {} : { quarter }),
    };
    const response = await fetch(editing ? `/api/rocks/${rock!.id}` : "/api/rocks", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't save this Rock.");
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  async function remove() {
    if (!rock?.id || !window.confirm(`Remove the Rock "${rock.title}"?`)) return;
    const response = await fetch(`/api/rocks/${rock.id}`, { method: "DELETE" });
    if (response.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Rock" : "Add a Rock"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="rock-title">Rock</Label>
            <Input
              id="rock-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Streamline client billing"
              autoFocus={!editing}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rock-done">Done when…</Label>
            <Textarea
              id="rock-done"
              value={doneDefinition}
              onChange={(e) => setDoneDefinition(e.target.value)}
              placeholder="What does finished look like? e.g. every client is auto-billed through Stripe."
              className="min-h-20 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label>Owner</Label>
              <Select value={ownerId ?? ""} onValueChange={(v) => setOwnerId(v || null)}>
                <SelectTrigger className="w-48">
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
            <div className="grid gap-1.5">
              <Label htmlFor="rock-due">Due</Label>
              <Input
                id="rock-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-44"
              />
              {!editing && !dueDate ? <span className="text-xs text-muted-foreground">Blank = end of quarter</span> : null}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isCompany} onCheckedChange={(checked) => setIsCompany(checked === true)} />
            Company Rock (the whole team&apos;s priority)
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="sm:justify-between">
            {editing ? (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove}>
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save" : "Add Rock"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
