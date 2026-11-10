"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { saveStageRottingRequest } from "@/lib/sales/api-client";
import type { StageSettings } from "@/lib/sales/settings";
import { stageRottingPatch, stageSaveToast } from "@/lib/sales/settings-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The "Edit stages" dialog (Mockup v2 `stagesModal`, Decision 28, A8): rotting
// days only, per stage. Won and lost stages read "Never" (not editable); every
// other stage shows "Goes stale after [box] days" with a per-row error. Save
// sends only changes; nothing changed toasts "No changes to save." without a
// request.

type Props = {
  pipeline: StageSettings;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
};

function startingInputs(pipeline: StageSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stage of pipeline.stages) {
    if (stage.isWon || stage.isLost) continue;
    out[stage.id] = stage.rottingDays === null ? "" : String(stage.rottingDays);
  }
  return out;
}

export function StageEditorDialog({ pipeline, open, onOpenChange, onSaved }: Props) {
  // SettingsView mounts this fresh whenever Edit stages opens (it only renders
  // this when `editing` is set), so the starting inputs are seeded once on
  // mount and nothing stale survives into the next open.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [inputs, setInputs] = useState<Record<string, string>>(() => startingInputs(pipeline));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function onChange(stageId: string, text: string) {
    setInputs((prev) => ({ ...prev, [stageId]: text }));
    if (errors[stageId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[stageId];
        return next;
      });
    }
  }

  async function onSave() {
    const patched = stageRottingPatch(pipeline.stages, inputs);
    if (!patched.ok) {
      setErrors(patched.errors);
      return;
    }
    if (patched.stages.length === 0) {
      toast(stageSaveToast(0));
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const result = await saveStageRottingRequest(pipeline.id, { stages: patched.stages });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(stageSaveToast(patched.stages.length));
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent initialFocus={cancelRef} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{pipeline.name} stages</DialogTitle>
          <DialogDescription>
            A deal&apos;s days-in-stage pill turns amber when it sits in a stage this long. Leave a box empty for never.
          </DialogDescription>
        </DialogHeader>

        <ul className="m-0 flex max-h-[60vh] flex-col divide-y overflow-y-auto">
          {pipeline.stages.map((stage) => {
            const kind = stage.isWon ? "won" : stage.isLost ? "lost" : "";
            const fieldId = `rot-${stage.id}`;
            const errorId = `rot-${stage.id}-error`;
            return (
              <li key={stage.id} className="flex flex-wrap items-center gap-2 py-2 max-sm:flex-col max-sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-foreground">{stage.name}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {stage.probability}% win chance{kind === "won" ? ", won stage" : kind === "lost" ? ", lost stage" : ""}
                  </div>
                </div>
                {kind === "won" || kind === "lost" ? (
                  <span className="text-[13px] text-muted-foreground">Never</span>
                ) : (
                  <div className="flex flex-col gap-1 max-sm:w-full">
                    <label htmlFor={fieldId} className="flex items-center gap-1.5 text-[13px]">
                      <span>Goes stale after</span>
                      <input
                        id={fieldId}
                        type="number"
                        min={1}
                        max={365}
                        step={1}
                        inputMode="numeric"
                        value={inputs[stage.id] ?? ""}
                        onChange={(event) => onChange(stage.id, event.target.value)}
                        aria-label={`${stage.name}: days before it goes stale`}
                        aria-invalid={errors[stage.id] ? true : undefined}
                        aria-describedby={errors[stage.id] ? errorId : undefined}
                        className={cn(
                          "h-9 w-20 rounded-md border bg-background px-2 text-[13px] tabular-nums pointer-coarse:h-10",
                          errors[stage.id] && "border-destructive",
                        )}
                      />
                      <span>days</span>
                    </label>
                    {errors[stage.id] ? (
                      <p id={errorId} role="alert" className="text-[12px] font-medium text-destructive">
                        {errors[stage.id]}
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <p className="text-[12.5px] text-muted-foreground">
          Only the stale timer changes here. Stage names, order and win chances stay as they are.
        </p>

        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="pointer-coarse:min-h-10"
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={saving} className="pointer-coarse:min-h-10">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
