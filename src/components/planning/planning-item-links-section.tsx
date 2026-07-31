"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PlanningItemLinkLike = { id: string; label: string; url: string };

/** Mirrors ClientLinksSection/task-link UI exactly, targeting a PlanningItem. */
export function PlanningItemLinksSection({
  itemId,
  links,
  canManage,
}: {
  itemId: string;
  links: PlanningItemLinkLike[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submitLink() {
    if (!label.trim() || !url.trim()) return;
    setError(null);
    const response = await fetch(`/api/planning-items/${itemId}/links`, {
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
    const response = await fetch(`/api/planning-item-links/${linkId}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {links.length > 0 ? (
        <ul className="space-y-1">
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
              {canManage ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${link.label}`} onClick={() => deleteLink(link.id)}>
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <div className="flex items-center gap-1.5">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" className="h-8 text-sm" />
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." className="h-8 text-sm" />
          <Button variant="outline" size="icon-sm" aria-label="Add link" onClick={submitLink}>
            <Plus className="size-4" />
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
