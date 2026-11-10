"use client";

import { useState } from "react";
import { Download, FileText, Image, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { removeDealFileRequest } from "@/lib/sales/api-client";
import type { PanelFile } from "@/lib/sales/deal-panel";
import { fileMetaLine } from "@/lib/sales/panel-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MUTED_TEXT } from "@/components/sales/sales-pills";
import { SECTION_HEADING } from "@/components/sales/next-steps";

// The deal panel's "Files" section (Mockup v2 `#s=deal-files`, `fileRow`): the
// live final-version files for a deal, newest first, with a Download link and
// a Remove button for the deal owner or an admin. Empty: a line and an "Add a
// file" button that opens the File tab of the composer. A row cannot be
// edited; a removed file leaves the list and keeps a `file_removed` row in
// History.

/** The tiny type-coloured badge on a file row: `PDF`, `DOCX`, `XLSX`, `PNG`, `JPG`. */
const EXT_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "DOCX",
  xlsx: "XLSX",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPG",
};

const EXT_ICON: Record<string, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileText,
  png: Image,
  jpg: Image,
  jpeg: Image,
};

function extOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function DealFiles({
  files,
  canEdit,
  now,
  onAddFile,
  onChanged,
}: {
  files: PanelFile[];
  /** The deal owner or an admin. Drives the "Add a file" button on the empty state. */
  canEdit: boolean;
  now: Date;
  /** Opens the File tab of the composer (the "Add a file" button). */
  onAddFile: () => void;
  /** After a file is removed: reload the panel. */
  onChanged: () => void;
}) {
  const count = files.length;
  const [removing, setRemoving] = useState<PanelFile | null>(null);

  return (
    <section aria-labelledby="deal-panel-files" className="grid gap-2">
      <h3 id="deal-panel-files" className={SECTION_HEADING}>
        Files
        {count > 0 ? (
          <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", MUTED_TEXT)}>
            {count}
          </span>
        ) : null}
      </h3>

      {count === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[9px] border border-dashed bg-muted/30 px-3 py-3 text-[13px]">
          <span className={MUTED_TEXT}>
            No files yet. Add the signed contract or the final proposal once the client has it.
          </span>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAddFile}
              className="shrink-0 pointer-coarse:min-h-10"
            >
              <Paperclip aria-hidden="true" />
              Add a file
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {files.map((file) => (
            <FileRow key={file.id} file={file} now={now} onRemove={() => setRemoving(file)} />
          ))}
        </ul>
      )}

      <RemoveFileDialog
        file={removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        onChanged={onChanged}
      />
    </section>
  );
}

/** One file in the list: type tag, name, meta line, Download link, Remove button (removable only). */
function FileRow({ file, now, onRemove }: { file: PanelFile; now: Date; onRemove: () => void }) {
  const ext = extOf(file.name);
  const tag = EXT_LABELS[ext] ?? "FILE";
  const Icon = EXT_ICON[ext] ?? FileText;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[9px] border bg-card px-3 py-2.5 text-[13px]">
      <span
        aria-hidden="true"
        className={cn("inline-flex min-w-[42px] shrink-0 items-center justify-center gap-1 rounded-[6px] bg-muted px-1.5 py-1 text-[10px] font-semibold tracking-wide uppercase", MUTED_TEXT)}
      >
        <Icon className="size-3" aria-hidden="true" />
        {tag}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold [overflow-wrap:anywhere]">{file.name}</p>
        <p className={`m-0 text-xs ${MUTED_TEXT}`}>{fileMetaLine(file, now)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="pointer-coarse:min-h-10"
          render={
            <a
              href={`/api/sales/files/${file.id}`}
              download
              aria-label={`Download ${file.name}`}
              rel="noopener"
            />
          }
        >
          <Download aria-hidden="true" />
          Download
        </Button>
        {file.canRemove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={`Remove ${file.name}`}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive pointer-coarse:min-h-10"
          >
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The confirm dialog before a file is removed (Mockup v2 `removeFileModal`).
 * The row stays until the server answers, so Cancel leaves the list unchanged;
 * "Remove file" sends the DELETE and refreshes the panel.
 */
export function RemoveFileDialog({
  file,
  onOpenChange,
  onChanged,
}: {
  file: PanelFile | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function remove() {
    if (!file || saving) return;
    setSaving(true);
    const result = await removeDealFileRequest(file.id);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast("File removed.");
    onOpenChange(false);
    onChanged();
  }

  return (
    <Dialog open={file !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Remove this file?</DialogTitle>
          <DialogDescription className="sr-only">
            Remove {file?.name ?? "this file"} from the deal.
          </DialogDescription>
        </DialogHeader>
        {file ? (
          <div className="grid gap-2">
            <p className="m-0 font-semibold [overflow-wrap:anywhere]">{file.name}</p>
            <p className={`m-0 text-[13px] ${MUTED_TEXT}`}>
              It leaves the deal&rsquo;s Files list and can no longer be downloaded. The history keeps a record that it was added and removed.
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="pointer-coarse:min-h-10">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void remove()}
            disabled={saving || !file}
            aria-busy={saving || undefined}
            className="bg-red-600 text-white hover:bg-red-600/90 focus-visible:ring-red-600/40 pointer-coarse:min-h-10"
          >
            Remove file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
