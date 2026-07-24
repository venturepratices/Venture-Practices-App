"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plug, Unplug } from "lucide-react";

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
import { formatDateTime } from "@/lib/utils";

type Connection = {
  locationId: string;
  connectedAt: string;
  lastSyncAt: string | null;
};

export function HighLevelConnectionSection({
  clientId,
  connection,
}: {
  clientId: string;
  connection: Connection | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState(connection?.locationId ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  async function handleConnect() {
    setError(null);
    setIsSaving(true);
    const response = await fetch(`/api/clients/${clientId}/highlevel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: locationId.trim(), token: token.trim() }),
    });
    setIsSaving(false);

    if (response.ok) {
      setOpen(false);
      setToken("");
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      const base = data?.error ?? "Couldn't connect to HighLevel.";
      setError(data?.detail ? `${base} (${data.detail})` : base);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect HighLevel for this client? Cached conversations will be removed (they stay safe in HighLevel).")) {
      return;
    }
    setIsDisconnecting(true);
    const response = await fetch(`/api/clients/${clientId}/highlevel`, { method: "DELETE" });
    setIsDisconnecting(false);
    if (response.ok) router.refresh();
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">HighLevel</p>
          {connection ? (
            <div className="space-y-0.5 text-sm text-muted-foreground">
              <p>
                Connected · Location <span className="font-mono text-xs">{connection.locationId}</span>
              </p>
              <p className="text-xs">
                Last synced: {connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "not yet"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect this client&apos;s HighLevel sub-account to see their conversations here.
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {connection ? (
            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={isDisconnecting}>
              <Unplug className="mr-1.5 size-4" />
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </Button>
          ) : null}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <Button variant={connection ? "outline" : "default"} size="sm">
                  <Plug className="mr-1.5 size-4" />
                  {connection ? "Update token" : "Connect HighLevel"}
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Connect HighLevel</DialogTitle>
                <DialogDescription>
                  Paste this client&apos;s HighLevel sub-account Location ID and a Private Integration Token (Settings →
                  Private Integrations, with Conversations access). The token is stored encrypted.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="hl-location">Location ID</Label>
                  <Input
                    id="hl-location"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    placeholder="e.g. ve9EPM428h8vShlRW1KT"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hl-token">Private Integration Token</Label>
                  <Input
                    id="hl-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="pit-..."
                    required
                  />
                </div>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </div>
              <DialogFooter>
                <Button type="button" onClick={handleConnect} disabled={isSaving || !locationId.trim() || !token.trim()}>
                  {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isSaving ? "Connecting..." : "Connect"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
