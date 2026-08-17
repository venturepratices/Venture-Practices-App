"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Check, LayoutGrid, Pencil, Plus, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TemplateFolderItem = {
  id: string;
  name: string;
  color: string | null;
  templateCount: number;
};

// Same preset palette the client-tab project folders use — a small fixed set
// beats a full color picker for a handful of folders.
const FOLDER_COLORS = ["#2d94c0", "#f16857", "#8b5cf6", "#10b981", "#f59e0b", "#64748b"];

/**
 * Folder rail for the Project Templates library. URL-driven selection
 * (?folderId=...) — same pattern as the per-client project/asset folder
 * sidebars, so selection is refresh-safe and linkable. Create/rename/delete
 * are inline; templates in a deleted folder fall back to "All templates"
 * (SetNull), never deleted with it.
 */
export function TemplateFolderSidebar({ folders, totalCount }: { folders: TemplateFolderItem[]; totalCount: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeFolderId = searchParams.get("folderId");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(FOLDER_COLORS[0]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function createFolder() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/workflow-template-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    });
    setBusy(false);
    if (res.ok) {
      setNewName("");
      setCreating(false);
      router.refresh();
    }
  }

  async function renameFolder(folderId: string) {
    if (!renameValue.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/workflow-template-folders/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setRenamingId(null);
      router.refresh();
    }
  }

  async function deleteFolder(folderId: string, name: string) {
    if (!window.confirm(`Delete folder "${name}"? Templates inside move back to All templates.`)) return;
    setBusy(true);
    const res = await fetch(`/api/workflow-template-folders/${folderId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      if (activeFolderId === folderId) router.push("/settings/workflow-templates");
      router.refresh();
    }
  }

  return (
    <aside className="w-full shrink-0 md:w-[220px] md:border-r md:pr-3">
      <nav className="flex flex-col gap-0.5">
        <Link
          href="/settings/workflow-templates"
          className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
            !activeFolderId ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"
          )}
        >
          <LayoutGrid className="size-4" />
          All templates
          <span className="ml-auto text-xs font-normal text-muted-foreground">{totalCount}</span>
        </Link>

        <div className="my-2 h-px bg-border" />

        <div className="flex items-center justify-between px-2.5 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Folders</span>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="New folder"
            title="New folder"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {creating ? (
          <div className="mb-1 space-y-1.5 rounded-lg border border-dashed p-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Folder name"
              className="h-7 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") createFolder();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <div className="flex items-center gap-1">
              {FOLDER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewColor(color)}
                  className={cn("size-4 rounded-full border-2", newColor === color ? "border-foreground" : "border-transparent")}
                  style={{ backgroundColor: color }}
                  aria-label={`Color ${color}`}
                />
              ))}
              <Button variant="outline" size="icon-sm" className="ml-auto" onClick={createFolder} disabled={!newName.trim() || busy} aria-label="Create folder">
                <Check className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {folders.length === 0 && !creating ? (
          <p className="px-2.5 py-1 text-xs text-muted-foreground">No folders yet.</p>
        ) : (
          folders.map((folder) => {
            const active = activeFolderId === folder.id;
            if (renamingId === folder.id) {
              return (
                <div key={folder.id} className="flex items-center gap-1 px-1 py-0.5">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-7 flex-1 text-xs"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") renameFolder(folder.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <Button variant="ghost" size="icon-sm" onClick={() => renameFolder(folder.id)} disabled={busy} aria-label="Save name">
                    <Check className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setRenamingId(null)} aria-label="Cancel rename">
                    <X className="size-3.5" />
                  </Button>
                </div>
              );
            }
            return (
              <div
                key={folder.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"
                )}
              >
                <Link href={`/settings/workflow-templates?folderId=${folder.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: folder.color ?? "#64748b" }} />
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{folder.templateCount}</span>
                </Link>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(folder.id);
                      setRenameValue(folder.name);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Rename ${folder.name}`}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteFolder(folder.id, folder.name)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${folder.name}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}
