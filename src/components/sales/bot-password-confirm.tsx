"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { TOUCH, WARN } from "@/components/sales/bot-card";

// The small inline box that asks the admin to type their password again
// before a key is turned on or rotated. The password is sent once and never kept.

export function PasswordConfirm({
  label,
  warning,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string;
  warning?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const id = useId();
  return (
    <form
      className="flex flex-col gap-2 rounded-[10px] border p-3"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        if (!password) return;
        onConfirm(password);
        // Never kept on screen after a try; a wrong one is typed again.
        setPassword("");
      }}
    >
      {warning ? <p className={`${WARN} m-0`}>{warning}</p> : null}
      <label htmlFor={id} className="text-[13px] font-semibold">
        Your password
      </label>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="min-h-10 w-full rounded-lg border bg-background px-3 text-[14px] focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11"
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel} className={TOUCH}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !password} className={TOUCH}>
          {busy ? "Working..." : label}
        </Button>
      </div>
    </form>
  );
}
