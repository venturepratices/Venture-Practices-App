import { notFound } from "next/navigation";
import { KeyRound, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { CredentialFormDialog } from "@/components/clients/credential-form-dialog";
import { CredentialRow } from "@/components/clients/credential-row";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";

export default async function ClientCredentialsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  // Client-access is enforced by the layout; this adds the credentials capability.
  if (!(await canUseCapability("canViewCredentials"))) notFound();
  const canManage = await canUseCapability("canManageCredentials");
  const canReveal = await canUseCapability("canRevealCredentials");

  const credentials = await prisma.clientCredential.findMany({
    where: { clientId },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, label: true, url: true, username: true },
  });

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Credentials
          <InfoTip>
            Third-party access for this client (e.g. WordPress admin). Passwords are encrypted and stay hidden until
            you re-enter your own account password to reveal one — every reveal is recorded on the Activity log.
          </InfoTip>
        </h2>
        {canManage ? (
          <CredentialFormDialog
            mode="create"
            clientId={clientId}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                Add credential
              </Button>
            }
          />
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        {credentials.length === 0 ? (
          <div className="rounded-lg border">
            <EmptyState icon={KeyRound} title="No credentials stored yet." className="py-6" />
          </div>
        ) : (
          credentials.map((credential) => (
            <CredentialRow key={credential.id} credential={credential} canManage={canManage} canReveal={canReveal} />
          ))
        )}
      </div>
    </div>
  );
}
