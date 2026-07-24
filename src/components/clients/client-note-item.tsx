"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pencil, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/utils";

type Props = {
  clientId: string;
  note: {
    id: string;
    body: string;
    createdAt: string | Date;
    updatedAt: string | Date;
    author: { name: string } | null;
  };
};

export function ClientNoteItem({ clientId, note }: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [isSaving, setIsSaving] = useState(false);

  // Prisma resolves @default(now()) and @updatedAt as separate timestamps even on
  // the initial insert, so a fresh note can differ by a few ms — only treat it as
  // "edited" once the gap is large enough to reflect an actual later edit.
  const wasEdited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 2000;

  function startEdit() {
    setDraft(note.body);
    setIsEditing(true);
  }

  function cancelEdit() {
    setDraft(note.body);
    setIsEditing(false);
  }

  async function save() {
    if (!draft.trim() || draft.trim() === note.body) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    const response = await fetch(`/api/clients/${clientId}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft.trim() }),
    });
    setIsSaving(false);
    if (response.ok) {
      setIsEditing(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!window.confirm("Delete this note? This can't be undone.")) return;
    const response = await fetch(`/api/clients/${clientId}/notes/${note.id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{note.author?.name ?? "Former team member"}</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(note.createdAt)}
            {wasEdited ? " (edited)" : ""}
          </span>
        </div>
        {!isEditing ? (
          <div className="flex shrink-0 items-center gap-1">
            <TooltipProvider delay={300}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label="Edit note" onClick={startEdit}>
                      <Pencil className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>Edit note</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label="Delete note" onClick={remove}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>Delete note</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-1.5 space-y-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") cancelEdit();
            }}
            className="min-h-20 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isSaving || !draft.trim()} onClick={save}>
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEdit}>
              <X className="size-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{note.body}</p>
      )}
    </div>
  );
}
