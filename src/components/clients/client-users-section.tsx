import { Pencil, Plus, UserCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClientUserFormDialog } from "@/components/clients/client-user-form-dialog";
import { DeleteClientUserButton } from "@/components/clients/delete-client-user-button";

export type ClientUserRow = { id: string; name: string; email: string };

/** Client Info tab section for managing this client's own login accounts (Slice 4b). */
export function ClientUsersSection({
  clientId,
  clientUsers,
  canManage,
}: {
  clientId: string;
  clientUsers: ClientUserRow[];
  canManage: boolean;
}) {
  if (!canManage && clientUsers.length === 0) return null;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <UserCircle className="size-4 text-muted-foreground" />
            Client logins
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Let this client log in directly to review their assets — no share link needed.
          </p>
        </div>
        {canManage ? (
          <ClientUserFormDialog
            mode="create"
            clientId={clientId}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="mr-1.5 size-3.5" />
                New login
              </Button>
            }
          />
        ) : null}
      </div>

      {clientUsers.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {clientUsers.map((cu) => (
            <li key={cu.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{cu.name}</p>
                <p className="truncate text-xs text-muted-foreground">{cu.email}</p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  <ClientUserFormDialog
                    mode="edit"
                    clientUserId={cu.id}
                    defaultName={cu.name}
                    defaultEmail={cu.email}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Edit ${cu.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                    }
                  />
                  <DeleteClientUserButton clientUserId={cu.id} name={cu.name} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No client logins yet.</p>
      )}
    </div>
  );
}
