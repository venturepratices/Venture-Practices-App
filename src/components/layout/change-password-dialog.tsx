"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { changePasswordAction, type ChangePasswordState } from "@/lib/actions/change-password";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ChangePasswordState = { error: null };

// Voluntary, avatar-triggered path only — a popup, matching how most apps
// handle "change my password" from an account menu. The admin-forced path
// (mustChangePassword redirecting a just-reset user before they can do
// anything else) stays the full-page /change-password route: proxy.ts
// redirects there before the app shell (and this dialog's trigger) ever
// renders, so a modal isn't a reachable target for that case.
export function ChangePasswordDialog({ trigger }: { trigger: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(changePasswordAction, initialState);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <form
          action={(formData) => {
            const newPassword = formData.get("newPassword");
            const confirmPassword = formData.get("confirmPassword");
            if (newPassword !== confirmPassword) {
              setConfirmError("New password and confirmation don't match.");
              return;
            }
            setConfirmError(null);
            formAction(formData);
          }}
        >
          <DialogHeader>
            <DialogTitle>Change your password</DialogTitle>
            <DialogDescription>Set a new password for your account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} />
            </div>
            {confirmError ? <p className="text-sm text-destructive">{confirmError}</p> : null}
            {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isPending ? "Saving..." : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
