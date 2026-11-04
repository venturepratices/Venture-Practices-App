"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { resolveShortcut, SALES_SHORTCUT_EVENT, type ShortcutAction } from "@/lib/sales/shortcuts";
import { ShortcutsHelpDialog } from "@/components/sales/shortcuts-help-dialog";

// The Sales keyboard shortcuts (spec 16.1), mounted once by the Sales layout.
// One keydown listener turns a key into an action (resolveShortcut) and
// announces it on `window`; whichever screen owns the matching control (the
// board filter, Add deal, the deal panel composer) acts on it through
// useSalesShortcut. `n` away from the board opens the board with Add deal.

// Keys pressed while typing are text, never a shortcut. Open menus and lists
// use letters to jump to an item, so those count as typing too.
const TYPING_TARGET = 'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]';

export function SalesShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [helpOpen, setHelpOpen] = useState(false);
  const dealOpen = searchParams.has("deal");

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Held keys repeat; an IME is mid-word; or the list is open (keys there
    // must not start something behind it).
    if (event.defaultPrevented || event.repeat || event.isComposing || helpOpen) return;
    const target = event.target instanceof Element ? event.target : null;
    const action = resolveShortcut(
      {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        inEditable: !!target?.closest(TYPING_TARGET),
      },
      { dealOpen },
    );
    if (!action) return;
    event.preventDefault();
    if (action === "new-deal" && pathname !== "/sales/deals") {
      router.push("/sales/deals?new=1");
      return;
    }
    window.dispatchEvent(new CustomEvent<ShortcutAction>(SALES_SHORTCUT_EVENT, { detail: action }));
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  useSalesShortcut("help", () => setHelpOpen(true));

  return <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />;
}

/** Runs `handler` whenever the given shortcut is announced (subscribed while mounted). */
export function useSalesShortcut(action: ShortcutAction, handler: () => void): void {
  const onShortcut = useEffectEvent(() => handler());

  useEffect(() => {
    const listener = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === action) onShortcut();
    };
    window.addEventListener(SALES_SHORTCUT_EVENT, listener);
    return () => window.removeEventListener(SALES_SHORTCUT_EVENT, listener);
  }, [action]);
}
