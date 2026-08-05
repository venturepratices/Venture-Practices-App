"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SimpleMarkdown } from "@/components/ui/simple-markdown";
import { formatDate, formatDateTime } from "@/lib/utils";

type Props = {
  clientId: string;
  meetingNote: {
    id: string;
    title: string;
    meetingDate: string | Date;
    transcript: string;
    summary: string;
    author: { name: string } | null;
  };
};

export function MeetingNoteItem({ clientId, meetingNote }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  async function remove() {
    if (!window.confirm("Delete this meeting note? This can't be undone.")) return;
    const response = await fetch(`/api/clients/${clientId}/meetings/${meetingNote.id}`, { method: "DELETE" });
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
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
      >
        <span className="w-48 shrink-0 truncate font-medium">{meetingNote.title}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {meetingNote.author?.name ? `Added by ${meetingNote.author.name}` : ""}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatDate(meetingNote.meetingDate)}</span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setShowTranscript(false);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>{meetingNote.title}</DialogTitle>
              <div className="mr-6 flex shrink-0 items-center gap-1">
                <TooltipProvider delay={300}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label="Delete meeting note" onClick={remove} />
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>Delete meeting note</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(meetingNote.meetingDate)}
              {meetingNote.author?.name ? ` · added by ${meetingNote.author.name}` : ""}
            </p>
          </DialogHeader>

          <SimpleMarkdown text={meetingNote.summary} className="space-y-1 text-muted-foreground" />

          <button
            type="button"
            onClick={() => setShowTranscript((value) => !value)}
            className="mt-2 text-left text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showTranscript ? "Hide transcript" : "Show full transcript"}
          </button>
          {showTranscript ? (
            <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {meetingNote.transcript}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
