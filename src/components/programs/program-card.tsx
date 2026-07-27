import Link from "next/link";

import { StatusPillBase } from "@/components/ui/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PROGRAM_PRODUCT_LABELS, PROGRAM_STATUS_LABELS, PROGRAM_STATUS_TONES } from "@/lib/validations/program";

type ProgramCardData = {
  id: string;
  name: string;
  product: string;
  status: string;
  lengthMonths: number;
  accountManager: { name: string } | null;
  campaigns: { id: string }[];
};

export function ProgramCard({ clientId, program }: { clientId: string; program: ProgramCardData }) {
  return (
    <Link href={`/clients/${clientId}/programs/${program.id}`} className="block">
      <Card className="transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">{program.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <StatusPillBase tone={PROGRAM_STATUS_TONES[program.status]} label={PROGRAM_STATUS_LABELS[program.status] ?? program.status} />
          <span className="text-sm text-muted-foreground">{PROGRAM_PRODUCT_LABELS[program.product] ?? program.product}</span>
        </CardContent>
        <CardContent className="flex items-center justify-between pt-0 text-sm text-muted-foreground">
          <span>
            {program.campaigns.length} campaign{program.campaigns.length === 1 ? "" : "s"} · {program.lengthMonths} mo
          </span>
          <span>{program.accountManager?.name ?? "Unassigned"}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
