"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2, X } from "lucide-react";

import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_VALUES, type CampaignStageValue } from "@/lib/campaign-stage";
import { ROLE_TAG_LABELS, ROLE_TAG_VALUES, type RoleTagValue } from "@/lib/role-tag";
import { PROGRAM_PRODUCT_LABELS } from "@/lib/validations/program";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type TemplateTask = { title: string; roleTag: RoleTagValue; daysBeforeMailDate: number | null };
type StagesDraft = Record<CampaignStageValue, TemplateTask[]>;

export type ProgramTemplateWithStages = {
  id: string;
  name: string;
  product: string | null;
  isActive: boolean;
  stages: {
    stage: CampaignStageValue;
    tasks: { title: string; roleTag: RoleTagValue; daysBeforeMailDate: number | null }[];
  }[];
};

function stagesToDraft(template: ProgramTemplateWithStages): StagesDraft {
  const byStage = new Map(template.stages.map((s) => [s.stage, s.tasks]));
  return Object.fromEntries(
    CAMPAIGN_STAGE_VALUES.map((stage) => [stage, byStage.get(stage) ?? []])
  ) as StagesDraft;
}

export function TemplateEditor({ template }: { template: ProgramTemplateWithStages }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [stagesDraft, setStagesDraft] = useState<StagesDraft>(() => stagesToDraft(template));
  const [isActive, setIsActive] = useState(template.isActive);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newTask, setNewTask] = useState<Record<string, { title: string; roleTag: RoleTagValue; daysBeforeMailDate: string }>>({});

  const baseline = stagesToDraft(template);
  const isDirty = JSON.stringify(stagesDraft) !== JSON.stringify(baseline) || isActive !== template.isActive;

  function draftFor(stage: CampaignStageValue) {
    return newTask[stage] ?? { title: "", roleTag: "ACCOUNT_MANAGER" as RoleTagValue, daysBeforeMailDate: "" };
  }

  function addTask(stage: CampaignStageValue) {
    const draft = draftFor(stage);
    if (!draft.title.trim()) return;
    setStagesDraft((prev) => ({
      ...prev,
      [stage]: [
        ...prev[stage],
        {
          title: draft.title.trim(),
          roleTag: draft.roleTag,
          daysBeforeMailDate: draft.daysBeforeMailDate ? Number(draft.daysBeforeMailDate) : null,
        },
      ],
    }));
    setNewTask((prev) => ({ ...prev, [stage]: { title: "", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: "" } }));
  }

  function removeTask(stage: CampaignStageValue, index: number) {
    setStagesDraft((prev) => ({ ...prev, [stage]: prev[stage].filter((_, i) => i !== index) }));
  }

  async function save() {
    setIsSaving(true);
    const response = await fetch(`/api/program-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isActive,
        stages: CAMPAIGN_STAGE_VALUES.map((stage) => ({ stage, tasks: stagesDraft[stage] })),
      }),
    });
    setIsSaving(false);
    if (response.ok) router.refresh();
  }

  async function handleDelete() {
    if (!window.confirm(`Delete template "${template.name}"? This does not affect any in-flight programs.`)) return;
    setIsDeleting(true);
    const response = await fetch(`/api/program-templates/${template.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (response.ok) router.refresh();
  }

  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <p className="font-medium">{template.name}</p>
          <p className="text-xs text-muted-foreground">
            {template.product ? PROGRAM_PRODUCT_LABELS[template.product] ?? template.product : "Any product"}
            {!isActive ? " · Inactive" : ""}
          </p>
        </div>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div className="space-y-4 border-t px-4 py-4">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDelete} disabled={isDeleting}>
              <Trash2 className="size-3.5" />
              {isDeleting ? "Deleting..." : "Delete template"}
            </Button>
          </div>

          {CAMPAIGN_STAGE_VALUES.map((stage) => (
            <div key={stage} className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">{CAMPAIGN_STAGE_LABELS[stage]}</p>
              {stagesDraft[stage].length > 0 ? (
                <ul className="space-y-1.5">
                  {stagesDraft[stage].map((task, index) => (
                    <li key={index} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {ROLE_TAG_LABELS[task.roleTag]}
                      </span>
                      {task.daysBeforeMailDate != null ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{task.daysBeforeMailDate}d before mail</span>
                      ) : null}
                      <button onClick={() => removeTask(stage, index)} className="shrink-0 text-muted-foreground hover:text-destructive">
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No tasks in this stage yet.</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  value={draftFor(stage).title}
                  onChange={(e) => setNewTask((prev) => ({ ...prev, [stage]: { ...draftFor(stage), title: e.target.value } }))}
                  placeholder="Task title"
                  className="h-8 flex-1 text-sm"
                />
                <Select
                  value={draftFor(stage).roleTag}
                  onValueChange={(value) =>
                    value && setNewTask((prev) => ({ ...prev, [stage]: { ...draftFor(stage), roleTag: value as RoleTagValue } }))
                  }
                >
                  <SelectTrigger className="h-8 w-[140px] text-sm">
                    <SelectValue>{(value: string) => ROLE_TAG_LABELS[value as RoleTagValue]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_TAG_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ROLE_TAG_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={draftFor(stage).daysBeforeMailDate}
                  onChange={(e) =>
                    setNewTask((prev) => ({ ...prev, [stage]: { ...draftFor(stage), daysBeforeMailDate: e.target.value } }))
                  }
                  placeholder="Days before mail"
                  className="h-8 w-[130px] text-sm"
                />
                <Button variant="outline" size="icon-sm" aria-label="Add task" onClick={() => addTask(stage)}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          ))}

          {isDirty ? (
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => { setStagesDraft(baseline); setIsActive(template.isActive); }}>
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={isSaving}>
                {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {isSaving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
