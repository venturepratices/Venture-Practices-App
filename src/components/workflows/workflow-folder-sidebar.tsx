"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Folder, FolderPlus, GitBranch, Pencil, Trash2, X } from "lucide-react";

import { ANNOTATION_COLORS } from "@/lib/asset-annotation";
import { cn } from "@/lib/utils";
import { useWorkflowSidebar } from "@/components/workflows/workflow-sidebar-context";

type FolderItem = { id: string; name: string; color: string | null; count: number };

/**
 * Left sidebar for a client's Workflows tab — "All workflows" is a fixed
 * system entry (with a live count) above a divider, then the client's own
 * folders below. Selection is URL-driven (?folderId=...), same pattern as
 * AssetFolderSidebar. No "Archived" entry — workflows use Cancel/Delete, not
 * an archive view.
 */
export function WorkflowFolderSidebar({
  clientId,
  folders,
  allCount,
  canManage,
}: {
  clientId: string;
  folders: FolderItem[];
  allCount: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isOpen, close } = useWorkflowSidebar();

  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const currentFolderId = searchParams.get("folderId");
  const isAllActive = !currentFolderId;

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function hrefFor(folderId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("folderId");
    if (folderId) params.set("folderId", folderId);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  async function createFolder() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/workflow-folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to create folder");
      setNewName("");
      setNewColor(null);
      setCreating(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRename() {
    if (!renamingId || !renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflow-folders/${renamingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to rename folder");
      setRenamingId(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(folder: FolderItem) {
    if (!window.confirm(`Delete the "${folder.name}" folder? Its projects will move to "All projects" — nothing is deleted.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/workflow-folders/${folder.id}`, { method: "DELETE" });
      if (currentFolderId === folder.id) router.push(hrefFor(null));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {isOpen ? (
        <button type="button" aria-label="Close folders" onClick={close} className="fixed inset-0 z-40 bg-black/50 md:hidden" />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[240px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-background p-2 transition-transform duration-200 md:static md:z-auto md:w-[200px] md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full pointer-events-none md:pointer-events-auto"
        )}
      >
        <div className="mb-1 flex items-center justify-between md:hidden">
          <p className="px-1 text-sm font-semibold">Folders</p>
          <button type="button" aria-label="Close folders" onClick={close} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <Link
          href={hrefFor(null)}
          className={cn(
            "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent",
            isAllActive && "bg-accent"
          )}
        >
          <GitBranch className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">All projects</span>
          <span className="text-xs text-muted-foreground">{allCount}</span>
        </Link>

        <div className="my-2 h-px bg-border" />

        <p className="px-2.5 py-1 text-xs font-medium text-muted-foreground">Folders</p>
        {folders.map((folder) => {
          const active = currentFolderId === folder.id;
          const isRenaming = renamingId === folder.id;
          return (
            <div key={folder.id} className="group/folder flex items-center gap-1">
              {isRenaming ? (
                <div className="flex flex-1 items-center gap-1 px-1">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border bg-background px-1.5 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button onClick={submitRename} disabled={busy} className="text-muted-foreground hover:text-foreground">
                    <Check className="size-3.5" />
                  </button>
                  <button onClick={() => setRenamingId(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <Link
                    href={hrefFor(folder.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent",
                      active && "bg-accent"
                    )}
                  >
                    <Folder className="size-3.5 shrink-0" style={{ color: folder.color ?? "var(--muted-foreground)" }} />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="text-xs text-muted-foreground">{folder.count}</span>
                  </Link>
                  {canManage ? (
                    <div className="hidden shrink-0 items-center gap-0.5 group-hover/folder:flex">
                      <button
                        onClick={() => {
                          setRenamingId(folder.id);
                          setRenameValue(folder.name);
                        }}
                        title="Rename folder"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => deleteFolder(folder)} disabled={busy} title="Delete folder" className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}

        {canManage ? (
          creating ? (
            <div className="mt-1 space-y-1.5 rounded-md border bg-muted/30 p-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createFolder();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Folder name"
                className="w-full rounded-md border bg-background px-1.5 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex items-center gap-1">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewColor((prev) => (prev === c.value ? null : c.value))}
                    title={c.name}
                    className={cn("size-4 rounded-full ring-offset-1", newColor === c.value && "ring-2 ring-ring")}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setCreating(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
                <button
                  onClick={createFolder}
                  disabled={busy || !newName.trim()}
                  className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mt-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <FolderPlus className="size-4" />
              New folder
            </button>
          )
        ) : null}
      </aside>
    </>
  );
}
