"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SyncNowButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One part of the sync worked and the other did not (for example calls
  // loaded but message history was refused). Shown as a note, not an error.
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleSync() {
    setError(null);
    setWarnings([]);
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/highlevel/sync`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        if (Array.isArray(data?.warnings)) {
          setWarnings(data.warnings.filter((w: unknown): w is string => typeof w === "string"));
        }
        router.refresh();
      } else {
        setError(data?.error ?? "Sync failed.");
      }
    } catch {
      setError("Could not reach the app. Check your connection and try again.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
      <div className="flex max-w-full flex-col items-end gap-1 text-right sm:max-w-md">
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        {warnings.map((warning) => (
          <span key={warning} className="text-xs text-amber-700 dark:text-amber-400">
            {warning}
          </span>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
        <RefreshCw className={`mr-1.5 size-4 ${isSyncing ? "animate-spin" : ""}`} />
        {isSyncing ? "Syncing..." : "Sync now"}
      </Button>
    </div>
  );
}
