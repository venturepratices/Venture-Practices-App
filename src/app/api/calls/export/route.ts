import { requireUser, toErrorResponse } from "@/lib/permissions";
import { loadCallsForExport } from "@/lib/calls/data";
import { parseCallsQuery, rangeWindow } from "@/lib/calls/query";

/**
 * CSV export of the Calls view. Shares the filter parser with the page, so
 * whatever's on screen is whatever downloads. Capped at 5000 rows per export
 * (see loadCallsForExport). Signed-in users only; admins see every client,
 * non-admins see only the clients their ClientAccess rows allow.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireUser();
    const url = new URL(request.url);
    const raw: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      raw[k] = v;
    });
    const query = parseCallsQuery(raw);
    const now = new Date();
    const { start, end } = rangeWindow(query.range, now);

    const rows = await loadCallsForExport({ actor, query, start, end });

    const csv = rowsToCsv(rows);
    const filename = `calls-${start.toISOString().slice(0, 10)}-to-${end.toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const COLUMNS = [
  "Time",
  "Caller name",
  "Caller phone",
  "Client",
  "Tracking label",
  "Tracking number",
  "Direction",
  "Status",
  "Caller type",
] as const;

function rowsToCsv(rows: Awaited<ReturnType<typeof loadCallsForExport>>): string {
  const lines: string[] = [COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.lastCallAt ? r.lastCallAt.toISOString() : "",
        r.contactName ?? "",
        r.callerPhone ?? "",
        r.clientName,
        r.trackingLabel ?? "",
        r.trackingNumber ?? "",
        r.direction ?? "",
        r.status ?? "",
        r.callerType,
      ].map(csvEscape).join(","),
    );
  }
  return lines.join("\n");
}

function csvEscape(v: string): string {
  if (v === "") return "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
