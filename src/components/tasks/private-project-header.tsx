"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PrivateProjectHeader({ projectId, label }: { projectId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRename(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === label) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/private-projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError((body && body.error) || "Failed to rename project.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${label}"? Its tasks stay — they'll just no longer be grouped under this project.`)) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/private-projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError((body && body.error) || "Failed to delete project.");
        return;
      }
      router.push("/my-tasks/private");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          defaultValue={label}
          className="h-9 max-w-sm text-lg font-semibold"
          disabled={pending}
          onBlur={(e) => handleRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Project name"
        />
        <Button variant="ghost" size="icon-sm" disabled={pending} onClick={handleDelete} aria-label={`Delete ${label}`}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
