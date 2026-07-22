import { redirect } from "next/navigation";

import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AssetCard } from "@/components/assets/asset-card";

/** "My Assets" — every non-draft asset belonging to this client user's own client. */
export default async function PortalHomePage() {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const assets = await prisma.asset.findMany({
    where: { clientId: clientUser.clientId, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        select: { id: true, versionNumber: true, kind: true, blobUrl: true, externalUrl: true },
      },
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">My assets</h1>
      <p className="mt-1 text-sm text-muted-foreground">Everything ready for your review.</p>

      {assets.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">Nothing to review yet — check back soon.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <AssetCard key={asset.id} clientId={clientUser.clientId} asset={asset} href={`/portal/assets/${asset.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
