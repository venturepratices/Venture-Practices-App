"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function RestoreArchivedEntityButton({ restoreUrl, confirmMessage }: { restoreUrl: string; confirmMessage: string }) {
  const router = useRouter();
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    if (!window.confirm(confirmMessage)) return;
    setIsRestoring(true);
    setError(null);
    const response = await fetch(restoreUrl, { method: "POST" });
    setIsRestoring(false);
    if (response.ok) {
      router.refresh();
    } else {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Restore failed.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={handleRestore} disabled={isRestoring}>
        <RotateCcw className="size-4" />
        {isRestoring ? "Restoring..." : "Restore"}
      </Button>
      {error ? <p className="text-xs text-status-danger-foreground">{error}</p> : null}
    </div>
  );
}
