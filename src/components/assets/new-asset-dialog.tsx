"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Upload, Link2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

type Mode = "file" | "url";

export function NewAssetDialog({
  clientId,
  trigger,
}: {
  clientId: string;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setMode("file");
    setTitle("");
    setDescription("");
    setFile(null);
    setUrl("");
    setProgress(null);
    setError(null);
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

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
      let version:
        | { kind: "upload"; blobUrl: string; mimeType: string; sizeBytes: number }
        | { kind: "url"; externalUrl: string };

      if (mode === "file" && file) {
        setProgress("Uploading…");
        // Path is a suggestion — Vercel Blob still adds a random suffix by default.
        const blob = await upload(`assets/${clientId}/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/assets/upload-token",
          clientPayload: JSON.stringify({ clientId }),
        });
        version = { kind: "upload", blobUrl: blob.url, mimeType: file.type || "application/octet-stream", sizeBytes: file.size };
      } else {
        version = { kind: "url", externalUrl: url.trim() };
      }

      setProgress("Saving…");
      const res = await fetch(`/api/clients/${clientId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          version,
        }),
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
            <DialogTitle>New asset</DialogTitle>
            <DialogDescription>
              Upload a file or paste a URL. You can add reviewers and a due date after it&apos;s created.
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
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short note for reviewers…"
              />
            </div>
            {mode === "file" ? (
              <div className="space-y-2">
                <Label htmlFor="file">File</Label>
                <Input
                  id="file"
                  type="file"
                  accept="image/*,video/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
                <p className="text-xs text-muted-foreground">Images, videos, and PDFs. Up to 500 MB.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/landing-page"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Any URL — landing page, website, staged preview. Reviewers see it in an embedded frame.
                </p>
              </div>
            )}
            {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Create asset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
