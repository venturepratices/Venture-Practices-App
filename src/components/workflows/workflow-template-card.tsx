"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Folder, GitBranch, MoreVertical, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StatusOptionLite } from "@/lib/task-status-utils";
import { WorkflowTemplateDialog, type WorkflowTemplateWithStages } from "@/components/workflows/workflow-template-dialog";

type TeamMemberOption = { id: string; name: string };
type FolderOption = { id: string; name: string; color: string | null };

/**
 * One template in the library grid. Clicking the card opens the popup
 * editor (WorkflowTemplateDialog); the ⋮ menu moves it between folders or
 * deletes it without opening the editor first.
 */
export function WorkflowTemplateCard({
  template,
  teamMembers,
  statusOptions,
  folders,
}: {
  template: WorkflowTemplateWithStages;
  teamMembers: TeamMemberOption[];
  statusOptions: StatusOptionLite[];
  folders: FolderOption[];
}) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const stageCount = template.stageTemplates.length;
  const taskCount = template.stageTemplates.reduce((sum, s) => sum + s.taskTemplates.length, 0);

  async function moveToFolder(folderId: string | null) {
    setBusy(true);
    const res = await fetch(`/api/workflow-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function handleDelete() {
    if (!window.confirm(`Delete template "${template.name}"? This does not affect any in-flight projects.`)) return;
    setBusy(true);
    const res = await fetch(`/api/workflow-templates/${template.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditorOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditorOpen(true);
          }
        }}
        className="group cursor-pointer rounded-xl border bg-card p-4 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <GitBranch className="size-4" />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Options for ${template.name}`}
                  onClick={(e) => e.stopPropagation()}
                  disabled={busy}
                />
              }
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
              <DropdownMenuItem disabled={template.folderId === null} onClick={() => moveToFolder(null)}>
                <Folder className="size-3.5" />
                All templates
              </DropdownMenuItem>
              {folders.map((folder) => (
                <DropdownMenuItem key={folder.id} disabled={template.folderId === folder.id} onClick={() => moveToFolder(folder.id)}>
                  <span className="size-2.5 rounded-sm" style={{ backgroundColor: folder.color ?? "#64748b" }} />
                  {folder.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                <Trash2 className="size-3.5" />
                Delete template
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="mt-2.5 truncate text-sm font-semibold">{template.name}</p>
        {template.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
        ) : null}
        <div className="mt-2.5 flex items-center gap-3 text-[11.5px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground">{stageCount}</b> stage{stageCount === 1 ? "" : "s"}
          </span>
          <span>
            <b className="font-semibold text-foreground">{taskCount}</b> task{taskCount === 1 ? "" : "s"}
          </span>
          {template.isActive ? (
            <Badge variant="outline" className="ml-auto border-primary/40 bg-primary/10 text-[10px] text-primary">
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
              Inactive
            </Badge>
          )}
        </div>
      </div>

      <WorkflowTemplateDialog
        template={template}
        teamMembers={teamMembers}
        statusOptions={statusOptions}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />
    </>
  );
}
