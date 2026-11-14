"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  ClipboardCheck,
  DatabaseZap,
  KeyRound,
  ListX,
  Lock,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  checkImportRequest,
  continueImportRequest,
  getImportStatus,
  saveImportUserRequest,
  startImportRequest,
} from "@/lib/sales/api-client";
import { formatMoney } from "@/lib/sales/format";
import {
  BOSS_NOTE,
  checkResult,
  type ContinueAnswer,
  countRows,
  driveRun,
  failureMessage,
  FINAL_WORD,
  finalEnabled,
  formatCount,
  formatWhen,
  type ImportRunView,
  type ImportStatus,
  issueLines,
  NOT_COPIED,
  NOT_COPIED_FILES,
  runName,
  type SavedCheck,
  screenState,
  SLOW_DOWN,
  stepLabel,
  stepPosition,
} from "@/lib/sales/pipedrive/import-view-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The "Copy from Pipedrive" screen (admins only; the page gates it). It drives
// a copy through `driveRun` (call `continue` until the server says done, wait a
// minute when Pipedrive asks us to slow down, stop on a stall) and shows the
// report. It stores nothing in the browser: everything comes from the server,
// so leaving the page only pauses a copy, and "Keep going" picks it up again.
// Buttons are disabled while a request is in flight; the server refuses a
// second running copy too.

const CARD = "rounded-[12px] border bg-card shadow-sm";
const CARD_HEAD =
  "flex items-center gap-2 border-b px-4 py-3 text-[14px] font-semibold text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground";
const BODY = "px-4 py-3 text-[13.5px] leading-snug";
/** Buttons and fields are 44px tall on touch screens. */
const TOUCH = "pointer-coarse:min-h-11";
const NOTE = "rounded-[10px] bg-accent px-3 py-2.5 text-[13px] text-accent-foreground";

function CardHeader({ icon: Icon, children, className }: { icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(CARD_HEAD, className)}>
      <Icon aria-hidden="true" />
      <h2 className="m-0 text-[14px] font-semibold">{children}</h2>
    </div>
  );
}

/** While this page drives a copy. `finishing`: the server said done (or the loop stopped) and the status is being read again. */
type Loop = { paused: boolean; finishing: boolean } | null;

export function ImportView({ initial }: { initial: ImportStatus }) {
  const [status, setStatus] = useState<ImportStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loop, setLoop] = useState<Loop>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  // A ref as well as state, so a double click is refused before React re-renders.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
    };
  }, []);

  const base = screenState(status);
  const run = status.run;
  // "Start again" on a failed copy shows the start choices; the failed run stays on the server for the record.
  const state = base === "failed" && run && dismissedFailure === run.id ? "ready" : base;
  const working = busy || loop !== null;
  const realCopyDone = status.realCopy?.status === "DONE";

  async function refresh() {
    const result = await getImportStatus();
    if (!mounted.current) return;
    if (result.ok) setStatus(result.data);
    else setError(result.error);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      pauseTimer.current = setTimeout(resolve, ms);
    });
  }

  /** Folds one `continue` answer into the run on screen, so the card never falls back to an older step. */
  function foldAnswer(runId: string, answer: ContinueAnswer) {
    setStatus((s) => (s.run && s.run.id === runId ? { ...s, run: { ...s.run, phase: answer.phase, counts: answer.counts } } : s));
    setLoop({ paused: answer.paused, finishing: false });
  }

  async function drive(runId: string) {
    setError(null);
    setLoop({ paused: false, finishing: false });
    const outcome = await driveRun({
      continueFn: () => continueImportRequest(runId),
      sleep,
      now: () => Date.now(),
      isActive: () => mounted.current,
      onProgress: (answer) => foldAnswer(runId, answer),
    });
    if (!mounted.current) return;
    if (outcome.kind === "stopped" && outcome.message) setError(outcome.message);
    if (outcome.kind === "done") {
      const finishedAt = new Date().toISOString();
      setStatus((s) => (s.run && s.run.id === runId ? { ...s, run: { ...s.run, status: "DONE", finishedAt } } : s));
    }
    // The card stays on the last step it reached ("Finishing up") until the fresh status is in.
    setLoop({ paused: false, finishing: true });
    await refresh();
    if (mounted.current) setLoop(null);
  }

  /** Runs one request at a time; a second click while one is in flight does nothing. */
  async function once(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function start(mode: "DRY_RUN" | "LIVE" | "FINAL") {
    // The button is disabled until LOCK is typed; this is the same rule again, and the server checks it a third time.
    if (mode === "FINAL" && !finalEnabled(typed)) return;
    void once(async () => {
      const result = await startImportRequest(mode === "FINAL" ? { mode, confirm: typed.trim() } : { mode });
      if (!result.ok) {
        setError(result.error);
        await refresh();
        return;
      }
      setTyped("");
      setDismissedFailure(null);
      setStatus((s) => ({
        ...s,
        run: {
          id: result.data.runId,
          mode: mode === "DRY_RUN" ? "DRY_RUN" : "LIVE",
          isFinal: mode === "FINAL",
          status: "RUNNING",
          phase: "users",
          counts: {},
          issues: [],
          startedAt: new Date().toISOString(),
          finishedAt: null,
        },
      }));
      // Not awaited inside `once`: the loop has its own state, and the buttons stay off while it runs.
      void drive(result.data.runId);
    });
  }

  function keepGoing() {
    if (!run || loop) return;
    void drive(run.id);
  }

  function check() {
    void once(async () => {
      setChecking(true);
      try {
        const result = await checkImportRequest();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setStatus((s) => ({ ...s, check: result.data }));
      } finally {
        if (mounted.current) setChecking(false);
      }
    });
  }

  function pickOwner(pipedriveUserId: number, memberId: string) {
    void once(async () => {
      const result = await saveImportUserRequest({ pipedriveUserId, memberId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus((s) => ({ ...s, users: result.data.users }));
    });
  }

  const showRunning = loop !== null || state === "running";
  const canStart = (state === "ready" || state === "done") && !showRunning;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <Link
          href="/sales/settings"
          className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Sales settings
        </Link>
        <h1 className="m-0 text-[21px] font-semibold">Copy from Pipedrive</h1>
        <p className="mt-1 max-w-[65ch] text-[13px] text-muted-foreground">
          Copies organizations, people, deals, leads, activities, notes and files into the app. Pipedrive is only read, never changed.
        </p>
      </div>

      {error ? (
        <p role="alert" className="m-0 flex gap-2 rounded-[10px] bg-status-danger px-3 py-2.5 text-[13px] text-status-danger-foreground">
          <CircleAlert aria-hidden="true" className="mt-[2px] size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {state === "no-token" ? <TokenSteps /> : null}

      {state === "locked" ? (
        <section className={CARD}>
          <CardHeader icon={Lock}>Copying is locked</CardHeader>
          <p className={cn(BODY, "m-0")}>
            The final copy finished{status.lockedAt ? ` on ${formatWhen(status.lockedAt)}` : ""}. Pipedrive was switched off, so no copy
            can run again. The report below is read only.
          </p>
        </section>
      ) : null}

      {showRunning && run ? (
        <RunProgress
          title={runName(run)}
          phase={run.phase}
          counts={run.counts}
          paused={loop?.paused ?? false}
          active={loop !== null}
          finishing={loop?.finishing ?? false}
          busy={working}
          onKeepGoing={keepGoing}
        />
      ) : null}

      {state === "failed" && run && !showRunning ? (
        <section className={CARD}>
          <CardHeader icon={TriangleAlert}>The copy stopped</CardHeader>
          <div className={BODY}>
            <p className="m-0 rounded-[10px] bg-status-danger px-3 py-2.5 text-[13px] text-status-danger-foreground">{failureMessage(run)}</p>
            <p className="mt-2 mb-3 max-w-[65ch] text-muted-foreground">
              {run.isFinal ? "It did not lock. " : ""}Nothing is lost. Records copied before it stopped stay in the app. The next copy only
              adds or fixes what differs.
            </p>
            <Button type="button" variant="outline" className={TOUCH} disabled={working} onClick={() => setDismissedFailure(run.id)}>
              Start again
            </Button>
          </div>
        </section>
      ) : null}

      {canStart ? <StartCard status={status} busy={working} onStart={start} /> : null}

      {run && (state === "done" || state === "locked") && !showRunning ? (
        <CheckCard
          realCopyDone={realCopyDone}
          saved={status.check}
          locked={state === "locked"}
          busy={working}
          checking={checking}
          onCheck={check}
        />
      ) : null}

      {status.token.set || status.locked ? (
        <OwnersCard status={status} disabled={working || state === "locked" || showRunning} onPick={pickOwner} />
      ) : null}

      {run && run.issues.length > 0 && !showRunning ? <IssuesCard run={run} /> : null}

      <section className={CARD}>
        <CardHeader icon={ListX}>Not copied</CardHeader>
        <div className={BODY}>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {NOT_COPIED.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 mb-0 text-[12.5px] text-muted-foreground">{NOT_COPIED_FILES}</p>
        </div>
      </section>

      {canStart && realCopyDone ? <FinalBox typed={typed} onType={setTyped} busy={working} onFinal={() => start("FINAL")} /> : null}
    </div>
  );
}

function TokenSteps() {
  return (
    <section className={CARD}>
      <CardHeader icon={KeyRound}>Add the Pipedrive key first</CardHeader>
      <div className={BODY}>
        <p className="m-0 max-w-[65ch]">
          The app needs a Pipedrive API token to read your Pipedrive account. It is kept in Vercel and never shown here.
        </p>
        <ol className="mt-3 mb-0 flex list-decimal flex-col gap-1.5 pl-5">
          <li>In Vercel, open this project, then Settings, then Environment Variables.</li>
          <li>
            Add <code className="rounded bg-muted px-1 text-[12.5px]">PIPEDRIVE_API_TOKEN</code> for Production, with the token from
            Pipedrive (your name, Personal preferences, API).
          </li>
          <li>Redeploy the app, then come back to this page.</li>
        </ol>
      </div>
    </section>
  );
}

/** A one-line summary of the automatic Pipedrive to Sales sync (cron sales-pipedrive-sync). */
function AutoSyncLine({ autoSync }: { autoSync: ImportStatus["autoSync"] }) {
  // The master switch is SALES_PIPEDRIVE_SYNC_ENABLED in Vercel; the server reads it and tells the screen.
  if (!autoSync.enabled) {
    return (
      <p className="mt-1 mb-0 text-muted-foreground">
        Automatic sync is off. Turn it on in Vercel (<code className="rounded bg-muted px-1 text-[12.5px]">SALES_PIPEDRIVE_SYNC_ENABLED=true</code>) so the app stays a few hours behind Pipedrive on its own.
      </p>
    );
  }
  return (
    <p className="mt-1 mb-0 text-muted-foreground">
      Automatic sync is on. {autoSync.lastSyncedAt ? `Last synced ${formatWhen(autoSync.lastSyncedAt)}.` : "No copy has finished yet."}
    </p>
  );
}

function StartCard({
  status,
  busy,
  onStart,
}: {
  status: ImportStatus;
  busy: boolean;
  onStart: (mode: "DRY_RUN" | "LIVE") => void;
}) {
  const run = status.run && status.run.status === "DONE" ? status.run : null;
  const rows = run ? countRows(run.counts) : [];
  return (
    <section className={CARD}>
      <CardHeader icon={DatabaseZap}>{run ? `${runName(run)} finished` : "Start a copy"}</CardHeader>
      <div className={BODY}>
        <p className="m-0">
          {status.token.last4 ? `Pipedrive token ending in ${status.token.last4} is set.` : "The Pipedrive token is set."}
        </p>
        <AutoSyncLine autoSync={status.autoSync} />
        {run ? (
          <>
            <p className="mt-1 mb-0 text-muted-foreground">
              Finished {run.finishedAt ? formatWhen(run.finishedAt) : ""}.{" "}
              {run.mode === "DRY_RUN" ? "Nothing was saved. This is what a real copy would do." : null}
            </p>
            {rows.length > 0 ? <CountsTable rows={rows} /> : null}
          </>
        ) : (
          <p className="mt-1 mb-0 max-w-[65ch] text-muted-foreground">
            Start with a practice run. It reads everything and shows what a real copy would do, but saves nothing.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2 max-sm:flex-col">
          <Button type="button" variant="outline" className={cn(TOUCH, "max-sm:w-full")} disabled={busy} onClick={() => onStart("DRY_RUN")}>
            Practice run (saves nothing)
          </Button>
          <Button type="button" className={cn(TOUCH, "max-sm:w-full")} disabled={busy} onClick={() => onStart("LIVE")}>
            Copy for real
          </Button>
        </div>
        <p className={cn(NOTE, "mt-3 mb-0")}>{BOSS_NOTE}</p>
      </div>
    </section>
  );
}

function CountsTable({ rows }: { rows: ReturnType<typeof countRows> }) {
  const n = "px-2 py-1.5 text-right tabular-nums";
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[300px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b text-[12px] text-muted-foreground">
            <th className="py-1.5 pr-2 text-left font-semibold">Kind</th>
            <th className={cn(n, "font-semibold")}>New</th>
            <th className={cn(n, "font-semibold")}>Changed</th>
            <th className={cn(n, "font-semibold")}>Same</th>
            <th className={cn(n, "pr-0 font-semibold")}>Left out</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b last:border-b-0">
              <td className="py-1.5 pr-2">{row.label}</td>
              <td className={n}>{formatCount(row.created)}</td>
              <td className={n}>{formatCount(row.updated)}</td>
              <td className={n}>{formatCount(row.unchanged)}</td>
              <td className={cn(n, "pr-0")}>{formatCount(row.skipped)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunProgress({
  title,
  phase,
  counts,
  paused,
  active,
  finishing,
  busy,
  onKeepGoing,
}: {
  /** "The real copy", "The practice run" or "The final copy". */
  title: string;
  phase: string;
  counts: Record<string, number>;
  paused: boolean;
  /** True while this page is driving the copy; false when it is not (the page was left, or the loop stopped). */
  active: boolean;
  finishing: boolean;
  busy: boolean;
  onKeepGoing: () => void;
}) {
  const { step, total } = stepPosition(phase);
  const rows = countRows(counts);
  const filled = phase === "done" ? 1 : (step - 1) / total;
  return (
    <section className={CARD}>
      <CardHeader icon={DatabaseZap}>{active ? `${title} is running` : `${title} is paused`}</CardHeader>
      <div className={BODY}>
        <div aria-live="polite">
          {finishing ? (
            <p className="m-0 text-[14px] font-semibold">Finishing up</p>
          ) : (
            <>
              <p className="m-0 text-[14px] font-semibold">{stepLabel(phase)}</p>
              <p className="mt-0.5 mb-0 text-muted-foreground">
                Step {step} of {total}.{" "}
                {active
                  ? "Stay on this page. Leaving it pauses the copy."
                  : "It is not moving right now. Press Keep going to carry on from where it stopped."}
              </p>
            </>
          )}
          {paused && !finishing ? (
            <p className="mt-2 mb-0 rounded-[10px] bg-status-warning px-3 py-2.5 text-[13px] text-status-warning-foreground">{SLOW_DOWN}</p>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-label="Copy progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={phase === "done" ? total : step - 1}
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            style={{ transform: `scaleX(${filled})` }}
          />
        </div>
        {rows.length > 0 ? (
          <dl className="mt-3 mb-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="m-0 text-right tabular-nums">{formatCount(row.created + row.updated + row.unchanged + row.skipped)} so far</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {!active ? (
          <Button type="button" className={cn(TOUCH, "mt-3 max-sm:w-full")} disabled={busy} onClick={onKeepGoing}>
            Keep going
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function CheckCard({
  realCopyDone,
  saved,
  locked,
  busy,
  checking,
  onCheck,
}: {
  /** The latest real copy finished. The check reads it, and it changes no copied records, so it is allowed after the lock too. */
  realCopyDone: boolean;
  saved: SavedCheck | null;
  locked: boolean;
  busy: boolean;
  checking: boolean;
  onCheck: () => void;
}) {
  const n = "px-2 py-1.5 text-right tabular-nums";
  let intro: string;
  if (!realCopyDone) intro = "The check counts Pipedrive against the app, so it runs after a real copy.";
  else if (saved) intro = `Counts Pipedrive against the app. Checked ${formatWhen(saved.at)}.`;
  else if (locked) intro = "The final copy has not been checked yet.";
  else intro = "Counts Pipedrive against the app and picks 5 deals to compare by eye. It reads every Pipedrive list, so it takes about a minute.";
  return (
    <section className={CARD}>
      <CardHeader icon={ClipboardCheck}>Check the copy</CardHeader>
      <div className={BODY}>
        <p className="m-0 text-muted-foreground">{intro}</p>

        {saved && realCopyDone ? (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b text-[12px] text-muted-foreground">
                    <th className="py-1.5 pr-2 text-left font-semibold">Kind</th>
                    <th className={cn(n, "font-semibold")}>In Pipedrive</th>
                    <th className={cn(n, "font-semibold")}>In the app</th>
                    <th className={cn(n, "font-semibold max-sm:hidden")}>Left out on purpose</th>
                    <th className="py-1.5 pl-2 text-left font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {saved.report.rows.map((row) => (
                    <tr key={row.entity} className="border-b align-top last:border-b-0">
                      <td className="py-1.5 pr-2">
                        {row.label}
                        <div className="text-[12px] text-muted-foreground sm:hidden">{formatCount(row.skipped)} left out</div>
                      </td>
                      <td className={n}>{formatCount(row.pipedrive)}</td>
                      <td className={n}>{formatCount(row.app)}</td>
                      <td className={cn(n, "max-sm:hidden")}>{formatCount(row.skipped)}</td>
                      <td className="py-1.5 pl-2">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-px text-[12px] font-medium whitespace-nowrap",
                            row.ok ? "bg-status-success text-status-success-foreground" : "bg-status-danger text-status-danger-foreground",
                          )}
                        >
                          {checkResult(row)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 mb-0 text-[12.5px] text-muted-foreground">
              Short or extra means the app has fewer or more than Pipedrive. A difference within 1 percent counts as a match.
            </p>
            {saved.report.spot.length > 0 ? (
              <>
                <h3 className="mt-4 mb-1.5 text-[13.5px] font-semibold">Compare these deals in Pipedrive</h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {saved.report.spot.map((deal) => (
                    <li key={deal.pipedriveId} className="min-w-0 break-words">
                      <span className="font-medium">{deal.title}</span>{" "}
                      <span className="text-muted-foreground">
                        {formatMoney(deal.valueCents)}, {deal.stage}, {deal.owner}, {deal.status.toLowerCase()}. Pipedrive id {deal.pipedriveId}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}

        {realCopyDone ? (
          <Button
            type="button"
            variant="outline"
            className={cn(TOUCH, "mt-3 max-sm:w-full")}
            disabled={busy}
            aria-busy={checking || undefined}
            onClick={onCheck}
          >
            {checking ? "Checking, about a minute..." : "Check the copy"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function OwnersCard({
  status,
  disabled,
  onPick,
}: {
  status: ImportStatus;
  disabled: boolean;
  onPick: (pipedriveUserId: number, memberId: string) => void;
}) {
  return (
    <section className={CARD}>
      <CardHeader icon={Users}>Whose records go to whom</CardHeader>
      {status.users.length === 0 ? (
        <p className={cn(BODY, "m-0 text-muted-foreground")}>The list of Pipedrive users shows up here after the first run reads them.</p>
      ) : (
        <>
          <p className="m-0 border-b px-4 py-2.5 text-[12.5px] text-muted-foreground">
            A change applies the next time you copy. Like any copy, it replaces edits made here to copied records.
          </p>
          <ul className="m-0 flex list-none flex-col divide-y p-0">
            {status.users.map((user) => (
              <li key={user.pipedriveUserId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13.5px]">
                <div className="min-w-0 flex-1">
                  <span className="font-semibold">{user.name}</span>
                  {user.memberId === null ? (
                    <span className="ml-2 inline-block rounded-full bg-status-warning px-2 py-px text-[12px] font-medium text-status-warning-foreground">
                      Not matched
                    </span>
                  ) : null}
                  <div className="text-[12.5px] break-words text-muted-foreground">
                    {user.memberId === null
                      ? "Records go to the person who started the copy until you pick someone."
                      : [user.email, user.auto ? "matched by email" : "set here for the next copy"].filter(Boolean).join(", ")}
                  </div>
                </div>
                <select
                  aria-label={`Team member for ${user.name}`}
                  value={user.memberId ?? ""}
                  disabled={disabled}
                  onChange={(event) => onPick(user.pipedriveUserId, event.target.value)}
                  className={cn(
                    "h-9 rounded-md border bg-background px-2 text-[14px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 max-sm:w-full sm:min-w-[200px]",
                    TOUCH,
                  )}
                >
                  {user.memberId === null ? (
                    <option value="" disabled>
                      Pick a team member
                    </option>
                  ) : null}
                  {status.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function IssuesCard({ run }: { run: ImportRunView }) {
  const { lines, rest } = issueLines(run.issues);
  const dropped = run.counts.issuesDropped ?? 0;
  return (
    <section className={CARD}>
      <CardHeader icon={TriangleAlert}>Things to look at</CardHeader>
      <div className={BODY}>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
          {lines.map((line, index) => (
            <li key={index} className="break-words">
              {line}
            </li>
          ))}
        </ul>
        {rest > 0 ? (
          <p className="mt-2 mb-0 text-muted-foreground">
            And {formatCount(rest)} more {rest === 1 ? "kind" : "kinds"} not shown.
          </p>
        ) : null}
        {dropped > 0 ? (
          <p className="mt-1 mb-0 text-muted-foreground">
            {formatCount(dropped)} more {dropped === 1 ? "was" : "were"} not kept, to keep this list short.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FinalBox({
  typed,
  onType,
  busy,
  onFinal,
}: {
  typed: string;
  onType: (value: string) => void;
  busy: boolean;
  onFinal: () => void;
}) {
  const inputId = useId();
  const helpId = useId();
  const hintId = useId();
  return (
    <section className="rounded-[12px] border border-destructive/40 bg-card shadow-sm">
      <CardHeader icon={Lock} className="border-destructive/25 text-destructive [&_svg]:text-destructive">
        Final copy and lock
      </CardHeader>
      <div className={BODY}>
        <p id={helpId} className="m-0 max-w-[65ch]">
          Only on switch-off day, after you have checked a real copy. This copies one last time, replacing edits made here to copied
          records, and ends copying for good. After it, no copy can run again.
        </p>
        <label htmlFor={inputId} className="mt-3 mb-1 block text-[13px] font-medium">
          Type {FINAL_WORD} to confirm
        </label>
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          <input
            id={inputId}
            value={typed}
            onChange={(event) => onType(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby={`${helpId} ${hintId}`}
            className={cn(
              "h-9 w-40 rounded-md border bg-background px-2 text-[14px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:w-full",
              TOUCH,
            )}
          />
          <Button
            type="button"
            variant="destructive"
            className={cn(TOUCH, "max-sm:w-full")}
            disabled={busy || !finalEnabled(typed)}
            onClick={onFinal}
          >
            Final copy and lock
          </Button>
        </div>
        <p id={hintId} className="mt-1 mb-0 text-[12.5px] text-muted-foreground">
          Type {FINAL_WORD} in capitals.
        </p>
      </div>
    </section>
  );
}
