import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { assertSameOrigin, fail, failResponse } from "@/lib/sales/http";
import { checkLatestRun, pipedriveClientFromEnv, TOKEN_NOT_SET } from "@/lib/sales/pipedrive/import-check";

// The check walks every Pipedrive list, one after another.
export const maxDuration = 60;

/** The check's own time limit, inside maxDuration with room to answer. */
const CHECK_MS = 50_000;

/**
 * Admin: "Check the copy". Counts Pipedrive against the app for the latest
 * real copy and picks 5 deals to compare by eye; saves the result on that run
 * and answers `{ report, at }`. Refused for a practice run or an unfinished
 * one ("Run the real copy first."), and within a minute of the last check.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);

    // Past this the client stops retrying and pauses (a 429), which the check answers with "try again in a minute".
    const client = pipedriveClientFromEnv(process.env, { deadline: new Date(Date.now() + CHECK_MS) });
    if (!client) return failResponse(fail(400, TOKEN_NOT_SET));

    const result = await checkLatestRun({ client, now: new Date(), random: Math.random, env: process.env });
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ report: result.report, at: result.at });
  } catch (error) {
    return toErrorResponse(error);
  }
}
