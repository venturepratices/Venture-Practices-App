"use client";

import { useState } from "react";
import { toast } from "sonner";

import { setActivityDoneRequest, type SalesParentRef } from "@/lib/sales/api-client";
import { needsNextStepPrompt } from "@/lib/sales/panel-client";
import { NextStepDialog } from "@/components/sales/next-step-dialog";

// Ticking an activity done, shared by the deal panel's Next steps and the
// Activities page. The server answers with how many open activities its deal
// or lead still has; an open one left with none asks for its next step (spec
// rule 1). A second tick of the same activity (a double-click) changes nothing
// and says nothing more. The caller renders `dialogs` (inside its own dialog,
// if it has one, so the prompt stacks on top of it).

type Parent = SalesParentRef & { title: string };

export function useActivityDone(onChanged: () => void): {
  markDone(activity: { id: string; subject: string }, parent: Parent): Promise<void>;
  dialogs: React.ReactNode;
} {
  // The parent stays set while the prompt plays its closing animation, so its text does not blank out.
  const [promptParent, setPromptParent] = useState<Parent | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  async function markDone(activity: { id: string; subject: string }, parent: Parent) {
    const result = await setActivityDoneRequest(activity.id, true);
    if (!result.ok) {
      toast.error(result.error);
      onChanged();
      return;
    }
    if (result.data.changed) {
      toast("Marked done.");
      if (needsNextStepPrompt(result.data.parent)) {
        setPromptParent({ kind: parent.kind, id: parent.id, title: parent.title });
        setPromptOpen(true);
      }
    }
    onChanged();
  }

  const dialogs = promptParent ? (
    <NextStepDialog open={promptOpen} onOpenChange={setPromptOpen} parent={promptParent} onScheduled={onChanged} />
  ) : null;

  return { markDone, dialogs };
}
