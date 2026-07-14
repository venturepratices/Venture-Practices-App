import { Plus } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { CredentialFormDialog } from "@/components/clients/credential-form-dialog";
import { CredentialRow } from "@/components/clients/credential-row";
import { InfoTip } from "@/components/info-tip";

export default async function ClientCredentialsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
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
      </div>

      <div className="mt-4 space-y-2">
        {credentials.length === 0 ? (
          <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">No credentials stored yet.</p>
        ) : (
          credentials.map((credential) => <CredentialRow key={credential.id} credential={credential} />)
        )}
      </div>
    </div>
  );
}
