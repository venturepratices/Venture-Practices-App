"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type ConnectionsHealth = {
  botToken: boolean;
  internalChannel: boolean;
  appUrl: boolean;
};

export type ConnectionsTeamMember = {
  id: string;
  name: string;
  mapped: boolean;
};

export type ConnectionsClient = {
  id: string;
  name: string;
  channelActive: boolean;
};

function StatusPill({ ok, okLabel, notOkLabel }: { ok: boolean; okLabel: string; notOkLabel: string }) {
  return ok ? (
    <span className="flex items-center gap-1 text-xs font-medium text-status-success-foreground">
      <CheckCircle2 className="size-3.5" />
      {okLabel}
    </span>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      {notOkLabel}
    </Badge>
  );
}

export function NotificationConnectionsPanel({
  health,
  teamMembers,
  clients,
}: {
  health: ConnectionsHealth;
  teamMembers: ConnectionsTeamMember[];
  clients: ConnectionsClient[];
}) {
  const router = useRouter();
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [creatingClientId, setCreatingClientId] = useState<string | null>(null);
  const [createdClientIds, setCreatedClientIds] = useState<string[]>([]);
  const [channelErrors, setChannelErrors] = useState<Record<string, string>>({});

  async function handleCreateChannel(clientId: string) {
    setCreatingClientId(clientId);
    setChannelErrors((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    try {
      const res = await fetch("/api/admin/notifications/client-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setChannelErrors((current) => ({
          ...current,
          [clientId]: (body && body.error) || "Couldn't create the channel.",
        }));
        return;
      }
      // Marked locally as well as refreshed — the refresh is what makes it
      // truthful (it re-reads slackChannelId), the local flag just avoids a
      // flash of "Not created yet" while that round-trip lands.
      setCreatedClientIds((current) => [...current, clientId]);
      router.refresh();
    } catch {
      setChannelErrors((current) => ({ ...current, [clientId]: "Couldn't create the channel." }));
    } finally {
      setCreatingClientId(null);
    }
  }

  async function handleTestChannel() {
    setTestState("sending");
    setTestError(null);
    try {
      const res = await fetch("/api/admin/notifications/test-channel", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setTestError((body && body.error) || "Couldn't send the test message.");
        setTestState("error");
        return;
      }
      setTestState("sent");
    } catch {
      setTestState("error");
      setTestError("Couldn't send the test message.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Health check</p>
        <Card>
          <CardContent className="divide-y">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Slack bot token</p>
                <p className="text-xs text-muted-foreground">SLACK_BOT_TOKEN — required for every DM and channel post</p>
              </div>
              <StatusPill ok={health.botToken} okLabel="Configured" notOkLabel="Not set" />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Internal channel</p>
                <p className="text-xs text-muted-foreground">SLACK_INTERNAL_CHANNEL_ID — fallback for events with no client</p>
              </div>
              <StatusPill ok={health.internalChannel} okLabel="Configured" notOkLabel="Not set" />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Deep links</p>
                <p className="text-xs text-muted-foreground">NEXT_PUBLIC_APP_URL — powers &quot;Open in app&quot; links in Slack</p>
              </div>
              <StatusPill ok={health.appUrl} okLabel="Configured" notOkLabel="Not set" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Team — personal Slack DMs
        </p>
        <Card>
          <CardContent className="divide-y">
            {teamMembers.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No team members yet.</p>
            ) : (
              teamMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium">{member.name}</span>
                  <StatusPill ok={member.mapped} okLabel="Mapped" notOkLabel="Not mapped" />
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Matched automatically by email, or set manually from{" "}
          <Link href="/team" className="text-primary underline-offset-2 hover:underline">
            Team →
          </Link>
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Client channels</p>
        <Card>
          <CardContent className="divide-y">
            {clients.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No clients yet.</p>
            ) : (
              clients.map((client) => {
                const active = client.channelActive || createdClientIds.includes(client.id);
                const creating = creatingClientId === client.id;
                const error = channelErrors[client.id];
                return (
                  <div key={client.id} className="py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{client.name}</span>
                      {active ? (
                        <StatusPill ok okLabel="Active" notOkLabel="Not created yet" />
                      ) : creating ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          Creating...
                        </span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusPill ok={false} okLabel="Active" notOkLabel="Not created yet" />
                          <Button variant="outline" size="xs" onClick={() => handleCreateChannel(client.id)}>
                            <Plus className="size-3.5" />
                            Create channel
                          </Button>
                        </div>
                      )}
                    </div>
                    {error ? (
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
                        <XCircle className="mt-0.5 size-3.5 shrink-0" />
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Created automatically when a client is added. Clients added before Slack was wired up need one click here.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Test</p>
        <Card>
          <CardContent className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Send a test message to the internal channel</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Posts one sample &quot;📣&quot; message so you can confirm it actually arrives.
              </p>
              {testState === "sent" ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-status-success-foreground">
                  <CheckCircle2 className="size-3.5" />
                  Sent — check the internal Slack channel.
                </p>
              ) : null}
              {testState === "error" ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                  <XCircle className="size-3.5" />
                  {testError}
                </p>
              ) : null}
            </div>
            <Button variant="outline" size="sm" onClick={handleTestChannel} disabled={testState === "sending"}>
              {testState === "sending" ? <Loader2 className="size-4 animate-spin" /> : null}
              Send test
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
