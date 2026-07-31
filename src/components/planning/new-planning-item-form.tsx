"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, Link2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PlanningStatusPill } from "@/components/planning/planning-status-pill";

const CREATABLE_STATUSES = ["IDEA", "STRATEGY"] as const;

type PendingLink = { label: string; url: string };

export function NewPlanningItemForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("IDEA");
  const [isPending, setIsPending] = useState(false);

  const [showLinkFields, setShowLinkFields] = useState(false);
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  function resetFields() {
    setTitle("");
    setDescription("");
    setStatus("IDEA");
    setShowLinkFields(false);
    setPendingLinks([]);
    setLinkLabel("");
    setLinkUrl("");
  }

  function addPendingLink() {
    if (!linkLabel.trim() || !linkUrl.trim()) return;
    setPendingLinks((prev) => [...prev, { label: linkLabel.trim(), url: linkUrl.trim() }]);
    setLinkLabel("");
    setLinkUrl("");
  }

  function removePendingLink(index: number) {
    setPendingLinks((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setIsPending(true);
    const response = await fetch(`/api/clients/${clientId}/planning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: trimmed,
        description: description.trim() || null,
        status,
        links: pendingLinks.length ? pendingLinks : undefined,
      }),
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

      <div className="space-y-2">
        {pendingLinks.length > 0 ? (
          <ul className="space-y-1">
            {pendingLinks.map((link, index) => (
              <li key={`${link.url}-${index}`} className="flex items-center gap-2 text-sm">
                <span className="flex flex-1 items-center gap-1.5 truncate text-muted-foreground">
                  <ExternalLink className="size-3.5 shrink-0" />
                  <span className="truncate">{link.label}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${link.label}`}
                  onClick={() => removePendingLink(index)}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {showLinkFields ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={linkLabel}
              onChange={(event) => setLinkLabel(event.target.value)}
              placeholder="Label (e.g. Brief doc)"
              className="h-8 text-sm"
              disabled={isPending}
            />
            <Input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://..."
              className="h-8 text-sm"
              disabled={isPending}
            />
            <Button type="button" variant="outline" size="icon-sm" aria-label="Add link" onClick={addPendingLink} disabled={isPending}>
              <Plus className="size-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowLinkFields(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Link2 className="size-3.5" />
            Attach a link
          </button>
        )}
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
