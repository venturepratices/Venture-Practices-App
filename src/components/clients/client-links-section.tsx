"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientLink } from "@/generated/prisma/client";

export function ClientLinksSection({ clientId, links }: { clientId: string; links: ClientLink[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submitLink() {
    if (!label.trim() || !url.trim()) return;
    setError(null);
    const response = await fetch(`/api/clients/${clientId}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), url: url.trim() }),
    });
    if (response.ok) {
      setLabel("");
      setUrl("");
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't add that link.");
    }
  }

  async function deleteLink(linkId: string) {
    const response = await fetch(`/api/client-links/${linkId}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  return (
    <div className="space-y-2">
      <Label>Links</Label>
      {links.length > 0 ? (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-2 text-sm">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center gap-1.5 truncate text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                <span className="truncate">{link.label}</span>
              </a>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${link.label}`} onClick={() => deleteLink(link.id)}>
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (e.g. Ad account)" className="h-8 text-sm" />
        <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." className="h-8 text-sm" />
        <Button variant="outline" size="icon-sm" aria-label="Add link" onClick={submitLink}>
          <Plus className="size-4" />
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
