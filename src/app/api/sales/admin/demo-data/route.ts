import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { verifyAdminPassword } from "@/lib/sales/bot-admin-checks";
import { removeDemoData } from "@/lib/sales/demo-clean";
import { seedDemoData } from "@/lib/sales/demo-seed";
import { assertSameOrigin, failResponse } from "@/lib/sales/http";

export const maxDuration = 60;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

type Body = { password?: string; includeAdded?: boolean };

async function readBody(request: Request): Promise<Body> {
  try {
    const raw = (await request.json()) as unknown;
    if (raw && typeof raw === "object") return raw as Body;
  } catch {
    // fall through
  }
  return {};
}

/** Admin: add TEST * demo rows to Sales so Ben can see every feature. Idempotent. */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const body = await readBody(request);
    const pw = await verifyAdminPassword(admin.userId, body.password);
    if (!pw.ok) return bad(pw.error, pw.status);

    const summary = await seedDemoData();
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Admin: remove the TEST * demo rows. Default leaves non-TEST additions alone. */
export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const body = await readBody(request);
    const pw = await verifyAdminPassword(admin.userId, body.password);
    if (!pw.ok) return bad(pw.error, pw.status);

    const summary = await removeDemoData({ includeAdded: Boolean(body.includeAdded) });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return toErrorResponse(error);
  }
}
