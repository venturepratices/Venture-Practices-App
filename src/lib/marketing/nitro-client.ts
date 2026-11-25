import "server-only";

import type {
  FetchDraftResult,
  SaveDraftError,
  SaveDraftErrorKind,
  SaveDraftInput,
  SaveDraftResult,
} from "./email-editor-types";

/**
 * NitroSend HTTP client for the inline email editor.
 *
 * API facts (from docs.nitrosend.com and https://api.nitrosend.com/openapi.yaml):
 *   - Base URL: https://api.nitrosend.com/v1/my
 *   - Auth: `Authorization: Bearer nskey_live_...`
 *   - Read:  GET   /flows/{id}  -> Flow { steps[], draft_revision_id, updated_at, ... }
 *            Each email step carries `subject` and `body` (plain text).
 *   - Write: PATCH /flows/{id}  with { steps, expected_draft_revision_id }.
 *            `steps` REPLACES the whole graph, so we send back the steps we
 *            just read with only the one email's subject/body changed.
 *            `expected_draft_revision_id` rejects stale writes (HTTP 409).
 *            Without `publish: true` the save stays a draft revision; a live
 *            flow keeps running its last published version.
 *
 * SAFE MODE: this module only ever sends `steps` and
 * `expected_draft_revision_id`. It never sends `publish`, `status` or
 * `approval_state`, so nothing here can make a change go live. Activating is
 * done by a person in NitroSend's own UI. The endpoint is hardcoded below;
 * callers cannot choose one.
 *
 * Step indexing: `stepIndex` is the position in the flow's top-level `steps`
 * array (waits count as steps), matching sequence.steps in sequences.ts. The
 * step at that position must be an email step.
 */

const BASE_URL = "https://api.nitrosend.com/v1/my";
const TIMEOUT_MS = 10_000;

/** The only top-level keys a save request may carry. */
const ALLOWED_PATCH_KEYS: ReadonlySet<string> = new Set([
  "steps",
  "expected_draft_revision_id",
]);

type JsonObject = Record<string, unknown>;

function fail(kind: SaveDraftErrorKind, message: string): { ok: false; error: SaveDraftError } {
  return { ok: false, error: { kind, message } };
}

const MESSAGES: Record<SaveDraftErrorKind, string> = {
  missing_key: "NitroSend API key is not configured",
  unauthorized: "NitroSend rejected the API key.",
  forbidden: "The NitroSend API key is not allowed to do that.",
  api_unreachable: "Could not reach NitroSend. Try again in a moment.",
  rate_limited: "NitroSend is limiting requests. Wait a minute and try again.",
  flow_not_found: "That flow was not found in NitroSend.",
  unknown: "NitroSend rejected the request.",
};

function kindForStatus(status: number): SaveDraftErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "flow_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "api_unreachable";
  return "unknown";
}

type CallResult =
  | { ok: true; data: unknown }
  | { ok: false; error: SaveDraftError };

async function call(
  apiKey: string,
  method: "GET" | "PATCH",
  path: string,
  payload?: JsonObject,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const endpoint = `${method} ${path}`;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const kind = res.status === 409 ? "unknown" : kindForStatus(res.status);
      console.error("[nitro-client] request failed", { endpoint, status: res.status });
      return {
        ok: false,
        error: {
          kind,
          message:
            res.status === 409
              ? "This email changed in NitroSend since you opened it. Reopen it and try again."
              : MESSAGES[kind],
        },
      };
    }
    try {
      return { ok: true, data: await res.json() };
    } catch {
      console.error("[nitro-client] unreadable response", { endpoint, status: res.status });
      return { ok: false, error: { kind: "unknown", message: MESSAGES.unknown } };
    }
  } catch {
    // Network failure or timeout. The error text is deliberately not logged.
    console.error("[nitro-client] request failed", { endpoint, status: 0 });
    return { ok: false, error: { kind: "api_unreachable", message: MESSAGES.api_unreachable } };
  } finally {
    clearTimeout(timer);
  }
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Flow ids are numeric. Reject anything else so it can never alter the URL path. */
function validFlowId(flowId: string): boolean {
  return /^\d{1,12}$/.test(flowId);
}

function flowPath(flowId: string): string {
  return `/flows/${flowId}`;
}

interface ParsedFlow {
  steps: unknown[];
  draftRevisionId: number | null;
  updatedAt?: string;
}

function parseFlow(data: unknown): ParsedFlow | null {
  if (!isObject(data) || !Array.isArray(data.steps)) return null;
  return {
    steps: data.steps,
    draftRevisionId: typeof data.draft_revision_id === "number" ? data.draft_revision_id : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : undefined,
  };
}

function emailStepAt(steps: unknown[], stepIndex: number): JsonObject | null {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) return null;
  const step = steps[stepIndex];
  if (!isObject(step) || step.type !== "email") return null;
  return step;
}

const NOT_AN_EMAIL: SaveDraftError = {
  kind: "unknown",
  message: "That step is not an email in NitroSend.",
};

export async function getFlowEmail(
  flowId: string,
  stepIndex: number,
): Promise<FetchDraftResult> {
  const apiKey = process.env.NITROSEND_API_KEY;
  if (!apiKey) return fail("missing_key", MESSAGES.missing_key);
  if (!validFlowId(flowId)) return fail("flow_not_found", MESSAGES.flow_not_found);

  const res = await call(apiKey, "GET", flowPath(flowId));
  if (!res.ok) return { ok: false, error: res.error };

  const flow = parseFlow(res.data);
  if (!flow) return { ok: false, error: { kind: "unknown", message: MESSAGES.unknown } };
  const step = emailStepAt(flow.steps, stepIndex);
  if (!step) return { ok: false, error: NOT_AN_EMAIL };

  return {
    ok: true,
    content: {
      flowId,
      stepIndex,
      subject: typeof step.subject === "string" ? step.subject : "",
      body: typeof step.body === "string" ? step.body : "",
      updatedAt: flow.updatedAt,
    },
  };
}

export async function saveFlowEmailDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const apiKey = process.env.NITROSEND_API_KEY;
  if (!apiKey) return fail("missing_key", MESSAGES.missing_key);
  if (!validFlowId(input.flowId)) return fail("flow_not_found", MESSAGES.flow_not_found);

  // Read the current graph: the PATCH replaces `steps` wholesale.
  const current = await call(apiKey, "GET", flowPath(input.flowId));
  if (!current.ok) return { ok: false, error: current.error };
  const flow = parseFlow(current.data);
  if (!flow) return fail("unknown", MESSAGES.unknown);
  if (!emailStepAt(flow.steps, input.stepIndex)) return { ok: false, error: NOT_AN_EMAIL };

  const steps = flow.steps.map((s, i) =>
    i === input.stepIndex && isObject(s)
      ? { ...s, subject: input.after.subject, body: input.after.body }
      : s,
  );
  const payload: JsonObject = {
    steps,
    ...(flow.draftRevisionId !== null
      ? { expected_draft_revision_id: flow.draftRevisionId }
      : {}),
  };

  // Safe Mode: only draft-authoring fields may ever be sent. No publish,
  // status or approval_state, so a save cannot go live.
  if (Object.keys(payload).some((k) => !ALLOWED_PATCH_KEYS.has(k))) {
    return fail("unknown", "Refused to send: request was not draft-only.");
  }

  const saved = await call(apiKey, "PATCH", flowPath(input.flowId), payload);
  if (!saved.ok) return { ok: false, error: saved.error };

  const updatedAt =
    isObject(saved.data) && typeof saved.data.updated_at === "string"
      ? saved.data.updated_at
      : undefined;
  return { ok: true, updatedAt };
}
