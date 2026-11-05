"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { List, ListFilter, Plus, Search, SquareKanban } from "lucide-react";

import type { BoardPageData } from "@/lib/sales/board";
import { activeFilterCount, dealsSummary, hasActiveFilters } from "@/lib/sales/board-client";
import { parseBoardQuery, type BoardQuery } from "@/lib/sales/board-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSalesShortcut } from "@/components/sales/sales-shortcuts";
import { ShortcutsButton } from "@/components/sales/shortcuts-help-dialog";

// The Deals toolbar (mockup `.tbar`): pipeline, Board or List, Everyone or
// Just me, the Filter menu, the board search, "+ Deal", the summary and the
// shortcuts button. Every change goes through `onNavigate`, which builds the
// URL with nextBoardQuery. On phones it wraps in the same order it reads (so
// focus order matches what is seen): the pipeline grows to fill its line,
// search fills the line it lands on beside "+ Deal", and the summary takes the
// last line. The shortcuts button is hidden there (no keyboard on a phone).

export type BoardPatch = Partial<Omit<BoardQuery, "cursor">>;

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
] as const;

const NEXT_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "none", label: "No next step" },
] as const;

const SEARCH_DEBOUNCE_MS = 300;

const SEGMENT_GROUP = "inline-flex shrink-0 rounded-lg border bg-card p-0.5 pointer-coarse:p-0";
const SEGMENT =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground pointer-coarse:h-10 pointer-coarse:min-w-10 [&_svg]:size-4";

export function DealsToolbar({
  data,
  controls,
  onNavigate,
  onNewDeal,
  onClearFilters,
}: {
  data: BoardPageData;
  /** The query the controls show: the server's, or the one just asked for while it loads (so a click shows at once). */
  controls: BoardQuery;
  onNavigate: (patch: BoardPatch) => void;
  onNewDeal: () => void;
  onClearFilters: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const filterCount = activeFilterCount(controls);

  // The search box shows what was typed, and sends it 300ms after typing stops.
  // When the search changes some other way (Clear filters, Back), the box
  // follows it, unless the person is mid-typing or it already means the same.
  const [text, setText] = useState(controls.q);
  const [typing, setTyping] = useState(false);
  const [syncedQ, setSyncedQ] = useState(controls.q);
  if (controls.q !== syncedQ) {
    setSyncedQ(controls.q);
    if (!typing && parseBoardQuery({ q: text }).q !== controls.q) setText(controls.q);
  }

  const settleSearch = useEffectEvent((value: string) => {
    setTyping(false);
    const q = parseBoardQuery({ q: value }).q;
    if (q !== controls.q) onNavigate({ q });
  });

  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => settleSearch(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, typing]);

  useSalesShortcut("search", () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });

  const pipelineItems = Object.fromEntries(data.pipelines.map((pipeline) => [pipeline.key, pipeline.name]));
  const pipelineKey = controls.pipeline ?? data.pipeline.key;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
      <Select
        items={pipelineItems}
        value={pipelineKey}
        onValueChange={(key) => {
          if (typeof key === "string" && key !== pipelineKey) onNavigate({ pipeline: key });
        }}
      >
        <SelectTrigger
          aria-label="Pipeline"
          className="min-w-0 max-w-full font-semibold max-sm:flex-1 pointer-coarse:h-10"
        >
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">
          {data.pipelines.map((pipeline) => (
            <SelectItem key={pipeline.key} value={pipeline.key} className="pointer-coarse:min-h-10">
              {pipeline.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div role="group" aria-label="View" className={SEGMENT_GROUP}>
        <button
          type="button"
          aria-label="Board view"
          title="Board"
          aria-pressed={controls.view === "board"}
          onClick={() => controls.view !== "board" && onNavigate({ view: "board" })}
          className={SEGMENT}
        >
          <SquareKanban aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="List view"
          title="List"
          aria-pressed={controls.view === "list"}
          onClick={() => controls.view !== "list" && onNavigate({ view: "list" })}
          className={SEGMENT}
        >
          <List aria-hidden="true" />
        </button>
      </div>

      {data.canSeeEveryone ? (
        <div role="group" aria-label="Whose deals" className={SEGMENT_GROUP}>
          <button
            type="button"
            aria-pressed={controls.scope === "everyone"}
            onClick={() => controls.scope !== "everyone" && onNavigate({ scope: "everyone" })}
            className={SEGMENT}
          >
            Everyone
          </button>
          <button
            type="button"
            aria-pressed={controls.scope === "mine"}
            onClick={() => controls.scope !== "mine" && onNavigate({ scope: "mine" })}
            className={SEGMENT}
          >
            Just me
          </button>
        </div>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              aria-label={filterCount > 0 ? `Filter, ${filterCount} active` : "Filter"}
              className="relative pointer-coarse:h-10"
            >
              <ListFilter aria-hidden="true" />
              Filter
              {filterCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-background"
                />
              ) : null}
            </Button>
          }
        />
        <DropdownMenuContent className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={controls.status}
              onValueChange={(status: BoardQuery["status"]) => onNavigate({ status })}
            >
              {STATUS_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className="pointer-coarse:min-h-10">
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Next step</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={controls.next} onValueChange={(next: BoardQuery["next"]) => onNavigate({ next })}>
              {NEXT_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className="pointer-coarse:min-h-10">
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasActiveFilters(controls)} onClick={onClearFilters} className="pointer-coarse:min-h-10">
            Clear filters
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="relative max-sm:min-w-0 max-sm:flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={searchRef}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Filter this board"
          aria-label="Filter this board"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setTyping(true);
          }}
          className="w-[190px] pl-8 max-sm:w-full pointer-coarse:h-10"
        />
      </div>

      <Button onClick={onNewDeal} aria-label="Add deal" className="pointer-coarse:h-10">
        <Plus aria-hidden="true" />
        Deal
      </Button>

      <p
        aria-live="polite"
        className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums max-sm:basis-full sm:ml-auto"
      >
        {dealsSummary(data.totals.valueCents, data.totals.count)}
      </p>

      <ShortcutsButton className="max-sm:hidden" />
    </div>
  );
}
