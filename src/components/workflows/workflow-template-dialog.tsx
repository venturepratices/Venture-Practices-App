"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlignLeft, ChevronLeft, ChevronRight, Link2, Loader2, Plus, Trash2, X } from "lucide-react";

import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";
import type { StatusOptionLite } from "@/lib/task-status-utils";
import { resolveStatusOption, statusLabelMap } from "@/lib/task-status-utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ComposerField = "description" | "link";

type TeamMemberOption = { id: string; name: string };
type TemplateTaskLinkDraft = { url: string; label: string };

type TemplateTaskDraft = {
  title: string;
  description: string | null;
  defaultStatus: string;
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
  folderId: string | null;
  stageTemplates: {
    name: string;
    description: string | null;
    taskTemplates: {
      title: string;
      description: string | null;
      defaultStatus: string;
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

/**
 * The popup template editor: one stage per page instead of one long scroll.
 * Jump to any stage from the pill strip up top, or step with the footer
 * pager. Replaces the old expand-in-place WorkflowTemplateEditor — a
 * 12-stage template (e.g. a monthly socials calendar) never scrolls past
 * one stage's tasks.
 *
 * Save is the same full-tree-replace PATCH the old editor used; in-flight
 * projects are unaffected (they hold a frozen stagesSnapshot).
 */
export function WorkflowTemplateDialog({
  template,
  teamMembers,
  statusOptions = [],
  open,
  onOpenChange,
}: {
  template: WorkflowTemplateWithStages;
  teamMembers: TeamMemberOption[];
  statusOptions?: StatusOptionLite[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [stagesDraft, setStagesDraft] = useState<TemplateStageDraft[]>(() => templateToDraft(template));
  const [isActive, setIsActive] = useState(template.isActive);
  const [activeStage, setActiveStage] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [addingStage, setAddingStage] = useState(false);
  const [newTask, setNewTask] = useState<TemplateTaskDraft>(EMPTY_NEW_TASK);
  const [newLink, setNewLink] = useState<TemplateTaskLinkDraft>(EMPTY_NEW_LINK);
  const [composerFields, setComposerFields] = useState<Record<ComposerField, boolean>>({ description: false, link: false });

  const baseline = templateToDraft(template);
  const isDirty = JSON.stringify(stagesDraft) !== JSON.stringify(baseline) || isActive !== template.isActive;
  const stage = stagesDraft[activeStage] as TemplateStageDraft | undefined;
  const totalTasks = stagesDraft.reduce((sum, s) => sum + s.tasks.length, 0);

  function goToStage(index: number) {
    setActiveStage(Math.max(0, Math.min(index, stagesDraft.length - 1)));
    // The composer is per-page state; switching pages clears it so a
    // half-typed task never silently lands in the wrong stage.
    setNewTask(EMPTY_NEW_TASK);
    setNewLink(EMPTY_NEW_LINK);
    setComposerFields({ description: false, link: false });
  }

  function addStage() {
    const name = newStageName.trim();
    if (!name) return;
    setStagesDraft((prev) => [...prev, { name, description: null, tasks: [] }]);
    setNewStageName("");
    setAddingStage(false);
    // Jump straight onto the new stage's page.
    setActiveStage(stagesDraft.length);
  }

  function removeStage(index: number) {
    if (!window.confirm(`Remove stage "${stagesDraft[index].name}" and its ${stagesDraft[index].tasks.length} task(s) from the draft?`)) return;
    setStagesDraft((prev) => prev.filter((_, i) => i !== index));
    setActiveStage((current) => Math.max(0, Math.min(current, stagesDraft.length - 2)));
  }

  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stagesDraft.length) return;
    setStagesDraft((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    // Keep the page on the stage being moved.
    setActiveStage(target);
  }

  function renameStage(index: number, name: string) {
    setStagesDraft((prev) => prev.map((s, i) => (i === index ? { ...s, name } : s)));
  }

  function updateStageDescription(index: number, description: string) {
    setStagesDraft((prev) => prev.map((s, i) => (i === index ? { ...s, description: description || null } : s)));
  }

  function addTask() {
    if (!newTask.title.trim() || stage === undefined) return;
    setStagesDraft((prev) =>
      prev.map((s, i) => (i === activeStage ? { ...s, tasks: [...s.tasks, { ...newTask, title: newTask.title.trim() }] } : s))
    );
    setNewTask(EMPTY_NEW_TASK);
    setNewLink(EMPTY_NEW_LINK);
    setComposerFields({ description: false, link: false });
  }

  function removeTask(taskIndex: number) {
    setStagesDraft((prev) =>
      prev.map((s, i) => (i === activeStage ? { ...s, tasks: s.tasks.filter((_, ti) => ti !== taskIndex) } : s))
    );
  }

  function addPendingLink() {
    if (!newLink.label.trim() || !newLink.url.trim()) return;
    setNewTask((prev) => ({ ...prev, links: [...prev.links, { url: newLink.url.trim(), label: newLink.label.trim() }] }));
    setNewLink(EMPTY_NEW_LINK);
  }

  function removePendingLink(linkIndex: number) {
    setNewTask((prev) => ({ ...prev, links: prev.links.filter((_, i) => i !== linkIndex) }));
  }

  async function save() {
    setIsSaving(true);
    const response = await fetch(`/api/workflow-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isActive,
        stageTemplates: stagesDraft.map((s) => ({
          name: s.name,
          description: s.description,
          taskTemplates: s.tasks.map((task) => ({
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

  function handleOpenChange(next: boolean) {
    if (!next && isDirty && !window.confirm("You have unsaved changes. Close without saving?")) return;
    if (!next) {
      // Reset the draft so reopening always starts from what's saved.
      setStagesDraft(templateToDraft(template));
      setIsActive(template.isActive);
      setActiveStage(0);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl" showCloseButton={false}>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 border-b px-5 py-3.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <DialogTitle className="truncate text-lg font-bold">{template.name}</DialogTitle>
            <span className="shrink-0 text-xs text-muted-foreground">
              {stagesDraft.length} stage{stagesDraft.length === 1 ? "" : "s"} · {totalTasks} task{totalTasks === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
            {isDirty ? (
              <Button size="sm" onClick={save} disabled={isSaving}>
                {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {isSaving ? "Saving..." : "Save changes"}
              </Button>
            ) : null}
            <Button variant="ghost" size="icon-sm" onClick={() => handleOpenChange(false)} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Stage pill strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b px-5 py-2.5">
          {stagesDraft.map((s, index) => (
            <button
              key={index}
              type="button"
              onClick={() => goToStage(index)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                index === activeStage
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full text-[10px] font-bold",
                  index === activeStage ? "bg-primary-foreground/25 text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {index + 1}
              </span>
              {s.name || "(unnamed)"}
            </button>
          ))}
          {addingStage ? (
            <Input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="Stage name"
              className="h-7 w-36 shrink-0 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") addStage();
                if (e.key === "Escape") setAddingStage(false);
              }}
              onBlur={() => {
                if (newStageName.trim()) addStage();
                else setAddingStage(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingStage(true)}
              className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
            >
              <Plus className="size-3" />
              Add stage
            </button>
          )}
        </div>

        {/* Stage page */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {stage === undefined ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No stages yet. Click &quot;Add stage&quot; above to start building the pipeline.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Input
                  value={stage.name}
                  onChange={(e) => renameStage(activeStage, e.target.value)}
                  className="h-9 w-56 border-transparent bg-transparent px-2 text-base font-bold shadow-none hover:border-input focus-visible:border-ring"
                  aria-label="Stage name"
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move stage earlier"
                    title="Move stage earlier"
                    disabled={activeStage === 0}
                    onClick={() => moveStage(activeStage, -1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move stage later"
                    title="Move stage later"
                    disabled={activeStage === stagesDraft.length - 1}
                    onClick={() => moveStage(activeStage, 1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete stage"
                    title="Delete stage"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeStage(activeStage)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <p className="mb-3 px-2 text-xs text-muted-foreground">
                Stage {activeStage + 1} of {stagesDraft.length} · {stage.tasks.length} task{stage.tasks.length === 1 ? "" : "s"}
              </p>

              <Textarea
                value={stage.description ?? ""}
                onChange={(e) => updateStageDescription(activeStage, e.target.value)}
                placeholder="What is this stage for? (optional)"
                className="mb-4 min-h-12 text-xs"
              />

              {stage.tasks.length > 0 ? (
                <ul className="mb-3 space-y-2">
                  {stage.tasks.map((task, taskIndex) => (
                    <li key={taskIndex} className="rounded-lg border px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {statusLabelMap(statusOptions)[task.defaultStatus] ?? task.defaultStatus}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {task.defaultAssigneeIds.length > 0
                            ? teamMembers
                                .filter((m) => task.defaultAssigneeIds.includes(m.id))
                                .map((m) => m.name)
                                .join(", ")
                            : "Unassigned"}
                        </span>
                        <button
                          onClick={() => removeTask(taskIndex)}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${task.title}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      {task.description || task.links.length > 0 ? (
                        <div className="mt-1.5 flex items-center gap-2 border-t pt-1.5 text-xs text-muted-foreground">
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
                <p className="mb-3 text-xs text-muted-foreground">No tasks in this stage yet.</p>
              )}

              {/* Add-task composer, scoped to this stage's page */}
              <div className="space-y-2.5 rounded-lg border border-dashed bg-muted/20 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Add a task to {stage.name || "this stage"}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Input
                    value={newTask.title}
                    onChange={(e) => setNewTask((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Task title"
                    className="h-8 flex-1 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addTask();
                    }}
                  />
                  <Select
                    value={newTask.defaultStatus}
                    onValueChange={(value) => value && setNewTask((prev) => ({ ...prev, defaultStatus: value }))}
                  >
                    <SelectTrigger className="h-8 w-[140px] text-sm">
                      <SelectValue>{(value: string) => resolveStatusOption(statusOptions, value).label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <TaskAssigneesPicker
                    teamMembers={teamMembers}
                    value={newTask.defaultAssigneeIds}
                    onChange={(ids) => setNewTask((prev) => ({ ...prev, defaultAssigneeIds: ids }))}
                    triggerClassName="h-8 w-[160px]"
                  />
                  <Button variant="outline" size="icon-sm" aria-label="Add task" onClick={addTask}>
                    <Plus className="size-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setComposerFields((prev) => ({ ...prev, description: !prev.description }))}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      composerFields.description || newTask.description
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-input text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <AlignLeft className="size-3" />
                    Description
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerFields((prev) => ({ ...prev, link: !prev.link }))}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      composerFields.link || newTask.links.length > 0
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-input text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Link2 className="size-3" />
                    Link{newTask.links.length > 0 ? ` (${newTask.links.length})` : ""}
                  </button>
                </div>

                {composerFields.description ? (
                  <Textarea
                    value={newTask.description ?? ""}
                    onChange={(e) => setNewTask((prev) => ({ ...prev, description: e.target.value || null }))}
                    placeholder="Task description (optional)"
                    className="min-h-14 text-xs"
                    autoFocus
                  />
                ) : null}

                {composerFields.link ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Input
                        value={newLink.label}
                        onChange={(e) => setNewLink((prev) => ({ ...prev, label: e.target.value }))}
                        placeholder="Link label"
                        className="h-7 w-[120px] text-xs"
                        autoFocus
                      />
                      <Input
                        value={newLink.url}
                        onChange={(e) => setNewLink((prev) => ({ ...prev, url: e.target.value }))}
                        placeholder="https://..."
                        className="h-7 flex-1 text-xs"
                      />
                      <Button variant="outline" size="icon-sm" aria-label="Add link" onClick={addPendingLink}>
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                    {newTask.links.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {newTask.links.map((link, linkIndex) => (
                          <span key={linkIndex} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                            {link.label}
                            <button onClick={() => removePendingLink(linkIndex)} aria-label={`Remove ${link.label}`}>
                              <X className="size-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Footer pager */}
        {stagesDraft.length > 0 ? (
          <div className="flex items-center justify-between border-t px-5 py-3">
            <Button variant="outline" size="sm" disabled={activeStage === 0} onClick={() => goToStage(activeStage - 1)}>
              <ChevronLeft className="size-4" />
              {/* Stage names crowd a phone-width footer; the chevron + dots carry it there. */}
              <span className="hidden sm:inline">{activeStage > 0 ? stagesDraft[activeStage - 1].name || "Previous" : "Previous"}</span>
            </Button>
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1">
                {stagesDraft.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => goToStage(index)}
                    aria-label={`Go to stage ${index + 1}`}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      index === activeStage ? "w-5 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/40"
                    )}
                  />
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Stage {activeStage + 1} of {stagesDraft.length}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={activeStage === stagesDraft.length - 1}
              onClick={() => goToStage(activeStage + 1)}
            >
              <span className="hidden sm:inline">{activeStage < stagesDraft.length - 1 ? stagesDraft[activeStage + 1].name || "Next" : "Next"}</span>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
