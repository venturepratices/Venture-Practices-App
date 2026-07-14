import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { syncClientConversations } from "@/lib/highlevel";

export const runtime = "nodejs";

// Manual "Sync now" — forces a fresh pull (bypasses the sync-on-view throttle).
export async function POST(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  try {
    const result = await syncClientConversations(clientId, { force: true });
    if (result.status === "skipped" && result.reason === "not_connected") {
      return NextResponse.json({ error: "This client isn't connected to HighLevel." }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("HighLevel sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed — HighLevel rejected the request. The token may have been revoked." },
      { status: 502 }
    );
  }
}
