"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Shown in place of a Sales page that failed to load (the sidebar and top bar
// stay). Reports to Sentry like global-error.tsx does, and offers a retry that
// re-fetches the page from the server. The error ID matches the server log.
export default function SalesError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This page could not load. Try again, and if it keeps happening, send the error ID below to DJ.
      </p>
      <Button className="pointer-coarse:min-h-10" onClick={() => unstable_retry()}>
        Try again
      </Button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Error ID: <code className="font-mono break-all select-all">{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}
