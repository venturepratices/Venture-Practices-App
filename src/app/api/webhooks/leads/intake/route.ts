import { NextResponse } from "next/server";

import { requestMeta } from "@/lib/sales/audit";
import { alertAdminsOfIntakeLimit, createLeadFromIntake, intakeLimitHit } from "@/lib/sales/lead-intake";
import { intakeSecret, parseLeadIntake } from "@/lib/sales/lead-intake-payload";
import { safeEqualSecret } from "@/lib/secret-compare";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Room for a request that waits its turn behind another for the same contact; the lead transaction's own 20 s limit sits inside this.
export const maxDuration = 30;

const BODY_MAX_BYTES = 32 * 1024;

const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });

/**
 * HighLevel's new-lead hand-off (spec 9.1): a workflow posts each opt-in here
 * and the lead lands in the Marketing Inbox. Nothing else happens: no
 * message goes anywhere (Sales code never messages a shared channel), so the
 * team's text alert stays a HighLevel workflow of its own.
 *
 * The caller proves itself with the shared secret in WEBHOOK_INBOUND_SECRET,
 * sent as the `x-shared-secret` header (or, only for a workflow that cannot set
 * a header, as `customData.secret` in the body). WEBHOOK_INBOUND_SECRET_NEXT is
 * a second secret that is also accepted, so the secret can be changed without a
 * gap. With neither set the route is off (503). A wrong header secret is
 * refused before the body is read. Nothing in the request is stored or logged
 * beyond the lead's own fields.
 *
 * Answers: 401 wrong or missing secret; 413 and 400 for a body that is too
 * large or not JSON; 429 when the link has made too many leads too fast (and
 * the admins are told); 200 `{ lead_id, created }` for a lead made or found,
 * `{ ignored }` for a text reply, and `{ error }` for a payload that can never
 * work (the spec keeps those at 200 so HighLevel does not retry them).
 * Anything unexpected throws, so the platform answers 500, Sentry records it,
 * and HighLevel retries; a retry is safe because a repeat of a lead makes
 * nothing new.
 */
export async function POST(request: Request) {
  // Trimmed, because a header arrives trimmed: a secret pasted into Vercel with a trailing space or newline must still match.
  const configured = [process.env.WEBHOOK_INBOUND_SECRET, process.env.WEBHOOK_INBOUND_SECRET_NEXT]
    .map((secret) => secret?.trim() ?? "")
    .filter((secret) => secret !== "");
  if (configured.length === 0) return reply({ error: "The lead link is not set up." }, 503);
  const isSender = (presented: string | null) => configured.some((secret) => safeEqualSecret(presented, secret));

  const headerSecret = request.headers.get("x-shared-secret");
  if (headerSecret && !isSender(headerSecret)) return reply({ error: "Unauthorized" }, 401);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return reply({ error: "The request is too large." }, 413);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > BODY_MAX_BYTES) return reply({ error: "The request is too large." }, 413);

  // Not read as an error yet: a caller without the secret must get the same 401 whatever it sent.
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!headerSecret && !isSender(intakeSecret(body))) return reply({ error: "Unauthorized" }, 401);
  if (body === undefined) return reply({ error: "The request body is not valid JSON." }, 400);

  const now = new Date();
  const limit = await intakeLimitHit(now);
  if (limit) {
    await alertAdminsOfIntakeLimit(limit, now);
    return reply({ error: "Too many leads too fast. Try again in a few minutes." }, 429);
  }

  const parsed = parseLeadIntake(body);
  if (parsed.kind === "ignored") return reply({ ignored: true, reason: parsed.reason });
  if (parsed.kind === "invalid") {
    console.warn("[lead-intake] refused a payload:", parsed.error);
    return reply({ error: parsed.error });
  }

  const result = await createLeadFromIntake(parsed.intake, requestMeta(request), now);
  return reply({ lead_id: result.leadId, created: result.created });
}
