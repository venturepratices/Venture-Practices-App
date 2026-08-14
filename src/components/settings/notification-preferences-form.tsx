"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import {
  CATEGORY_META,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences,
} from "@/lib/notification-preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

function PrefRow({
  label,
  description,
  checked,
  onChange,
  badge,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  badge?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{label}</span>
          {badge ? <Badge variant="outline">{badge}</Badge> : null}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  );
}

export function NotificationPreferencesForm({ initial }: { initial: NotificationPreferences }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPreferences>(initial);
  const [saved, setSaved] = useState<NotificationPreferences>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [testError, setTestError] = useState<string | null>(null);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  function setSlackEnabled(value: boolean) {
    setPrefs((p) => ({ ...p, slackEnabled: value }));
  }

  function setAmbientDigest(value: boolean) {
    setPrefs((p) => ({ ...p, ambientDigest: value }));
  }

  function setCategoryEnabled(category: NotificationCategory, enabled: boolean) {
    setPrefs((p) => ({
      ...p,
      mutedCategories: enabled ? p.mutedCategories.filter((c) => c !== category) : [...p.mutedCategories, category],
    }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/me/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) {
        setSaveError("Failed to save. Try again.");
        return;
      }
      setSaved(prefs);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleTestDm() {
    setTestState("sending");
    setTestError(null);
    try {
      const res = await fetch("/api/me/notification-preferences/test-dm", { method: "POST" });
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
    <div className="space-y-4">
      <Card>
        <CardContent className="divide-y">
          <PrefRow
            label="Slack DMs"
            description="Send notifications to you on Slack, in addition to the bell icon in this app."
            checked={prefs.slackEnabled}
            onChange={setSlackEnabled}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <p className="text-sm font-semibold">What you&apos;re notified about</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Turn a category off to stop hearing about it entirely — in-app and on Slack.
          </p>
          <div className="mt-2 divide-y">
            {NOTIFICATION_CATEGORIES.map((category) => (
              <PrefRow
                key={category}
                label={CATEGORY_META[category].label}
                description={CATEGORY_META[category].description}
                checked={!prefs.mutedCategories.includes(category)}
                onChange={(enabled) => setCategoryEnabled(category, enabled)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y">
          <PrefRow
            label="Low-priority digest"
            badge="Ambient"
            description="Asset uploads/comments and due-soon reminders aren't urgent — they're batched into an occasional Slack summary instead of pinging instantly. Off means no digest (still shows in your bell)."
            checked={prefs.ambientDigest}
            onChange={setAmbientDigest}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {saveError ? <span className="text-xs text-destructive">{saveError}</span> : null}
        {!dirty && !saveError ? <span className="text-xs text-muted-foreground">Saved</span> : null}
        <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save changes
        </Button>
      </div>

      <Card>
        <CardContent className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Send me a test Slack message</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Confirms your Slack DM is actually wired up — goes through the exact same pipe as a real notification.
            </p>
            {testState === "sent" ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-status-success-foreground">
                <CheckCircle2 className="size-3.5" />
                Sent — check your Slack DMs.
              </p>
            ) : null}
            {testState === "error" ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                <XCircle className="size-3.5" />
                {testError}
              </p>
            ) : null}
          </div>
          <Button variant="outline" size="sm" onClick={handleTestDm} disabled={testState === "sending"}>
            {testState === "sending" ? <Loader2 className="size-4 animate-spin" /> : null}
            Send test
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
