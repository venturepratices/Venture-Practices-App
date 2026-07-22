"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUp, Link2, Upload } from "lucide-react";
import { upload } from "@vercel/blob/client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "file" | "url";

/**
 * Uploads a new AssetVersion for an EXISTING asset — same client-upload
 * mechanics as NewAssetDialog, minus title/description (those belong to the
 * asset, not the version). New version starts at zero decisions/comments; the
 * server recomputes the asset's overall status back to a fresh review round.
 */
export function UploadVersionDialog({
  clientId,
  assetId,
  trigger,
}: {
  clientId: string;
  assetId: string;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  function reset() {
    setMode("file");
    setFile(null);
    setUrl("");
    setProgress(null);
    setError(null);
    setSubmitting(false);
    setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setMode("file");
      setFile(dropped);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "file" && !file) {
      setError("Pick a file to upload.");
      return;
    }
    if (mode === "url") {
      try {
        new URL(url);
      } catch {
        setError("Enter a valid URL.");
        return;
      }
    }

    setSubmitting(true);
    try {
      let payload:
        | { kind: "upload"; blobUrl: string; mimeType: string; sizeBytes: number }
        | { kind: "url"; externalUrl: string };

      if (mode === "file" && file) {
        setProgress("Uploading…");
        const blob = await upload(`assets/${clientId}/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/assets/upload-token",
          clientPayload: JSON.stringify({ clientId }),
        });
        payload = { kind: "upload", blobUrl: blob.url, mimeType: file.type || "application/octet-stream", sizeBytes: file.size };
      } else {
        payload = { kind: "url", externalUrl: url.trim() };
      }

      setProgress("Saving…");
      const res = await fetch(`/api/assets/${assetId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }

      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          setOpen(next);
          if (!next) reset();
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Upload new version</DialogTitle>
            <DialogDescription>
              Starts a fresh review round — every reviewer&apos;s decision resets. Earlier versions and their comments stay untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2 rounded-md border p-1">
              <button
                type="button"
                onClick={() => setMode("file")}
                className={`flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium ${
                  mode === "file" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Upload className="size-4" />
                Upload file
              </button>
              <button
                type="button"
                onClick={() => setMode("url")}
                className={`flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium ${
                  mode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Link2 className="size-4" />
                Paste URL
              </button>
            </div>
            {mode === "file" ? (
              <div className="space-y-2">
                <Label htmlFor="version-file">File</Label>
                <label
                  htmlFor="version-file"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-md border-2 border-dashed p-4 text-center transition-colors ${
                    dragActive ? "border-primary bg-primary/5" : "border-input hover:bg-accent/50"
                  }`}
                >
                  <FileUp className="size-5 text-muted-foreground" />
                  <span className="text-sm">
                    {file ? file.name : "Drop a file here, or click to browse"}
                  </span>
                  <Input
                    id="version-file"
                    type="file"
                    accept="image/*,video/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                    required
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="version-url">URL</Label>
                <Input
                  id="version-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/landing-page"
                  required
                />
              </div>
            )}
            {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Upload version"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
