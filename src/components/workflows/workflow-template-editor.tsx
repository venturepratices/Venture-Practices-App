"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronUp, Link2, Loader2, Plus, Trash2, X } from "lucide-react";

import { TASK_STATUS_LABELS } from "@/components/tasks/status-pill";
import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";
import { TASK_STATUS_VALUES } from "@/lib/validations/task";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TaskStatusValue = (typeof TASK_STATUS_VALUES)[number];
type TeamMemberOption = { id: string; name: string };
type TemplateTaskLinkDraft = { url: string; label: string };

type TemplateTaskDraft = {
  title: string;
  description: string | null;
  defaultStatus: TaskStatusValue;
  defaultAssigneeIds: string[];
  links: TemplateTaskLinkDraft[];
};

type TemplateStageDraft = {
  name: string;
  description: string | null;
  tasks: TemplateTaskDraft[];
};

export type WorkflowTemplateWithStages = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  stageTemplates: {
    name: string;
    description: string | null;
    taskTemplates: {
      title: string;
      description: string | null;
      defaultStatus: TaskStatusValue;
      defaultAssignees: { teamMember: { id: string; name: string } }[];
      links: { url: string; label: string }[];
    }[];
  }[];
};

function templateToDraft(template: WorkflowTemplateWithStages): TemplateStageDraft[] {
  return template.stageTemplates.map((stage) => ({
    name: stage.name,
    description: stage.description,
    tasks: stage.taskTemplates.map((task) => ({
      title: task.title,
      description: task.description,
      defaultStatus: task.defaultStatus,
      defaultAssigneeIds: task.defaultAssignees.map((a) => a.teamMember.id),
      links: task.links.map((link) => ({ url: link.url, label: link.label })),
    })),
  }));
}

const EMPTY_NEW_TASK: TemplateTaskDraft = { title: "", description: null, defaultStatus: "NEXT_UP", defaultAssigneeIds: [], links: [] };
const EMPTY_NEW_LINK: TemplateTaskLinkDraft = { url: "", label: "" };

export function WorkflowTemplateEditor({
  template,
  teamMembers,
}: {
  template: WorkflowTemplateWithStages;
  teamMembers: TeamMemberOption[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [stagesDraft, setStagesDraft] = useState<TemplateStageDraft[]>(() => templateToDraft(template));
  const [isActive, setIsActive] = useState(template.isActive);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newTaskByStage, setNewTaskByStage] = useState<Record<number, TemplateTaskDraft>>({});
  const [newLinkByStage, setNewLinkByStage] = useState<Record<number, TemplateTaskLinkDraft>>({});

  const baseline = templateToDraft(template);
  const isDirty = JSON.stringify(stagesDraft) !== JSON.stringify(baseline) || isActive !== template.isActive;

  function draftFor(stageIndex: number): TemplateTaskDraft {
    return newTaskByStage[stageIndex] ?? EMPTY_NEW_TASK;
  }

  function linkDraftFor(stageIndex: number): TemplateTaskLinkDraft {
    return newLinkByStage[stageIndex] ?? EMPTY_NEW_LINK;
  }

  function updateStageDescription(stageIndex: number, description: string) {
    setStagesDraft((prev) => prev.map((s, i) => (i === stageIndex ? { ...s, description: description || null } : s)));
  }

  function updateNewTaskDescription(stageIndex: number, description: string) {
    setNewTaskByStage((prev) => ({ ...prev, [stageIndex]: { ...draftFor(stageIndex), description: description || null } }));
  }

  function addPendingLink(stageIndex: number) {
    const link = linkDraftFor(stageIndex);
    if (!link.label.trim() || !link.url.trim()) return;
    setNewTaskByStage((prev) => ({
      ...prev,
      [stageIndex]: { ...draftFor(stageIndex), links: [...draftFor(stageIndex).links, { url: link.url.trim(), label: link.label.trim() }] },
    }));
    setNewLinkByStage((prev) => ({ ...prev, [stageIndex]: EMPTY_NEW_LINK }));
  }

  function removePendingLink(stageIndex: number, linkIndex: number) {
    setNewTaskByStage((prev) => ({
      ...prev,
      [stageIndex]: { ...draftFor(stageIndex), links: draftFor(stageIndex).links.filter((_, i) => i !== linkIndex) },
    }));
  }

  function addStage() {
    if (!newStageName.trim()) return;
    setStagesDraft((prev) => [...prev, { name: newStageName.trim(), description: null, tasks: [] }]);
    setNewStageName("");
  }

  function removeStage(stageIndex: number) {
    setStagesDraft((prev) => prev.filter((_, i) => i !== stageIndex));
  }

  function moveStage(stageIndex: number, direction: -1 | 1) {
    setStagesDraft((prev) => {
      const target = stageIndex + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[stageIndex], next[target]] = [next[target], next[stageIndex]];
      return next;
    });
  }

  function renameStage(stageIndex: number, name: string) {
    setStagesDraft((prev) => prev.map((s, i) => (i === stageIndex ? { ...s, name } : s)));
  }

  function addTask(stageIndex: number) {
    const draft = draftFor(stageIndex);
    if (!draft.title.trim()) return;
    setStagesDraft((prev) =>
      prev.map((s, i) => (i === stageIndex ? { ...s, tasks: [...s.tasks, { ...draft, title: draft.title.trim() }] } : s))
    );
    setNewTaskByStage((prev) => ({ ...prev, [stageIndex]: EMPTY_NEW_TASK }));
    setNewLinkByStage((prev) => ({ ...prev, [stageIndex]: EMPTY_NEW_LINK }));
  }

  function removeTask(stageIndex: number, taskIndex: number) {
    setStagesDraft((prev) =>
      prev.map((s, i) => (i === stageIndex ? { ...s, tasks: s.tasks.filter((_, ti) => ti !== taskIndex) } : s))
    );
  }

  async function save() {
    setIsSaving(true);
    const response = await fetch(`/api/workflow-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isActive,
        stageTemplates: stagesDraft.map((stage) => ({
          name: stage.name,
          description: stage.description,
          taskTemplates: stage.tasks.map((task) => ({
            title: task.title,
            description: task.description,
            defaultStatus: task.defaultStatus,
            defaultAssigneeIds: task.defaultAssigneeIds,
            links: task.links,
          })),
        })),
      }),
    });
    setIsSaving(false);
    if (response.ok) router.refresh();
  }

  async function handleDelete() {
    if (!window.confirm(`Delete template "${template.name}"? This does not affect any in-flight workflows.`)) return;
    setIsDeleting(true);
    const response = await fetch(`/api/workflow-templates/${template.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (response.ok) router.refresh();
  }

  return (
    <div className="rounded-lg border">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div>
          <p className="font-medium">{template.name}</p>
          <p className="text-xs text-muted-foreground">
            {stagesDraft.length} stage{stagesDraft.length === 1 ? "" : "s"}
            {!isActive ? " · Inactive" : ""}
          </p>
        </div>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div className="space-y-5 border-t px-4 py-4">
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

          {stagesDraft.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stages yet. Add one below to start building the pipeline.</p>
          ) : (
            <ol className="space-y-4">
              {stagesDraft.map((stage, stageIndex) => (
                <li key={stageIndex} className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground">Stage {stageIndex + 1}</span>
                    <Input
                      value={stage.name}
                      onChange={(e) => renameStage(stageIndex, e.target.value)}
                      className="h-8 flex-1 text-sm font-medium"
                    />
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Move stage up"
                        disabled={stageIndex === 0}
                        onClick={() => moveStage(stageIndex, -1)}
                      >
                        <ChevronUp className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Move stage down"
                        disabled={stageIndex === stagesDraft.length - 1}
                        onClick={() => moveStage(stageIndex, 1)}
                      >
                        <ChevronDown className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Remove stage" onClick={() => removeStage(stageIndex)}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <Textarea
                    value={stage.description ?? ""}
                    onChange={(e) => updateStageDescription(stageIndex, e.target.value)}
                    placeholder="Stage description (optional)"
                    className="mt-2 min-h-14 text-xs"
                  />

                  <div className="mt-3 space-y-2">
                    {stage.tasks.length > 0 ? (
                      <ul className="space-y-1.5">
                        {stage.tasks.map((task, taskIndex) => (
                          <li key={taskIndex} className="rounded-md border bg-background px-2.5 py-1.5 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 flex-1 truncate">{task.title}</span>
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {TASK_STATUS_LABELS[task.defaultStatus]}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {task.defaultAssigneeIds.length > 0
                                  ? teamMembers
                                      .filter((m) => task.defaultAssigneeIds.includes(m.id))
                                      .map((m) => m.name)
                                      .join(", ")
                                  : "Unassigned"}
                              </span>
                              <button onClick={() => removeTask(stageIndex, taskIndex)} className="shrink-0 text-muted-foreground hover:text-destructive">
                                <X className="size-3.5" />
                              </button>
                            </div>
                            {task.description || task.links.length > 0 ? (
                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                {task.description ? <span className="min-w-0 flex-1 truncate">{task.description}</span> : null}
                                {task.links.length > 0 ? (
                                  <span className="flex shrink-0 items-center gap-0.5">
                                    <Link2 className="size-3" />
                                    {task.links.length}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tasks in this stage yet.</p>
                    )}

                    <div className="space-y-1.5 rounded-md border border-dashed p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Input
                          value={draftFor(stageIndex).title}
                          onChange={(e) => setNewTaskByStage((prev) => ({ ...prev, [stageIndex]: { ...draftFor(stageIndex), title: e.target.value } }))}
                          placeholder="Task title"
                          className="h-8 flex-1 text-sm"
                        />
                        <Select
                          value={draftFor(stageIndex).defaultStatus}
                          onValueChange={(value) =>
                            value &&
                            setNewTaskByStage((prev) => ({ ...prev, [stageIndex]: { ...draftFor(stageIndex), defaultStatus: value as TaskStatusValue } }))
                          }
                        >
                          <SelectTrigger className="h-8 w-[140px] text-sm">
                            <SelectValue>{(value: string) => TASK_STATUS_LABELS[value] ?? value}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TASK_STATUS_VALUES.map((value) => (
                              <SelectItem key={value} value={value}>
                                {TASK_STATUS_LABELS[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <TaskAssigneesPicker
                          teamMembers={teamMembers}
                          value={draftFor(stageIndex).defaultAssigneeIds}
                          onChange={(ids) => setNewTaskByStage((prev) => ({ ...prev, [stageIndex]: { ...draftFor(stageIndex), defaultAssigneeIds: ids } }))}
                          triggerClassName="h-8 w-[160px]"
                        />
                        <Button variant="outline" size="icon-sm" aria-label="Add task" onClick={() => addTask(stageIndex)}>
                          <Plus className="size-4" />
                        </Button>
                      </div>

                      <Textarea
                        value={draftFor(stageIndex).description ?? ""}
                        onChange={(e) => updateNewTaskDescription(stageIndex, e.target.value)}
                        placeholder="Task description (optional)"
                        className="h-8 min-h-8 text-xs"
                      />

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Input
                          value={linkDraftFor(stageIndex).label}
                          onChange={(e) => setNewLinkByStage((prev) => ({ ...prev, [stageIndex]: { ...linkDraftFor(stageIndex), label: e.target.value } }))}
                          placeholder="Link label"
                          className="h-7 w-[120px] text-xs"
                        />
                        <Input
                          value={linkDraftFor(stageIndex).url}
                          onChange={(e) => setNewLinkByStage((prev) => ({ ...prev, [stageIndex]: { ...linkDraftFor(stageIndex), url: e.target.value } }))}
                          placeholder="https://..."
                          className="h-7 flex-1 text-xs"
                        />
                        <Button variant="outline" size="icon-sm" aria-label="Add link" onClick={() => addPendingLink(stageIndex)}>
                          <Link2 className="size-3.5" />
                        </Button>
                      </div>

                      {draftFor(stageIndex).links.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {draftFor(stageIndex).links.map((link, linkIndex) => (
                            <span key={linkIndex} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                              {link.label}
                              <button onClick={() => removePendingLink(stageIndex, linkIndex)}>
                                <X className="size-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="flex items-center gap-1.5 border-t pt-3">
            <Input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="New stage name (e.g. Kickoff)"
              className="h-8 flex-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") addStage();
              }}
            />
            <Button variant="outline" size="sm" onClick={addStage} disabled={!newStageName.trim()}>
              <Plus className="size-3.5" />
              Add stage
            </Button>
          </div>

          {isDirty ? (
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStagesDraft(baseline);
                  setIsActive(template.isActive);
                }}
              >
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
