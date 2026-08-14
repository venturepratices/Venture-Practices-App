"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pencil, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MentionItem } from "@/components/ui/mention-list";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { stripHtml } from "@/lib/text-format";
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
  teamMembers: MentionItem[];
  delayMs?: number;
};

// A one-line row preview — note.body is Tiptap-produced HTML, so strip tags
// down to plain text first, matching how Task rows preview their title.
function previewOf(body: string) {
  return stripHtml(body);
}

export function ClientNoteItem({ clientId, note, teamMembers, delayMs }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    if (!stripHtml(draft).trim() || draft.trim() === note.body) {
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
    if (response.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ animationDelay: delayMs ? `${delayMs}ms` : undefined }}
        className="flex w-full animate-in items-center gap-3 px-4 py-3 text-left text-sm fade-in slide-in-from-bottom-1 transition-colors duration-300 hover:bg-muted/50"
      >
        <span className="w-32 shrink-0 truncate font-medium">{note.author?.name ?? "Former team member"}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{previewOf(note.body)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDateTime(note.createdAt)}
          {wasEdited ? " (edited)" : ""}
        </span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setIsEditing(false);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>{note.author?.name ?? "Former team member"}</DialogTitle>
              {!isEditing ? (
                <div className="mr-6 flex shrink-0 items-center gap-1">
                  <TooltipProvider delay={300}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label="Edit note" onClick={startEdit} />
                        }
                      >
                        <Pencil className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>Edit note</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label="Delete note" onClick={remove} />
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>Delete note</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(note.createdAt)}
              {wasEdited ? " (edited)" : ""}
            </p>
          </DialogHeader>

          {isEditing ? (
            <div className="space-y-2">
              <RichTextEditor content={draft} onChange={setDraft} teamMembers={teamMembers} />
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={isSaving || !stripHtml(draft).trim()} onClick={save}>
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
            <RichTextContent html={note.body} className="whitespace-pre-wrap text-muted-foreground" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
