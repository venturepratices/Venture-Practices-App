"use client";

import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { nitroFlowUrl } from "@/lib/marketing/sequences";
import type {
  Brand,
  Sequence,
  SequenceKey,
  Sequences,
  SequenceStatus,
} from "@/lib/marketing/sequences";
import { EmailModal } from "./email-modal";

const BRAND_LABEL: Record<Brand, string> = {
  "venture-practices": "Venture Practices",
  "practice-mailers": "Practice Mailers",
};

const STATUS_LABEL: Record<SequenceStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  "not built": "Not built",
};

function statusVariant(
  status: SequenceStatus,
): "outline" | "secondary" | "default" {
  if (status === "active") return "default";
  if (status === "not built") return "secondary";
  return "outline";
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function Connector() {
  return <div aria-hidden className="mx-auto h-3 w-px bg-border" />;
}

function EditSequenceButton({ sequence }: { sequence: Sequence }) {
  const nitroUrl = nitroFlowUrl(sequence);
  if (!nitroUrl) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          }
        >
          <Button
            variant="outline"
            size="sm"
            disabled
            tabIndex={-1}
            className="pointer-coarse:min-h-10"
          >
            Edit in NitroSend
            <ExternalLink />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          This sequence is not built in NitroSend yet.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="pointer-coarse:min-h-10"
      render={
        <a
          href={nitroUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-edit-target="sequence"
          data-sequence={sequence.key}
          data-nitro-url={nitroUrl}
        />
      }
    >
      Edit in NitroSend
      <ExternalLink />
    </Button>
  );
}

export function SequenceMapView({
  sequences,
  defaultKey,
}: {
  sequences: Sequences;
  /**
   * Which tab to open first. Passed in from the server page so this client
   * file never names a specific SequenceKey as a string literal (that would
   * leak into the client chunk — see check-sales-secrecy).
   */
  defaultKey: SequenceKey;
}) {
  const keys = (Object.keys(sequences) as SequenceKey[]).sort((a, b) =>
    sequences[a].tabNumber.localeCompare(sequences[b].tabNumber),
  );
  const [selected, setSelected] = useState<SequenceKey>(
    sequences[defaultKey] ? defaultKey : keys[0],
  );
  const [openEmail, setOpenEmail] = useState<{
    key: SequenceKey;
    index: number;
  } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const sequence = sequences[selected];

  const waitingTotal = sequence.steps.reduce(
    (sum, s) => (s.kind === "wait" ? sum + (s.waitingCount ?? 0) : sum),
    0,
  );
  const emailCount = sequence.steps.filter((s) => s.kind === "email").length;

  const openStep =
    openEmail && sequences[openEmail.key].steps[openEmail.index];
  const modalStep = openStep && openStep.kind === "email" ? openStep : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Follow-up system
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every email a new lead gets, grouped by where they came in. Taps
            let you see the full copy.
          </p>
        </div>
        <Badge variant="outline" className="w-fit sm:mt-1.5">
          Snapshot from NitroSend
        </Badge>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Follow-up sequences"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0"
      >
        {keys.map((key) => {
          const s = sequences[key];
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(key)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {s.tabNumber}
              </span>
              <span>{s.displayName}</span>
              {s.status === "not built" && (
                <Badge variant="secondary" className="text-muted-foreground">
                  Not built yet
                </Badge>
              )}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-secondary-accent"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Sequence header */}
      <div
        role="tabpanel"
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-semibold">
            {sequence.displayName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {sequence.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                sequence.brand === "venture-practices"
                  ? "bg-primary"
                  : "bg-secondary-accent",
              )}
            />
            {BRAND_LABEL[sequence.brand]}
          </Badge>
          <Badge variant={statusVariant(sequence.status)}>
            {STATUS_LABEL[sequence.status]}
          </Badge>
          <Badge variant="secondary">
            {sequence.flowId === "not built"
              ? "Not built"
              : `Flow ${sequence.flowId}`}
          </Badge>
          <EditSequenceButton sequence={sequence} />
        </div>
      </div>

      {/* Assumption banner */}
      {sequence.assumption && (
        <div
          role="note"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        >
          {sequence.assumption}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "In sequence", value: String(waitingTotal) },
          { label: "Emails in sequence", value: String(emailCount) },
          { label: "Duration", value: sequence.duration },
          { label: "Brand", value: BRAND_LABEL[sequence.brand] },
        ].map((stat) => (
          <Card key={stat.label} size="sm" className="gap-1 px-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-xl font-semibold">{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Flow panel */}
      <Card size="lg" className="px-5">
        <Eyebrow>Flow</Eyebrow>
        <div className="mx-auto flex w-full max-w-[480px] flex-col">
          <div className="rounded-lg border border-secondary-accent/30 bg-secondary-accent/15 px-4 py-3">
            <Eyebrow>Entry</Eyebrow>
            <p className="mt-1 text-sm font-medium">{sequence.entry.title}</p>
            <p className="text-xs text-muted-foreground">
              {sequence.entry.sub}
            </p>
          </div>

          {sequence.steps.map((step, i) => (
            <div key={`${sequence.key}-${i}`} className="flex flex-col">
              <Connector />
              {step.kind === "email" && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenEmail({ key: sequence.key, index: i });
                    setModalOpen(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors outline-none hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
                >
                  <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                    {step.day}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {step.subject}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </button>
              )}
              {step.kind === "wait" && (
                <div
                  className={cn(
                    "mx-auto flex flex-wrap items-center justify-center gap-x-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground",
                    (step.waitingCount ?? 0) === 0 && "opacity-60",
                  )}
                >
                  <span>
                    Wait {step.days} {step.days === 1 ? "day" : "days"}
                  </span>
                  <span aria-hidden>.</span>
                  <span>
                    {step.waitingCount ?? 0}{" "}
                    {(step.waitingCount ?? 0) === 1 ? "contact" : "contacts"}{" "}
                    waiting
                  </span>
                </div>
              )}
              {step.kind === "loop" && (
                <div className="rounded-lg border border-secondary-accent/30 bg-secondary-accent/15 px-3 py-2">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.sub}</p>
                </div>
              )}
            </div>
          ))}

          <Connector />
          {sequence.key === "newsletter" ? (
            <div className="rounded-lg border bg-muted/40 px-4 py-3 text-center text-sm font-medium">
              Stays subscribed
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-3 text-center text-sm text-muted-foreground">
              Sequence complete
            </div>
          )}
        </div>

        <div className="mx-auto mt-2 w-full max-w-[480px] border-t pt-4">
          <Eyebrow>Exit triggers</Eyebrow>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {sequence.exits.map((exit) => (
              <li key={exit}>{exit}</li>
            ))}
          </ul>
          {sequence.exitNote && (
            <p className="mt-2 text-xs text-muted-foreground">
              {sequence.exitNote}
            </p>
          )}
        </div>
      </Card>

      {modalStep && openEmail && (
        <EmailModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          sequence={sequences[openEmail.key]}
          step={modalStep}
          stepIndex={openEmail.index}
        />
      )}
    </div>
  );
}
