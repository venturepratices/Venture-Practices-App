"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronDown, Pencil, UserMinus, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ReviewerRow = {
  id: string;
  name: string;
  isGuest: boolean;
  isMe: boolean;
  decision: "APPROVED" | "APPROVED_WITH_CHANGES" | "CHANGES_REQUESTED" | null;
  note: string | null;
};

type DecisionValue = "APPROVED" | "APPROVED_WITH_CHANGES" | "CHANGES_REQUESTED";

const DECISION_META: Record<DecisionValue, { label: string; className: string }> = {
  APPROVED: { label: "Approved", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  APPROVED_WITH_CHANGES: { label: "Approved w/ changes", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  CHANGES_REQUESTED: { label: "Changes requested", className: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
};

export function ReviewerPanel({
  assetId,
  versionId,
  decisionUrl,
  isLatestVersion,
  reviewers,
  teamMemberOptions,
  canManage,
  canDecide,
}: {
  assetId: string;
  versionId: string;
  /** Builds the decision POST target — internal (`/api/assets/...`) or the token-scoped guest route (`/api/review/[token]/...`). */
  decisionUrl: (versionId: string) => string;
  isLatestVersion: boolean;
  reviewers: ReviewerRow[];
  teamMemberOptions: { id: string; name: string }[];
  canManage: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"member" | "guest">("member");
  const [memberId, setMemberId] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = reviewers.find((r) => r.isMe);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(me?.note ?? "");

  async function addMember() {
    if (!memberId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/reviewers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId: memberId }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to add reviewer");
      setMemberId("");
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addGuest() {
    if (!guestEmail.trim() || !guestName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/reviewers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestEmail: guestEmail.trim(), guestName: guestName.trim() }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to invite guest");
      setGuestEmail("");
      setGuestName("");
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeReviewer(reviewerId: string) {
    setBusy(true);
    await fetch(`/api/asset-reviewers/${reviewerId}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  async function submitDecision(decision: DecisionValue) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(decisionUrl(versionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: noteDraft.trim() || null }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to submit decision");
      setDecisionOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const availableMembers = teamMemberOptions.filter((m) => !reviewers.some((r) => !r.isGuest && r.id === m.id));

  return (
    <div className="border-b">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-sm font-semibold">
          Reviewers
          {reviewers.length > 0 ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">({reviewers.length})</span> : null}
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div className="space-y-2.5 px-3 pb-3">
          {reviewers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No reviewers assigned yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {reviewers.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {r.name}
                      {r.isMe ? <span className="text-muted-foreground"> (you)</span> : null}
                    </span>
                    {r.isGuest ? (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Guest</span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.decision ? (
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", DECISION_META[r.decision].className)}>
                        {DECISION_META[r.decision].label}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Pending</span>
                    )}
                    {canManage ? (
                      <button
                        onClick={() => removeReviewer(r.id)}
                        disabled={busy}
                        title="Remove reviewer"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <UserMinus className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            adding ? (
              <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                <div className="flex gap-1 rounded-md border bg-background p-0.5 text-xs">
                  <button
                    onClick={() => setAddMode("member")}
                    className={cn("flex-1 rounded px-2 py-1 font-medium", addMode === "member" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    Team member
                  </button>
                  <button
                    onClick={() => setAddMode("guest")}
                    className={cn("flex-1 rounded px-2 py-1 font-medium", addMode === "guest" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    Guest
                  </button>
                </div>
                {addMode === "member" ? (
                  <div className="flex gap-1.5">
                    <select
                      value={memberId}
                      onChange={(e) => setMemberId(e.target.value)}
                      className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="">Select a person…</option>
                      {availableMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" onClick={addMember} disabled={busy || !memberId}>
                      Add
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Input placeholder="Name" value={guestName} onChange={(e) => setGuestName(e.target.value)} className="h-8 text-sm" />
                    <div className="flex gap-1.5">
                      <Input
                        type="email"
                        placeholder="Email"
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        className="h-8 flex-1 text-sm"
                      />
                      <Button size="sm" onClick={addGuest} disabled={busy || !guestEmail.trim() || !guestName.trim()}>
                        Invite
                      </Button>
                    </div>
                  </div>
                )}
                <button onClick={() => setAdding(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)}>
                <UserPlus className="mr-1.5 size-3.5" />
                Add reviewer
              </Button>
            )
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {canDecide && me && isLatestVersion ? (
            <div className="rounded-md border bg-muted/30 p-2">
              {!decisionOpen ? (
                <button
                  onClick={() => setDecisionOpen(true)}
                  className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <span>{me.decision ? "Change your decision" : "Make your decision"}</span>
                  <Pencil className="size-3.5" />
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Your decision on this version</p>
                  <div className="flex flex-col gap-1.5">
                    <Button size="sm" variant="outline" className="justify-start" onClick={() => submitDecision("APPROVED")} disabled={busy}>
                      <Check className="mr-1.5 size-3.5 text-emerald-600" />
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" className="justify-start" onClick={() => submitDecision("APPROVED_WITH_CHANGES")} disabled={busy}>
                      <Check className="mr-1.5 size-3.5 text-amber-600" />
                      Approve with changes
                    </Button>
                    <Button size="sm" variant="outline" className="justify-start" onClick={() => submitDecision("CHANGES_REQUESTED")} disabled={busy}>
                      <X className="mr-1.5 size-3.5 text-rose-600" />
                      Request changes
                    </Button>
                  </div>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={2}
                    placeholder="Optional note with your decision…"
                    className="w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button onClick={() => setDecisionOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
