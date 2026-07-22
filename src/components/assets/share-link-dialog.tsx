"use client";

import { useState } from "react";
import { Check, Copy, Lock, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";

type ShareLink = {
  id: string;
  token: string;
  passwordProtected: boolean;
  expiresAt: string | null;
  createdAt: string;
};

/**
 * Agency-side "Share for review" management — create a public /review/[token]
 * link (optionally password-protected and/or expiring) and revoke existing
 * ones. The password, if set, is hashed server-side immediately and can never
 * be viewed again here — the agency must communicate it to the client
 * themselves, separately from the link (that separation is the whole point
 * of adding a password on top of the token).
 */
export function ShareLinkDialog({ assetId, trigger }: { assetId: string; trigger: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [useExpiry, setUseExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/share-links`);
      if (!res.ok) throw new Error("Failed to load share links");
      setLinks(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function shareUrl(token: string): string {
    return `${window.location.origin}/review/${token}`;
  }

  async function copyLink(link: ShareLink) {
    await navigator.clipboard.writeText(shareUrl(link.token));
    setCopiedId(link.id);
    setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 1500);
  }

  async function createLink() {
    if (usePassword && password.trim().length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/share-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: usePassword ? password.trim() : null,
          expiresAt: useExpiry && expiryDate ? new Date(expiryDate).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? "Failed to create link");
      }
      setCreating(false);
      setUsePassword(false);
      setPassword("");
      setUseExpiry(false);
      setExpiryDate("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(linkId: string) {
    await fetch(`/api/asset-share-links/${linkId}`, { method: "DELETE" });
    await load();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share for review</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this asset and leave comments or a decision — no account needed. Treat it like a password.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : links && links.length > 0 ? (
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.id} className="rounded-md border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {link.passwordProtected ? <Lock className="size-3.5 shrink-0" /> : null}
                      <span className="truncate">
                        Created {formatDateTime(link.createdAt)}
                        {link.expiresAt ? ` · Expires ${formatDateTime(link.expiresAt)}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => copyLink(link)}>
                        {copiedId === link.id ? <Check className="mr-1 size-3.5" /> : <Copy className="mr-1 size-3.5" />}
                        {copiedId === link.id ? "Copied" : "Copy"}
                      </Button>
                      <button
                        onClick={() => revoke(link.id)}
                        title="Revoke"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No active links yet.</p>
          )}

          {creating ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} className="size-4 rounded border-input" />
                Password protect
              </label>
              {usePassword ? (
                <div className="space-y-1">
                  <Input
                    type="text"
                    placeholder="Choose a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    You&apos;ll need to share this password with them yourself — it can&apos;t be viewed again after creation.
                  </p>
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useExpiry} onChange={(e) => setUseExpiry(e.target.checked)} className="size-4 rounded border-input" />
                Set an expiry date
              </label>
              {useExpiry ? (
                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="h-8 text-sm" min={new Date().toISOString().slice(0, 10)} />
              ) : null}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={createLink} disabled={submitting}>
                  {submitting ? "Creating…" : "Create link"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 size-3.5" />
              New share link
            </Button>
          )}
          {!creating && error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
