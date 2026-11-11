import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { searchContacts } from "@/lib/sales/contacts";
import { fail, failResponse } from "@/lib/sales/http";

const KINDS = ["organization", "person"] as const;

/** The Add deal dialog's pickers: `?kind=organization|person&q=...` gives `{ results }`. */
export async function GET(request: Request) {
  try {
    const actor = await requireSalesUser();
    const params = new URL(request.url).searchParams;

    const kind = KINDS.find((k) => k === params.get("kind"));
    if (!kind) return failResponse(fail(400, "Invalid input."));

    const results = await searchContacts(actor, kind, params.get("q") ?? "");
    return NextResponse.json({ results });
  } catch (error) {
    return toErrorResponse(error);
  }
}
