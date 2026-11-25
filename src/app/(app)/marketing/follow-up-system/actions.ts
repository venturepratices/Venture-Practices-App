"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/permissions";
import { requireMarketingUser, type MarketingActor } from "@/lib/marketing/access";
import { logMarketingAction } from "@/lib/marketing/audit";
import { missingVariables } from "@/lib/marketing/email-diff";
import { getFlowEmail, saveFlowEmailDraft } from "@/lib/marketing/nitro-client";
import type {
  FetchDraftResult,
  SaveDraftError,
  SaveDraftInput,
  SaveDraftResult,
} from "@/lib/marketing/email-editor-types";

const SAVE_LIMIT = 20;
const SAVE_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_ACTORS = 2000;

// Per-process, best-effort (same trade-off as audit.ts): a cold start resets it.
const saveTimes = new Map<string, number[]>();

function consumeSaveSlot(actorId: string): boolean {
  const now = Date.now();
  const recent = (saveTimes.get(actorId) ?? []).filter((t) => now - t < SAVE_WINDOW_MS);
  if (recent.length >= SAVE_LIMIT) {
    saveTimes.set(actorId, recent);
    return false;
  }
  recent.push(now);
  // Re-insert so Map order stays oldest-activity first for eviction.
  saveTimes.delete(actorId);
  saveTimes.set(actorId, recent);
  if (saveTimes.size > MAX_TRACKED_ACTORS) {
    const half = Math.floor(saveTimes.size / 2);
    for (const k of [...saveTimes.keys()].slice(0, half)) saveTimes.delete(k);
  }
  return true;
}

function permissionToError(error: PermissionError): SaveDraftError {
  return error.status === 401
    ? { kind: "unauthorized", message: "Sign in required" }
    : { kind: "forbidden", message: "Marketing access required" };
}

function isValidDraft(d: unknown): boolean {
  if (!d || typeof d !== "object") return false;
  const x = d as Record<string, unknown>;
  return typeof x.subject === "string" && typeof x.body === "string";
}

function isValidInput(input: unknown): input is SaveDraftInput {
  if (!input || typeof input !== "object") return false;
  const i = input as Record<string, unknown>;
  return (
    typeof i.flowId === "string" &&
    i.flowId.length > 0 &&
    typeof i.stepIndex === "number" &&
    Number.isInteger(i.stepIndex) &&
    i.stepIndex >= 0 &&
    isValidDraft(i.before) &&
    isValidDraft(i.after)
  );
}

export async function fetchEmailDraftAction(
  flowId: string,
  stepIndex: number,
): Promise<FetchDraftResult> {
  try {
    try {
      await requireMarketingUser();
    } catch (error) {
      if (error instanceof PermissionError) return { ok: false, error: permissionToError(error) };
      throw error;
    }
    if (typeof flowId !== "string" || !flowId || !Number.isInteger(stepIndex) || stepIndex < 0) {
      return { ok: false, error: { kind: "unknown", message: "Invalid input" } };
    }
    return await getFlowEmail(flowId, stepIndex);
  } catch (error) {
    console.error("[marketing/actions] fetch failed", error);
    return {
      ok: false,
      error: { kind: "unknown", message: "Something went wrong loading this email" },
    };
  }
}

export async function saveEmailDraftAction(input: SaveDraftInput): Promise<SaveDraftResult> {
  try {
    let actor: MarketingActor;
    try {
      actor = await requireMarketingUser();
    } catch (error) {
      if (error instanceof PermissionError) return { ok: false, error: permissionToError(error) };
      throw error;
    }
    // access.ts has no admin-scope helper; the actor carries isAdmin.
    if (!actor.isAdmin) {
      return { ok: false, error: { kind: "forbidden", message: "Marketing access required" } };
    }

    if (!isValidInput(input)) {
      return { ok: false, error: { kind: "unknown", message: "Invalid input" } };
    }

    const dropped = missingVariables(input.before.body, input.after.body);
    if (dropped.length > 0 && input.confirmedDrop !== true) {
      return { ok: false, needsConfirmation: true, droppedVariables: dropped };
    }

    if (!consumeSaveSlot(actor.userId)) {
      return {
        ok: false,
        error: {
          kind: "rate_limited",
          message: "You've saved 20 times this hour. Try again in a bit.",
        },
      };
    }

    const result = await saveFlowEmailDraft(input);
    if (!result.ok) return result;

    await logMarketingAction(
      { userId: actor.userId },
      "marketing.email.save",
      `Saved a draft of email step ${input.stepIndex + 1} in flow ${input.flowId}`,
      {
        flowId: input.flowId,
        stepIndex: input.stepIndex,
        subjectChanged: input.before.subject !== input.after.subject,
        bodyLengthBefore: input.before.body.length,
        bodyLengthAfter: input.after.body.length,
        droppedCount: dropped.length,
      },
    );

    revalidatePath("/marketing/follow-up-system");
    return result;
  } catch (error) {
    console.error("[marketing/actions] save failed", error);
    return {
      ok: false,
      error: { kind: "unknown", message: "Something went wrong saving your changes" },
    };
  }
}
