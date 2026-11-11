import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { requestMeta } from "@/lib/sales/audit";
import { adminActor } from "@/lib/sales/bot-admin";
import { failResponse, readJson } from "@/lib/sales/http";
import {
  loadLeadAssignmentSettings,
  loadLeadAssignmentView,
  updateLeadAssignment,
  updateSettingsSchema,
} from "@/lib/sales/settings";

/**
 * Admin: how new leads get an owner. `{ settings, view }`: the saved choice, and
 * what the "Who gets new leads" card shows (Sales members, who on the saved
 * choice lost access, who really gets the next lead, the first admin).
 */
export async function GET() {
  try {
    await requireAdmin();
    const [settings, view] = await Promise.all([loadLeadAssignmentSettings(), loadLeadAssignmentView()]);
    return NextResponse.json({ settings, view });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Admin: change the mode, the rotation list or the single person. Every real
 * change is logged. Answers `{ settings, view }` read after the save; a refusal
 * about the single person carries `code: "ASSIGNEE_LOST_ACCESS"`.
 */
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson(request, updateSettingsSchema);
    if (!body.ok) return failResponse(body);

    const result = await updateLeadAssignment(adminActor(admin), body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);

    const view = await loadLeadAssignmentView();
    return NextResponse.json({ settings: result.settings, view });
  } catch (error) {
    return toErrorResponse(error);
  }
}
