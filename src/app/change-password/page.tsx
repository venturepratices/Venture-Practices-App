"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { changePasswordAction, type ChangePasswordState } from "@/lib/actions/change-password";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ChangePasswordState = { error: null };

export default function ChangePasswordPage() {
  const [state, formAction, isPending] = useActionState(changePasswordAction, initialState);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1a20] via-[#10151a] to-[#12313f] px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Image src="/logo.png" alt="Venture Practices" width={216} height={140} className="mb-2 h-10 w-auto" priority />
          <CardTitle className="text-xl">Change your password</CardTitle>
          <CardDescription>Set a new password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
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
            className="space-y-4"
          >
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
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isPending ? "Saving..." : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
