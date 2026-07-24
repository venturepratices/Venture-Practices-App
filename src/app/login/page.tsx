"use client";

import Image from "next/image";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { loginAction, type LoginState } from "@/lib/actions/login";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1a20] via-[#10151a] to-[#12313f] px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Image src="/logo.png" alt="Venture Practices" width={216} height={140} className="mb-2 h-14 w-auto" priority />
          <CardDescription>Sign in to your agency workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="remember" name="remember" defaultChecked />
              <Label htmlFor="remember" className="font-normal text-muted-foreground">
                Remember me on this device
              </Label>
            </div>
            {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
