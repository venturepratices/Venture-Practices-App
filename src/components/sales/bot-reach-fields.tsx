"use client";

import { type BotDraft } from "@/lib/sales/bots-view-model";

// Where a bot may work: all pipelines or picked ones (an empty pick means
// none), and whether it sees only its person's own deals and leads.

export function BotReachFields({
  draft,
  pipelines,
  personName,
  onChange,
}: {
  draft: BotDraft;
  pipelines: { key: string; name: string }[];
  personName: string;
  onChange: (draft: BotDraft) => void;
}) {
  const togglePipeline = (key: string) =>
    onChange({
      ...draft,
      pipelineKeys: draft.pipelineKeys.includes(key) ? draft.pipelineKeys.filter((k) => k !== key) : [...draft.pipelineKeys, key],
    });

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-[13px] font-semibold">Pipelines</legend>
        <label className="flex min-h-10 items-center gap-3 text-[13.5px] pointer-coarse:min-h-11">
          <input
            type="checkbox"
            className="size-5"
            checked={draft.allPipelines}
            onChange={(e) => onChange({ ...draft, allPipelines: e.target.checked })}
          />
          All pipelines
        </label>
        {!draft.allPipelines ? (
          <div className="flex flex-col pl-8">
            {pipelines.map((p) => (
              <label key={p.key} className="flex min-h-10 items-center gap-3 text-[13.5px] pointer-coarse:min-h-11">
                <input type="checkbox" className="size-5" checked={draft.pipelineKeys.includes(p.key)} onChange={() => togglePipeline(p.key)} />
                {p.name}
              </label>
            ))}
            <p className="m-0 text-[12.5px] text-muted-foreground">Leads are not in a pipeline, so this limits deals only.</p>
          </div>
        ) : null}
      </fieldset>
      <label className="flex items-start gap-3 text-[13.5px]">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0"
          checked={draft.ownDealsOnly}
          onChange={(e) => onChange({ ...draft, ownDealsOnly: e.target.checked })}
        />
        <span>
          <span className="font-semibold">Only {personName}&apos;s own deals and leads</span>
          <span className="block text-[12.5px] text-muted-foreground">
            Recommended. Untick to let the bot see everything {personName} can see.
          </span>
        </span>
      </label>
    </div>
  );
}
