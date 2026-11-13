"use client";

import { BOT_RISK_LABELS, BOT_ROLE_OPTIONS, type BotRole, type BotScope } from "@/lib/sales/bot-scopes";
import { type BotDraft, pickRole, scopesByArea, toggleScope } from "@/lib/sales/bots-view-model";
import { cn } from "@/lib/utils";

// Role presets plus the editable permission checklist, grouped by area from
// the catalogue (a new area shows up here with no change to this file), each
// with its plain sentence and risk mark.

const RISK_TONE = {
  low: "border-emerald-700/30 text-emerald-800 dark:text-emerald-300",
  medium: "border-amber-700/30 text-amber-800 dark:text-amber-300",
  higher: "border-red-700/30 text-red-800 dark:text-red-300",
} as const;

export function BotPermissions({ draft, onChange }: { draft: BotDraft; onChange: (draft: BotDraft) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-semibold">Role</legend>
        <div className="flex flex-wrap gap-2">
          {BOT_ROLE_OPTIONS.map((role) => (
            <button
              key={role.key}
              type="button"
              aria-pressed={draft.role === role.key}
              onClick={() => onChange(pickRole(draft, role.key as BotRole))}
              className={cn(
                "min-h-10 rounded-lg border px-3 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11",
                draft.role === role.key ? "border-primary bg-primary/10 font-semibold" : "bg-background",
              )}
            >
              {role.label}
              <span className="block text-[12px] font-normal text-muted-foreground">{role.description}</span>
            </button>
          ))}
        </div>
        {draft.role === "custom" ? <p className="mt-1.5 text-[12.5px] text-muted-foreground">Custom: you picked the permissions by hand.</p> : null}
      </fieldset>
      {scopesByArea().map((area) => (
        <fieldset key={area.key} className="m-0 border-0 p-0">
          <legend className="mb-1 text-[13px] font-semibold">Permissions ({area.label})</legend>
          <ul className="m-0 flex list-none flex-col divide-y p-0">
            {area.scopes.map((scope) => {
              const id = `bot-scope-${scope.key}`;
              return (
                <li key={scope.key} className="flex items-start gap-3 py-2">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0"
                    checked={draft.scopes.includes(scope.key)}
                    onChange={() => onChange(toggleScope(draft, scope.key as BotScope))}
                    aria-describedby={`${id}-help`}
                  />
                  <label htmlFor={id} className="min-w-0 flex-1 text-[13.5px]">
                    <span className="font-semibold">{scope.label}</span>{" "}
                    <span className={cn("ml-1 inline-block rounded-full border px-2 text-[11.5px]", RISK_TONE[scope.risk])}>
                      {BOT_RISK_LABELS[scope.risk]}
                    </span>
                    <span id={`${id}-help`} className="block text-[12.5px] text-muted-foreground">
                      {scope.description}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
