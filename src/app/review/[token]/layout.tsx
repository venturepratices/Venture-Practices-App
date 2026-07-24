import Image from "next/image";
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
      <header className="flex items-center border-b px-6 py-3">
        <Image src="/logo.png" alt="Venture Practices" width={216} height={140} className="h-9 w-auto" priority />
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
