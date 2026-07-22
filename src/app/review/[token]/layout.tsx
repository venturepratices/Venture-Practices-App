import type { Metadata } from "next";

// Chrome-less shell for the public, tokenized review surface (Slice 4a) — no
// sidebar, no nav, no link to anything else in the app. noindex so a leaked
// link doesn't end up cached/discoverable via search engines.
export const metadata: Metadata = {
  title: "Asset review — Venture Practices",
  robots: { index: false, follow: false },
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-heading text-xs font-bold text-primary-foreground">
          VP
        </div>
        <span className="font-heading text-sm font-semibold">Venture Practices</span>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
