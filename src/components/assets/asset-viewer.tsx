"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, Check, CornerDownRight, Download, ExternalLink, FileText, Images, MessageSquarePlus, RotateCcw, Share2, Upload, X } from "lucide-react";

import type { Annotation, AnnotationType } from "@/lib/asset-annotation";
import { annotationAnchor, DEFAULT_ANNOTATION_COLOR } from "@/lib/asset-annotation";
import { Button } from "@/components/ui/button";
import { AnnotationOverlay, type OverlayAnnotation } from "@/components/assets/annotation-overlay";
import { AnnotationToolbar } from "@/components/assets/annotation-toolbar";
import { AssetStatusPill } from "@/components/assets/asset-status-pill";
import { ReviewerPanel, type ReviewerRow } from "@/components/assets/reviewer-panel";
import { ShareLinkDialog } from "@/components/assets/share-link-dialog";
import { UploadVersionDialog } from "@/components/assets/upload-version-dialog";
import { VersionCompareDialog } from "@/components/assets/version-compare-dialog";
import { cn, formatDateTime } from "@/lib/utils";

export type ViewerComment = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  annotation: Annotation | null;
  timecodeMs: number | null;
  page: number | null;
  resolved: boolean;
  marker: number | null;
  replies: { id: string; body: string; author: string; createdAt: string }[];
};

type Version = {
  id: string;
  versionNumber: number;
  kind: string;
  blobUrl: string | null;
  externalUrl: string | null;
  mimeType: string | null;
};

type Props = {
  clientId: string;
  assetId: string;
  title: string;
  description: string | null;
  status: string;
  createdByName: string | null;
  version: Version;
  allVersions: { versionNumber: number; kind: string }[];
  comments: ViewerComment[];
  canComment: boolean;
  canUpload: boolean;
  canManageReviewers: boolean;
  canDecide: boolean;
  canShare: boolean;
  isLatestVersion: boolean;
  reviewers: ReviewerRow[];
  teamMemberOptions: { id: string; name: string }[];
  imageVersions: { versionNumber: number; blobUrl: string }[];
  // The four props below are plain strings, not functions — this component
  // is rendered from a Server Component (the asset detail page), and React
  // cannot serialize a function across that boundary. Every URL is built
  // locally from these bases instead.
  /** e.g. `/api/assets/${assetId}` (internal) or `/api/review/${token}` (guest share link). */
  apiBase: string;
  /** e.g. `/api/asset-comments` (internal) or `/api/review/${token}/comments` (guest). */
  resolveCommentBase: string;
  /** e.g. `/clients/${clientId}/assets/${assetId}` (internal) or `/review/${token}` (guest). */
  versionSwitchBase: string;
  /** "Back to assets" link — null hides it entirely (guest mode has nowhere internal to go back to). */
  backHref: string | null;
};

type Filter = "open" | "resolved" | "all";
type Popup = { x: number; y: number; content: React.ReactNode };

function formatTimecode(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function toolLabel(type: AnnotationType): string {
  switch (type) {
    case "pin":
      return "Pin";
    case "rectangle":
      return "Box";
    case "ellipse":
      return "Circle";
    case "arrow":
      return "Arrow";
    case "pencil":
      return "Drawing";
    case "highlighter":
      return "Highlight";
  }
}

export function AssetViewer(props: Props) {
  const {
    clientId,
    assetId,
    version,
    comments,
    canComment,
    canUpload,
    canManageReviewers,
    canDecide,
    canShare,
    isLatestVersion,
    reviewers,
    teamMemberOptions,
    imageVersions,
    apiBase,
    resolveCommentBase,
    versionSwitchBase,
    backHref,
  } = props;
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);

  // Built locally (not passed as props) since functions can't cross the
  // Server Component → Client Component boundary — see the Props comment above.
  const commentsUrl = `${apiBase}/versions/${version.id}/comments`;
  const decisionUrl = (versionId: string) => `${apiBase}/versions/${versionId}/decisions`;
  const resolveCommentUrl = (commentId: string) => `${resolveCommentBase}/${commentId}`;
  const versionSwitchHref = (versionNumber: number) => `${versionSwitchBase}?v=${versionNumber}`;

  const [filter, setFilter] = useState<Filter>("open");
  const [draft, setDraft] = useState("");
  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null);
  const [color, setColor] = useState<string>(DEFAULT_ANNOTATION_COLOR);
  const [pendingAnnotation, setPendingAnnotation] = useState<Annotation | null>(null);
  const [pendingTimecode, setPendingTimecode] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  // Two highlight sources: hover is transient (mouse over a card), selected
  // persists until a different card is clicked or the same one is clicked
  // again — this is the "click a comment to light up what it points to" ask.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = hoveredId ?? selectedId;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const visibleComments = comments.filter((c) =>
    filter === "all" ? true : filter === "open" ? !c.resolved : c.resolved
  );

  function handleSelectTool(tool: AnnotationType | null) {
    setActiveTool(tool);
    if (tool && version.kind === "VIDEO") {
      videoRef.current?.pause();
      setPendingTimecode(Math.round((videoRef.current?.currentTime ?? 0) * 1000));
    }
  }

  // A brand-new mark was just started (mousedown) — drop whatever was
  // pending before so only one unposted mark is ever "live" at a time.
  function handleStartDrawing() {
    setPendingAnnotation(null);
    setDraft("");
    setError(null);
  }

  function handleFinishDrawing(annotation: Annotation) {
    setPendingAnnotation(annotation);
  }

  function cancelPending() {
    setPendingAnnotation(null);
    setDraft("");
    setError(null);
  }

  // Esc discards the pending mark without posting, same as the popup's Cancel.
  useEffect(() => {
    if (!pendingAnnotation) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelPending();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAnnotation]);

  async function postComment(payload: { body: string; annotation?: Annotation; timecodeMs?: number; parentId?: string }) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(commentsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? `Failed (${res.status})`);
      }
      setDraft("");
      setReplyDraft("");
      setReplyingTo(null);
      setPendingAnnotation(null);
      setPendingTimecode(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleArchived() {
    setArchiving(true);
    await fetch(`/api/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: props.status === "ARCHIVED" ? "reopen" : "archive" }),
    });
    setArchiving(false);
    router.refresh();
  }

  async function toggleResolved(commentId: string, resolved: boolean) {
    await fetch(resolveCommentUrl(commentId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    router.refresh();
  }

  // Sidebar composer — only used when there's no spatial mark to attach to
  // (a plain remark, or a video "comment at current time" with no shape).
  function handleSubmitMain(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    postComment({ body: draft, timecodeMs: pendingTimecode ?? undefined });
  }

  function seekTo(ms: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      videoRef.current.play().catch(() => {});
    }
  }

  function clickComment(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  const drawable = version.kind === "IMAGE" || version.kind === "WEBSITE" || version.kind === "VIDEO";

  // The floating "type your comment here" box, anchored to wherever the
  // pending mark ended up — this is the popup asked for instead of the
  // sidebar composer for anchored comments.
  const popup: Popup | null = pendingAnnotation
    ? {
        ...annotationAnchor(pendingAnnotation),
        content: (
          <AnnotationPopup
            color={pendingAnnotation.color}
            label={toolLabel(pendingAnnotation.type)}
            draft={draft}
            setDraft={setDraft}
            onPost={() => postComment({ body: draft, annotation: pendingAnnotation, timecodeMs: pendingTimecode ?? undefined })}
            onCancel={cancelPending}
            submitting={submitting}
            error={error}
          />
        ),
      }
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b px-6 py-3">
        <div className="min-w-0">
          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to assets
            </Link>
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{props.title}</h1>
            <AssetStatusPill status={props.status} />
          </div>
          {props.description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{props.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {props.allVersions.length > 1 ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Version</span>
              {props.allVersions.map((ver) => (
                <Link
                  key={ver.versionNumber}
                  href={versionSwitchHref(ver.versionNumber)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium",
                    ver.versionNumber === version.versionNumber
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  v{ver.versionNumber}
                </Link>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Version {version.versionNumber}</span>
          )}
          <div className="flex items-center gap-1.5">
            {imageVersions.length > 1 ? (
              <VersionCompareDialog
                versions={imageVersions}
                trigger={
                  <Button variant="outline" size="sm">
                    <Images className="mr-1.5 size-3.5" />
                    Compare
                  </Button>
                }
              />
            ) : null}
            {canUpload ? (
              <UploadVersionDialog
                clientId={clientId}
                assetId={assetId}
                trigger={
                  <Button variant="outline" size="sm">
                    <Upload className="mr-1.5 size-3.5" />
                    New version
                  </Button>
                }
              />
            ) : null}
            {canManageReviewers ? (
              <Button variant="outline" size="sm" onClick={toggleArchived} disabled={archiving}>
                {props.status === "ARCHIVED" ? (
                  <>
                    <RotateCcw className="mr-1.5 size-3.5" />
                    Reopen
                  </>
                ) : (
                  <>
                    <Archive className="mr-1.5 size-3.5" />
                    Archive
                  </>
                )}
              </Button>
            ) : null}
            {canShare ? (
              <ShareLinkDialog
                assetId={assetId}
                trigger={
                  <Button variant="outline" size="sm">
                    <Share2 className="mr-1.5 size-3.5" />
                    Share for review
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Split body */}
      <div className="flex min-h-0 flex-1">
        {/* Viewer */}
        <div className="min-w-0 flex-1 overflow-auto bg-muted/30 p-6">
          {canComment && drawable ? (
            <div className="mx-auto mb-3 flex max-w-4xl justify-center">
              <AnnotationToolbar activeTool={activeTool} onSelectTool={handleSelectTool} color={color} onSelectColor={setColor} />
            </div>
          ) : null}
          <MediaArea
            version={version}
            comments={comments}
            canComment={canComment}
            activeTool={activeTool}
            color={color}
            pendingAnnotation={pendingAnnotation}
            popup={popup}
            onStartDrawing={handleStartDrawing}
            onFinishDrawing={handleFinishDrawing}
            activeId={activeId}
            setHoveredId={setHoveredId}
            videoRef={videoRef}
            onSeek={seekTo}
          />
        </div>

        {/* Comments sidebar */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l">
          <ReviewerPanel
            assetId={assetId}
            versionId={version.id}
            decisionUrl={decisionUrl}
            isLatestVersion={isLatestVersion}
            reviewers={reviewers}
            teamMemberOptions={teamMemberOptions}
            canManage={canManageReviewers}
            canDecide={canDecide}
          />
          <div className="flex items-center gap-1 border-b p-2">
            {(["open", "resolved", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                  filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {f}
                {f === "open" ? ` (${comments.filter((c) => !c.resolved).length})` : ""}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
            {visibleComments.length === 0 ? (
              <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                {filter === "resolved" ? "No resolved comments." : "No comments yet."}
                {canComment && filter !== "resolved" ? (
                  <>
                    <br />
                    {drawable ? "Pick a tool above, then mark up the area that needs work." : "Add a comment below."}
                  </>
                ) : null}
              </p>
            ) : (
              visibleComments.map((c) => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  active={activeId === c.id}
                  canComment={canComment}
                  onSeek={c.timecodeMs != null ? () => seekTo(c.timecodeMs!) : undefined}
                  onHoverStart={() => setHoveredId(c.id)}
                  onHoverEnd={() => setHoveredId(null)}
                  onClickCard={() => clickComment(c.id)}
                  onToggleResolved={() => toggleResolved(c.id, !c.resolved)}
                  replyingTo={replyingTo}
                  setReplyingTo={setReplyingTo}
                  replyDraft={replyDraft}
                  setReplyDraft={setReplyDraft}
                  onSubmitReply={() => postComment({ body: replyDraft, parentId: c.id })}
                  submitting={submitting}
                />
              ))
            )}
          </div>

          {/* Composer — hidden while a mark is pending; that flow moves to the popup on the canvas. */}
          {canComment ? (
            pendingAnnotation ? (
              <div className="border-t p-3 text-center text-xs text-muted-foreground">
                Type your comment in the box next to your mark — or press Esc to cancel it.
              </div>
            ) : (
              <form onSubmit={handleSubmitMain} className="border-t p-3">
                {pendingTimecode != null ? (
                  <div className="mb-2 flex items-center justify-between rounded-md bg-primary/10 px-2 py-1 text-xs">
                    <span className="text-primary">At {formatTimecode(pendingTimecode)}</span>
                    <button type="button" onClick={() => setPendingTimecode(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : null}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Leave feedback…"
                  className="w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
                <div className="mt-2 flex items-center justify-between">
                  {version.kind === "VIDEO" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingTimecode(Math.round((videoRef.current?.currentTime ?? 0) * 1000))}
                    >
                      <MessageSquarePlus className="mr-1 size-3.5" />
                      Comment at current time
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button type="submit" size="sm" disabled={submitting || !draft.trim()}>
                    {submitting ? "Posting…" : "Comment"}
                  </Button>
                </div>
              </form>
            )
          ) : (
            <p className="border-t p-3 text-center text-xs text-muted-foreground">You have view-only access.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Mini popup */

function AnnotationPopup({
  color,
  label,
  draft,
  setDraft,
  onPost,
  onCancel,
  submitting,
  error,
}: {
  color: string;
  label: string;
  draft: string;
  setDraft: (v: string) => void;
  onPost: () => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <div className="w-64 rounded-lg border bg-popover p-2.5 shadow-lg">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
          {label} marked
        </span>
        <button type="button" onClick={onCancel} title="Cancel (Esc)" className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onPost();
        }}
        rows={3}
        placeholder="Type your comment…"
        className="w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      <div className="mt-1.5 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onPost} disabled={submitting || !draft.trim()}>
          {submitting ? "Posting…" : "Post"}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Media area */

function MediaArea({
  version,
  comments,
  canComment,
  activeTool,
  color,
  pendingAnnotation,
  popup,
  onStartDrawing,
  onFinishDrawing,
  activeId,
  setHoveredId,
  videoRef,
  onSeek,
}: {
  version: Version;
  comments: ViewerComment[];
  canComment: boolean;
  activeTool: AnnotationType | null;
  color: string;
  pendingAnnotation: Annotation | null;
  popup: Popup | null;
  onStartDrawing: () => void;
  onFinishDrawing: (a: Annotation) => void;
  activeId: string | null;
  setHoveredId: (id: string | null) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSeek: (ms: number) => void;
}) {
  const timecodeComments = comments.filter((c) => c.timecodeMs != null);

  const overlayAnnotations: OverlayAnnotation[] = comments
    .filter((c) => c.annotation && !c.resolved)
    .map((c) => ({
      id: c.id,
      annotation: c.annotation!,
      marker: c.marker,
      active: activeId === c.id,
    }));
  if (pendingAnnotation) {
    overlayAnnotations.push({ id: "__pending__", annotation: pendingAnnotation, marker: null, active: false, pending: true });
  }

  // IMAGE
  if (version.kind === "IMAGE" && version.blobUrl) {
    return (
      <div className="mx-auto max-w-4xl">
        <AnnotationOverlay
          annotations={overlayAnnotations}
          activeTool={canComment ? activeTool : null}
          color={color}
          onStartDrawing={onStartDrawing}
          onFinishDrawing={onFinishDrawing}
          popup={popup}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={version.blobUrl} alt="" className="block w-full rounded-lg border bg-white shadow-sm" />
        </AnnotationOverlay>
        {!activeTool && canComment ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">Pick a tool above, then draw directly on the image.</p>
        ) : null}
      </div>
    );
  }

  // VIDEO — native player + drawable overlay on the (paused, while drawing) frame.
  if (version.kind === "VIDEO" && version.blobUrl) {
    return (
      <div className="mx-auto max-w-4xl">
        <AnnotationOverlay
          annotations={overlayAnnotations}
          activeTool={canComment ? activeTool : null}
          color={color}
          onStartDrawing={onStartDrawing}
          onFinishDrawing={onFinishDrawing}
          popup={popup}
        >
          <video ref={videoRef} src={version.blobUrl} controls className="block w-full rounded-lg border bg-black shadow-sm" />
        </AnnotationOverlay>
        {activeTool ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Drawing on the paused frame — turn off the tool to use video controls again.
          </p>
        ) : null}
        {timecodeComments.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Timecoded comments</p>
            <div className="flex flex-wrap gap-1.5">
              {timecodeComments.map((c) => (
                <button
                  key={c.id}
                  onMouseEnter={() => setHoveredId(c.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => onSeek(c.timecodeMs!)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium",
                    activeId === c.id ? "border-primary bg-primary/10" : "hover:bg-accent"
                  )}
                >
                  {formatTimecode(c.timecodeMs!)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // WEBSITE — iframe with a drawable overlay.
  if (version.kind === "WEBSITE" && version.externalUrl) {
    return (
      <div className="mx-auto flex h-full max-w-5xl flex-col">
        <div className="mb-2 flex items-center justify-between">
          <a
            href={version.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            Open in new tab
          </a>
        </div>
        <AnnotationOverlay
          annotations={overlayAnnotations}
          activeTool={canComment ? activeTool : null}
          color={color}
          onStartDrawing={onStartDrawing}
          onFinishDrawing={onFinishDrawing}
          popup={popup}
          className="min-h-[600px] flex-1 overflow-hidden rounded-lg border bg-white shadow-sm"
        >
          <iframe src={version.externalUrl} className="size-full" title="Website preview" />
        </AnnotationOverlay>
        {activeTool ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Drawing mode is on — turn it off to interact with the page again.
          </p>
        ) : null}
      </div>
    );
  }

  // PDF — native browser rendering in an iframe (general comments only; no drawn markup yet).
  if (version.kind === "PDF" && version.blobUrl) {
    return (
      <div className="mx-auto flex h-full max-w-5xl flex-col">
        <iframe src={version.blobUrl} className="min-h-[600px] w-full flex-1 rounded-lg border bg-white shadow-sm" title="PDF preview" />
      </div>
    );
  }

  // OTHER (or missing) — download card.
  const downloadUrl = version.blobUrl ?? version.externalUrl;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border bg-card p-10 text-center">
      <FileText className="size-12 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        This file type can&apos;t be previewed in the browser. Download it to review, then leave comments here.
      </p>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <Download className="size-4" />
          Download file
        </a>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- Comment card */

function CommentCard({
  comment,
  active,
  canComment,
  onSeek,
  onHoverStart,
  onHoverEnd,
  onClickCard,
  onToggleResolved,
  replyingTo,
  setReplyingTo,
  replyDraft,
  setReplyDraft,
  onSubmitReply,
  submitting,
}: {
  comment: ViewerComment;
  active: boolean;
  canComment: boolean;
  onSeek?: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onClickCard: () => void;
  onToggleResolved: () => void;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  replyDraft: string;
  setReplyDraft: (v: string) => void;
  onSubmitReply: () => void;
  submitting: boolean;
}) {
  const hasContext = comment.timecodeMs != null || comment.page != null;

  return (
    <div
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onClick={(e) => {
        // Don't treat clicks on the action buttons/reply form as "select this card".
        if ((e.target as HTMLElement).closest("button, textarea")) return;
        if (comment.annotation) onClickCard();
      }}
      className={cn(
        "rounded-xl border p-3.5 transition-colors",
        comment.annotation && "cursor-pointer",
        active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-card",
        comment.resolved && "opacity-60"
      )}
    >
      {/* Header: marker + author, timestamp flush right */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {comment.marker != null ? (
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: comment.annotation?.color ?? "var(--primary)" }}
            >
              {comment.marker}
            </span>
          ) : null}
          <span className="truncate text-sm font-semibold">{comment.author}</span>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
      </div>

      {/* Context chips: timecode / page, on their own row so they don't crowd the name */}
      {hasContext ? (
        <div className="mt-1 flex items-center gap-1.5">
          {comment.timecodeMs != null ? (
            <button
              onClick={onSeek}
              className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums hover:bg-accent"
            >
              {formatTimecode(comment.timecodeMs)}
            </button>
          ) : null}
          {comment.page != null ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">Page {comment.page}</span> : null}
        </div>
      ) : null}

      {/* Body */}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{comment.body}</p>

      {/* Replies */}
      {comment.replies.length > 0 ? (
        <div className="mt-3 space-y-2.5 border-l-2 pl-3">
          {comment.replies.map((r) => (
            <div key={r.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{r.author}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{formatDateTime(r.createdAt)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{r.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Actions */}
      {canComment ? (
        <div className="mt-2.5 flex items-center gap-1 border-t pt-2">
          <button
            onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <CornerDownRight className="size-3.5" />
            Reply
          </button>
          <button
            onClick={onToggleResolved}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
              comment.resolved ? "text-muted-foreground hover:bg-accent hover:text-foreground" : "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            )}
          >
            <Check className="size-3.5" />
            {comment.resolved ? "Reopen" : "Resolve"}
          </button>
        </div>
      ) : null}

      {replyingTo === comment.id ? (
        <div className="mt-2">
          <textarea
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            rows={2}
            placeholder="Reply…"
            className="w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setReplyingTo(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onSubmitReply} disabled={submitting || !replyDraft.trim()}>
              Reply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
