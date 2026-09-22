"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PrivateProjectQuickAdd() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = label.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/private-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError((body && body.error) || "Failed to add project.");
        return;
      }
      setLabel("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="New private project name"
        disabled={pending}
        className="h-8 min-w-[160px] flex-1"
      />
      <Button size="sm" type="submit" disabled={!label.trim() || pending}>
        <Plus className="size-4" />
        Add project
      </Button>
      {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
