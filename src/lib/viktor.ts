/**
 * Viktor AI client — the outbound side. The app's own doorway that Viktor
 * READS is at src/app/api/agent/v1/**; this file is the opposite direction,
 * the in-app "Ask Viktor" button calling Viktor's own API to get an answer.
 *
 * Deliberately a stub for now: askViktor() returns a friendly not-connected
 * message when VIKTOR_API_KEY is unset, so the UI ships and can be exercised
 * end-to-end before the user has actually generated a Viktor API key. When
 * the key is added to Vercel, wire the real POST here — Viktor's public
 * REST API (viktor.com/docs) exposes a create-thread / run-task / get-result
 * shape with bearer auth. No SDK dependency — plain fetch, mirroring how
 * src/lib/slack.ts hits Slack's Web API.
 */

const VIKTOR_ENDPOINT = "https://api.viktor.com/v1"; // adjust to real base URL when wiring

export function isViktorConfigured(): boolean {
  return Boolean(process.env.VIKTOR_API_KEY);
}

export type AskViktorParams = {
  question: string;
  /** File names + sizes only for now — real attachment upload is a future step. */
  attachments?: { name: string; sizeBytes: number }[];
  /** Optional thread id for a continued conversation, once threading is wired. */
  threadId?: string;
};

export type AskViktorResult =
  | { ok: true; answer: string; threadId?: string }
  | { ok: false; reason: string };

/**
 * Sends a question to Viktor. Never throws — a delivery failure returns
 * { ok: false }, so the UI can render an inline error without the whole
 * request failing.
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

  // TODO(viktor-wire): swap this placeholder for the real Viktor REST call
  // once the key is added and we confirm the exact endpoint shape from
  // viktor.com/docs (create thread → run task → poll or stream result).
  // Keeping this a placeholder deliberately — the UI ships and works
  // end-to-end (empty-state through inline error), only this function's
  // body needs replacing when Viktor is wired.
  try {
    const res = await fetch(`${VIKTOR_ENDPOINT}/threads/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: params.question,
        threadId: params.threadId,
        attachments: params.attachments,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, reason: body?.message ?? `Viktor returned ${res.status}` };
    }
    const data = (await res.json()) as { answer?: string; threadId?: string };
    return { ok: true, answer: data.answer ?? "", threadId: data.threadId };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Unknown error" };
  }
}
