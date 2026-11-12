import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { loadImportStatus } from "@/lib/sales/pipedrive/status";

/**
 * Admin: where the copy stands (the latest run, whether the token is set and
 * its last 4 characters, the lock, the saved check, the owner list and the
 * Sales members for the picker). Reads the database only; never calls Pipedrive.
 */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await loadImportStatus());
  } catch (error) {
    return toErrorResponse(error);
  }
}
