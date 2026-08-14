import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { postSlackChannel } from "@/lib/slack";

/**
 * Posts one sample message to the general internal Slack channel — confirms
 * the SLACK_INTERNAL_CHANNEL_ID wiring works without waiting for a real
 * client-less event (workflow/task/asset with no client) to trigger one.
 */
export async function POST() {
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const channelId = process.env.SLACK_INTERNAL_CHANNEL_ID;
  if (!channelId) {
    return NextResponse.json({ error: "SLACK_INTERNAL_CHANNEL_ID isn't set." }, { status: 422 });
  }

  await postSlackChannel(channelId, "*📣 Test message*\nIf you're reading this here, the internal channel is wired up correctly.");

  return NextResponse.json({ ok: true });
}
