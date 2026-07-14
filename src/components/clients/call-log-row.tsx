import { PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { formatDateTime } from "@/lib/utils";

export type CallRow = {
  id: string;
  contactName: string | null;
  direction: string;
  subject: string | null;
  body: string;
  ghlTimestamp: string;
};

// One call-tracking record from HighLevel.
export function CallLogRow({ call }: { call: CallRow }) {
  const inbound = call.direction === "inbound";
  const Icon = inbound ? PhoneIncoming : PhoneOutgoing;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${inbound ? "text-emerald-600" : "text-sky-600"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{call.contactName ?? "Unknown contact"}</span>
          <span className="text-xs text-muted-foreground">{inbound ? "Inbound" : "Outbound"} call</span>
        </div>
        {call.body ? <p className="truncate text-sm text-muted-foreground">{call.body}</p> : null}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(call.ghlTimestamp)}</span>
    </li>
  );
}
