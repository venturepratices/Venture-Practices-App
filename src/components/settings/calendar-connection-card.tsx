"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Connection = {
  googleEmail: string | null;
  connectedAt: Date;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
} | null;

export function CalendarConnectionCard({
  connection,
  configured,
  justConnected,
  error,
}: {
  connection: Connection;
  configured: boolean;
  justConnected: boolean;
  error?: string;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleDisconnect() {
    setDisconnecting(true);
    setLocalError(null);
    try {
      const res = await fetch("/api/calendar/google/disconnect", { method: "POST" });
      if (!res.ok) {
        setLocalError("Failed to disconnect. Try again.");
        return;
      }
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setLocalError(null);
    try {
      const res = await fetch("/api/calendar/google/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setLocalError((body && body.error) || "Sync failed.");
        return;
      }
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  if (!configured) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          Google Calendar isn&apos;t configured for this app yet — an admin needs to set up a Google OAuth client and
          add the credentials before anyone can connect.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {justConnected ? (
        <p className="flex items-center gap-2 rounded-md bg-status-success/20 px-3 py-2 text-sm text-status-success-foreground">
          <CheckCircle2 className="size-4 shrink-0" />
          Connected — your calendar is now syncing.
        </p>
      ) : null}
      {(error || localError) && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <XCircle className="size-4 shrink-0" />
          {error ?? localError}
        </p>
      )}

      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {connection ? (
              <>
                <p className="flex items-center gap-1.5 font-medium text-status-success-foreground">
                  <CheckCircle2 className="size-4" />
                  Connected{connection.googleEmail ? ` as ${connection.googleEmail}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {connection.lastSyncAt
                    ? `Last synced ${formatDateTime(connection.lastSyncAt)}`
                    : "Not synced yet"}
                </p>
                {connection.lastSyncError ? (
                  <p className="mt-1 text-xs text-destructive">Last sync failed: {connection.lastSyncError}</p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">Not connected.</p>
            )}
          </div>

          {connection ? (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? <Loader2 className="size-4 animate-spin" /> : null}
                Sync now
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="size-4 animate-spin" /> : null}
                Disconnect
              </Button>
            </div>
          ) : (
            <Button size="sm" render={<a href="/api/calendar/google/connect" />}>
              Connect Google Calendar
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
