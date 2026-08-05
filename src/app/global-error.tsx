"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Catches errors the normal error.tsx boundaries can't — anything thrown
// while rendering the root layout itself. Reports to Sentry (a no-op if
// NEXT_PUBLIC_SENTRY_DSN isn't set) and shows a bare fallback, since the
// root layout (fonts, <html>/<body>) may itself be broken at this point.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Something went wrong.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Please refresh the page.</p>
        </div>
      </body>
    </html>
  );
}
