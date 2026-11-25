"use client";

import type { DiffSegment, EmailDiff } from "@/lib/marketing/email-editor-types";

/** One side of a diff: "before" shows same+del, "after" shows same+add. */
function Side({
  label,
  segments,
  show,
}: {
  label: string;
  segments: DiffSegment[];
  show: "del" | "add";
}) {
  const mark =
    show === "del"
      ? "bg-status-warning text-status-warning-foreground line-through"
      : "bg-status-success text-status-success-foreground";
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <div
        data-side={show === "del" ? "before" : "after"}
        className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap"
      >
        {segments
          .filter((s) => s.type === "same" || s.type === show)
          .map((s, i) =>
            s.type === "same" ? (
              <span key={i}>{s.text}</span>
            ) : (
              <mark
                key={i}
                data-diff={s.type}
                className={`rounded-sm px-0.5 ${mark}`}
              >
                {s.text}
              </mark>
            ),
          )}
      </div>
    </div>
  );
}

function FieldCard({
  title,
  segments,
}: {
  title: string;
  segments: DiffSegment[];
}) {
  return (
    <section aria-label={`${title} changes`} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Side label="Before" segments={segments} show="del" />
        <Side label="After" segments={segments} show="add" />
      </div>
    </section>
  );
}

export function EmailDiffView({ diff }: { diff: EmailDiff }) {
  return (
    <div className="flex flex-col gap-4">
      <FieldCard title="Subject" segments={diff.subject} />
      <FieldCard title="Body" segments={diff.body} />
      {!diff.changed && (
        <p className="text-xs text-muted-foreground">No changes yet.</p>
      )}
    </div>
  );
}
