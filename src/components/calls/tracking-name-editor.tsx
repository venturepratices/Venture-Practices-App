"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TRACKING_LABEL_MAX } from "@/lib/calls/tracking-label-limits";

/**
 * A tracking number's name and number side by side ("Direct Mail (704)
 * 397-3212"). People who can manage HighLevel get "+ Add name" (or a pencil)
 * to type the name once; it is saved for the client and shows everywhere the
 * number does. Everyone else just sees the name, or "Unlabeled".
 */
export function TrackingNameEditor({
  number,
  label,
  phoneText,
  canEdit,
}: {
  number: string;
  label: string | null;
  phoneText: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True from the moment the name is saved until the page has reloaded with it,
  // so the old "+ Add name" is not left looking unsaved.
  const [refreshing, startRefresh] = useTransition();

  function startEditing() {
    setValue(label ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/calls/tracking-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, label: value }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "Couldn't save the name. Try again.");
        return;
      }
      setEditing(false);
      startRefresh(() => router.refresh());
    } catch {
      setError("Couldn't reach the app. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        className="min-w-0 space-y-1"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={value}
            maxLength={TRACKING_LABEL_MAX}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") cancel();
            }}
            placeholder="Name, for example Direct Mail"
            aria-label={`Name for ${phoneText}`}
            className="h-8 w-full min-w-0 sm:w-56"
          />
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground">{phoneText}</span>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Leave it empty and save to remove the name.</p>
        )}
      </form>
    );
  }

  if (refreshing) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" aria-live="polite">
        <span className="text-xs text-muted-foreground">Saving name...</span>
        <span className="text-xs text-muted-foreground">{phoneText}</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {label ? (
        <span className="font-medium">{label}</span>
      ) : canEdit ? (
        <button
          type="button"
          onClick={startEditing}
          className="inline-flex items-center rounded-md border border-dashed border-input px-2 py-0.5 text-xs text-primary hover:bg-muted pointer-coarse:min-h-9"
        >
          + Add name
        </button>
      ) : (
        <span className="font-medium">Unlabeled</span>
      )}
      {label && canEdit ? (
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Rename ${label}`}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-9"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : null}
      <span className="text-xs text-muted-foreground">{phoneText}</span>
    </div>
  );
}
