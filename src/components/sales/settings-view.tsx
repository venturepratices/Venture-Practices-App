"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert, Inbox, Lock, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { saveSettingsRequest } from "@/lib/sales/api-client";
import { assignmentLine } from "@/lib/sales/leads-client";
import { refreshAfterWrite } from "@/lib/sales/panel-url";
import type { LeadAssignmentView, StageSettings } from "@/lib/sales/settings";
import {
  type AssignmentDraft,
  assignmentError,
  draftFromView,
  pipelineLine,
  SALES_RULES,
  settingsPatch,
} from "@/lib/sales/settings-client";
import { Button } from "@/components/ui/button";
import { LeadAssignmentCard } from "@/components/sales/lead-assignment-card";
import { StageEditorDialog } from "@/components/sales/stage-editor-dialog";

// The Sales settings screen on the client (Mockup v2 `viewSettings`): the
// "Who gets new leads" card with the save bar, the "Rules (always on)" list
// and the "Pipelines and stages" list with Edit stages. Admins only (the page
// gates this with notFound() for non-admins). Cards stack on phones; checkbox
// rows wrap with 40px hit areas; the pipeline row's Edit button drops under
// the name under 640px.

/** The card container (white box with a soft shadow, as other Sales cards). */
const CARD = "rounded-[12px] border bg-card shadow-sm";
const CARD_HEAD =
  "flex items-center gap-2 border-b px-4 py-3 text-[14px] font-semibold text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground";

function CardHeader({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className={CARD_HEAD}>
      <Icon aria-hidden="true" />
      <h3 className="m-0 text-[14px] font-semibold">{children}</h3>
    </div>
  );
}

export function SettingsView({
  assignment,
  pipelines,
}: {
  assignment: LeadAssignmentView;
  pipelines: StageSettings[];
}) {
  const router = useRouter();
  // The card's draft, reset from the server view after each save. `view`
  // tracks the newest `assignment` prop so a server refresh (after a save, or
  // from somewhere else) resets the draft. React 19 lets us keep this in sync
  // during render: when the prop changes, re-seed the state directly.
  const [view, setView] = useState<LeadAssignmentView>(assignment);
  const [draft, setDraft] = useState<AssignmentDraft>(() => draftFromView(assignment));
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<StageSettings | null>(null);

  // When the server hands us a new view, reset the draft. React 19 keeps the
  // first render that calls setState during render; nothing paints with a
  // stale value, and no cascading re-render comes from an effect.
  if (view !== assignment) {
    setView(assignment);
    setDraft(draftFromView(assignment));
    setServerError(null);
  }

  const patch = settingsPatch(draft, view);
  const dirty = patch !== null;
  const inlineError = assignmentError(draft, view);

  function onCancel() {
    setDraft(draftFromView(view));
    setServerError(null);
  }

  async function onSave() {
    setServerError(null);
    const error = assignmentError(draft, view);
    if (error) {
      setServerError(error);
      return;
    }
    if (!patch) return;
    setSaving(true);
    try {
      const result = await saveSettingsRequest(patch);
      if (!result.ok) {
        setServerError(result.error);
        // The settings route hands back `ASSIGNEE_LOST_ACCESS` so the screen
        // opens the person select; the inline error carries the reason.
        return;
      }
      setView(result.data.view);
      setDraft(draftFromView(result.data.view));
      toast.success("Saved.");
      refreshAfterWrite(router);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="m-0 text-[21px] font-semibold">Sales settings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Admins only.</p>
      </div>

      <div className="flex flex-col gap-4">
        <section className={CARD}>
          <CardHeader icon={Inbox}>Who gets new leads</CardHeader>
          <LeadAssignmentCard
            view={view}
            draft={draft}
            onDraftChange={setDraft}
            inlineError={serverError ?? inlineError}
          />
          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-4 py-2.5">
            {dirty ? <span className="mr-auto text-[12.5px] text-muted-foreground">Unsaved changes</span> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dirty || saving}
              onClick={onCancel}
              className="pointer-coarse:min-h-10"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving}
              onClick={onSave}
              className="pointer-coarse:min-h-10"
            >
              Save
            </Button>
          </div>
          {/* The bare rule sentence under the card: who really gets the next lead.
              No "Change it in Sales settings." here, since we are already in it. */}
          <p className="px-4 py-2 text-[12.5px] text-muted-foreground">{assignmentLine(view.effective, false)}</p>
        </section>

        <section className={CARD}>
          <CardHeader icon={Lock}>Rules (always on)</CardHeader>
          <ul className="m-0 flex flex-col gap-1.5 px-4 py-3 text-[13.5px] leading-snug">
            {SALES_RULES.map((rule, index) => (
              <li key={index} className="flex gap-2">
                <CircleAlert aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={CARD}>
          <CardHeader icon={SlidersHorizontal}>Pipelines and stages</CardHeader>
          <ul className="m-0 flex flex-col divide-y">
            {pipelines.map((pipeline) => (
              <li
                key={pipeline.id}
                className="flex flex-wrap items-center gap-2 px-4 py-3 max-sm:flex-col max-sm:items-start"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-foreground">{pipeline.name}</div>
                  <div className="text-[12.5px] text-muted-foreground">{pipelineLine(pipeline)}</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Edit stages for ${pipeline.name}`}
                  onClick={() => setEditing(pipeline)}
                  className="pointer-coarse:min-h-10 max-sm:w-full"
                >
                  Edit stages
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {editing ? (
        <StageEditorDialog
          pipeline={editing}
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={() => refreshAfterWrite(router)}
        />
      ) : null}
    </div>
  );
}
