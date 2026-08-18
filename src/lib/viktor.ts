/**
 * Viktor AI client — the outbound side. The app's own doorway that Viktor
 * READS is at src/app/api/agent/v1/**; this file is the opposite direction,
 * the in-app "Ask Viktor" button calling Viktor's own Public API
 * (viktor.com/docs/public-api) to get an answer. No SDK dependency — plain
 * fetch, mirroring how src/lib/slack.ts hits Slack's Web API.
 *
 * The Public API is asynchronous, not a single request/response: create a
 * thread (or post a follow-up message on an existing one) → poll the run's
 * status → fetch the result once it's available. There's no synchronous
 * "just answer me" endpoint. `askViktor()` hides that polling loop behind
 * one awaitable call, bounded by POLL_BUDGET_MS so it can't hang the
 * calling API route past Vercel's function timeout (the route sets
 * `maxDuration` accordingly).
 */

const VIKTOR_API_BASE = "https://api.viktor.com/api/public/v1";
const POLL_INTERVAL_MS = 2000;
const POLL_BUDGET_MS = 45_000;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "timed_out", "requires_action"];

export function isViktorConfigured(): boolean {
  return Boolean(process.env.VIKTOR_API_KEY);
}

export type AskViktorParams = {
  question: string;
  /**
   * File names + sizes only, stored on our side for display — Viktor's
   * Public API has no documented attachment-upload shape yet, so these are
   * NOT forwarded to Viktor. Revisit once that's confirmed.
   */
  attachments?: { name: string; sizeBytes: number }[];
  /** Viktor's own thread id, once one exists, so a follow-up keeps context. */
  threadId?: string;
};

export type AskViktorResult =
  | { ok: true; answer: string; threadId?: string }
  | { ok: false; reason: string };

function authHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

/**
 * Shape confirmed against Viktor's own published OpenAPI spec
 * (PublicApiRunResultResponse): { run_id, status, markdown, json, artifacts,
 * metadata }. Prefer markdown (the normal chat-style answer); fall back to
 * json (stringified, since it can be any JSON value) for runs configured
 * with a structured response_format.
 */
function extractAnswerText(result: { markdown?: string | null; json?: unknown }): string | null {
  if (typeof result.markdown === "string" && result.markdown.trim()) return result.markdown;
  if (result.json !== undefined && result.json !== null) {
    return typeof result.json === "string" ? result.json : JSON.stringify(result.json, null, 2);
  }
  return null;
}

/**
 * Sends a question to Viktor and waits for the answer. Never throws — a
 * delivery failure, a timed-out run, or an unparseable result all return
 * { ok: false, reason }, so the UI can render an inline error/status
 * message without the whole request failing.
 */
export async function askViktor(params: AskViktorParams): Promise<AskViktorResult> {
  const apiKey = process.env.VIKTOR_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason:
        "Viktor isn't connected yet. An admin needs to paste the Viktor API key into the app's settings (Settings → AI Assistant).",
    };
  }

  try {
    const kickoffRes = params.threadId
      ? await fetch(`${VIKTOR_API_BASE}/threads/${params.threadId}/messages`, {
          method: "POST",
          headers: authHeaders(apiKey),
          body: JSON.stringify({ message: params.question }),
        })
      : await fetch(`${VIKTOR_API_BASE}/threads`, {
          method: "POST",
          headers: authHeaders(apiKey),
          body: JSON.stringify({ message: params.question, speed: "smarter" }),
        });

    if (!kickoffRes.ok) {
      const body = (await kickoffRes.json().catch(() => null)) as { message?: string; error?: string } | null;
      return { ok: false, reason: body?.message ?? body?.error ?? `Viktor returned ${kickoffRes.status}` };
    }

    const kickoff = (await kickoffRes.json()) as {
      thread?: { id?: string };
      run?: { id?: string };
      run_id?: string;
      id?: string;
    };
    const threadId = kickoff.thread?.id ?? params.threadId;
    const runId = kickoff.run?.id ?? kickoff.run_id ?? kickoff.id;
    if (!runId) {
      return { ok: false, reason: "Viktor accepted the message but didn't return a run id to track." };
    }

    const deadline = Date.now() + POLL_BUDGET_MS;
    let status: string | undefined;
    let resultAvailable = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const statusRes = await fetch(`${VIKTOR_API_BASE}/runs/${runId}`, { headers: authHeaders(apiKey) });
      if (!statusRes.ok) continue;
      const statusBody = (await statusRes.json()) as { status?: string; result?: { available?: boolean } };
      status = statusBody.status;
      resultAvailable = statusBody.result?.available === true;
      if (status && TERMINAL_STATUSES.includes(status)) break;
    }

    if (status === "failed" || status === "cancelled" || status === "timed_out") {
      return { ok: false, reason: `Viktor's run ended as "${status}" before finishing.` };
    }
    if (status === "requires_action") {
      return {
        ok: false,
        reason: "Viktor needs an action approved in the Viktor dashboard before it can finish this answer.",
      };
    }
    if (status !== "completed" && !resultAvailable) {
      return { ok: false, reason: "Viktor is still working on this one — try asking again in a moment." };
    }

    const resultRes = await fetch(`${VIKTOR_API_BASE}/runs/${runId}/result`, { headers: authHeaders(apiKey) });
    if (!resultRes.ok) {
      return { ok: false, reason: `Viktor finished but the result couldn't be fetched (${resultRes.status}).` };
    }
    const resultBody = (await resultRes.json()) as { markdown?: string | null; json?: unknown };
    const answer = extractAnswerText(resultBody);
    if (!answer) {
      return { ok: false, reason: "Viktor finished but returned no readable answer." };
    }

    return { ok: true, answer, threadId };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Unknown error" };
  }
}
