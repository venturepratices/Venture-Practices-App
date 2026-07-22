"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Archive, Check, FolderPlus, Images, Pencil, Trash2, X } from "lucide-react";

import { ANNOTATION_COLORS } from "@/lib/asset-annotation";
import { cn } from "@/lib/utils";

type FolderItem = { id: string; name: string; color: string | null; count: number };

/**
 * Left sidebar for the Assets tab — "All assets" and "Archived" are fixed
 * system entries (with live counts) above a divider, then the client's own
 * folders below. Selection is URL-driven (?folderId=.../?view=archived), the
 * same pattern already proven on the Conversations tab's contact list — so
 * other filters (search/status/kind/reviewer/due-date) survive a folder
 * switch untouched, and every view stays linkable/refresh-safe.
 */
export function AssetFolderSidebar({
  clientId,
  folders,
  allCount,
  archivedCount,
  canManage,
}: {
  clientId: string;
  folders: FolderItem[];
  allCount: number;
  archivedCount: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentFolderId = searchParams.get("folderId");
  const currentView = searchParams.get("view");
  const isAllActive = !currentFolderId && currentView !== "archived";
  const isArchivedActive = currentView === "archived";

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function hrefFor(next: { folderId?: string | null; view?: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("folderId");
    params.delete("view");
    if (next.folderId) params.set("folderId", next.folderId);
    if (next.view) params.set("view", next.view);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  async function createFolder() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/asset-folders`, {
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
      const res = await fetch(`/api/asset-folders/${renamingId}`, {
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
    if (!window.confirm(`Delete the "${folder.name}" folder? Its assets will move to "All assets" — nothing is deleted.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/asset-folders/${folder.id}`, { method: "DELETE" });
      if (currentFolderId === folder.id) router.push(hrefFor({}));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
      <Link
        href={hrefFor({})}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent",
          isAllActive && "bg-accent"
        )}
      >
        <Images className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">All assets</span>
        <span className="text-xs text-muted-foreground">{allCount}</span>
      </Link>
      <Link
        href={hrefFor({ view: "archived" })}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent",
          isArchivedActive && "bg-accent"
        )}
      >
        <Archive className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Archived</span>
        <span className="text-xs text-muted-foreground">{archivedCount}</span>
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
                  href={hrefFor({ folderId: folder.id })}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent",
                    active && "bg-accent"
                  )}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: folder.color ?? "var(--muted-foreground)" }}
                  />
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
                    <button
                      onClick={() => deleteFolder(folder)}
                      disabled={busy}
                      title="Delete folder"
                      className="text-muted-foreground hover:text-destructive"
                    >
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
                  className={cn(
                    "size-4 rounded-full ring-offset-1",
                    newColor === c.value && "ring-2 ring-ring"
                  )}
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
  );
}
