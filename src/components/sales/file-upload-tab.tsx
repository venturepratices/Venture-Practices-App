"use client";

import { useId, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import { uploadDealFileRequest } from "@/lib/sales/api-client";
import { fileCheck, fileSizeLabel } from "@/lib/sales/panel-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MUTED_TEXT } from "@/components/sales/sales-pills";

// The File tab of the deal panel's composer (Mockup v2 `fileTab`): a drop
// zone that opens the picker, a chip once a file is picked, the "This is the
// final version..." checkbox, and Upload file. The <input type="file"> is
// visually hidden (`sr-only`), not `hidden`, so Tab reaches it and Enter or
// Space opens the picker; the drop zone shows its focus ring. One request at
// a time; a refusal from the server shows inline with `role="alert"`.

const UPLOAD_ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg";

export function FileUploadTab({ dealId, onUploaded }: { /** The deal the file is added to; only deals have a File tab (Decision 24). */ dealId: string; onUploaded: () => void }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  function onPicked(file: File | null) {
    setPicked(file);
    setError(null);
  }

  function clearPicked() {
    onPicked(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) onPicked(file);
  }

  async function upload() {
    if (uploading) return;
    const message = fileCheck(picked, confirmed);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setUploading(true);
    const result = await uploadDealFileRequest(dealId, picked!);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("File added.");
    setPicked(null);
    setConfirmed(false);
    if (inputRef.current) inputRef.current.value = "";
    onUploaded();
  }

  return (
    <div className="grid gap-2.5 p-3">
      {/* The file input is visually hidden but focusable, so Tab reaches it (never `hidden`): the drop zone shows the focus ring. */}
      <input
        ref={inputRef}
        type="file"
        id={`${id}-pick`}
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        aria-label="Choose a file to add"
        aria-describedby={hintId}
        onChange={(event) => onPicked(event.target.files?.[0] ?? null)}
        disabled={uploading}
      />

      {picked === null ? (
        <label
          htmlFor={`${id}-pick`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed bg-muted/30 px-4 py-6 text-center text-[13px] transition-colors",
            "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
            "pointer-coarse:min-h-10",
            dragging ? "border-primary bg-accent/50 text-accent-foreground" : "hover:bg-muted/50",
          )}
        >
          <Paperclip aria-hidden="true" className="size-5" />
          <span className="font-semibold">
            Drop a file or <span className="text-primary underline underline-offset-2">browse</span>
          </span>
          <span id={hintId} className={cn("text-xs", MUTED_TEXT)}>
            Final versions only: signed contract, final proposal.
            <br />
            PDF, Word, Excel, PNG or JPG. Up to 4 MB.
          </span>
        </label>
      ) : (
        <div className="flex items-center gap-2.5 rounded-[9px] border bg-card px-3 py-2.5 text-[13px]">
          <Paperclip aria-hidden="true" className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="m-0 font-semibold [overflow-wrap:anywhere]">{picked.name}</p>
            <p className={cn("m-0 text-xs", MUTED_TEXT)}>{fileSizeLabel(picked.size)} &middot; ready to upload</p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={clearPicked}
            aria-label={`Take ${picked.name} off`}
            disabled={uploading}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      {error ? (
        <p role="alert" className="m-0 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            setConfirmed(event.target.checked);
            if (error === "Tick the box first. Files are for final versions only.") setError(null);
          }}
          disabled={uploading}
          className="mt-[3px] size-4 shrink-0 rounded border-input"
        />
        <span>This is the final version the client received.</span>
      </label>

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => void upload()}
          disabled={uploading}
          aria-busy={uploading || undefined}
          className="pointer-coarse:min-h-10"
        >
          {uploading ? "Uploading…" : "Upload file"}
        </Button>
      </div>
    </div>
  );
}
