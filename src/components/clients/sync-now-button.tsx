"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SyncNowButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setError(null);
    setIsSyncing(true);
    const response = await fetch(`/api/clients/${clientId}/highlevel/sync`, { method: "POST" });
    setIsSyncing(false);
    if (response.ok) {
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Sync failed.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
        <RefreshCw className={`mr-1.5 size-4 ${isSyncing ? "animate-spin" : ""}`} />
        {isSyncing ? "Syncing..." : "Sync now"}
      </Button>
    </div>
  );
}
