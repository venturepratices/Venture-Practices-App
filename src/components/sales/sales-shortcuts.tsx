"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import {
  announceShortcut,
  isTypingTarget,
  resolveShortcut,
  SALES_SHORTCUT_EVENT,
  shortcutListener,
  topModalSurface,
  type ShortcutAction,
} from "@/lib/sales/shortcuts";
import { ShortcutsHelpDialog } from "@/components/sales/shortcuts-help-dialog";

// The Sales keyboard shortcuts (spec 16.1), mounted once by the Sales layout.
// One keydown listener turns a key into an action (resolveShortcut) and
// announces it on `window`; whichever screen owns the matching control (the
// board filter, Add deal, the deal panel composer) acts on it through
// useSalesShortcut. `n` away from the board opens the board with Add deal.
// Keys pressed while typing (a field, a select box, an open menu) are text,
// never a shortcut (isTypingTarget). While a window is open only its own keys
// work (`e` and `t` in the deal panel, none under any other window). A key is
// used up (preventDefault) only when a screen took it, so `/` where there is
// no search box still reaches the browser.

export function SalesShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Held keys repeat; an IME is mid-word.
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    const action = resolveShortcut(
      {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        inEditable: isTypingTarget(target),
      },
      { surface: topModalSurface(document) },
    );
    if (!action) return;
    if (action === "new-deal" && pathname !== "/sales/deals") {
      event.preventDefault();
      router.push("/sales/deals?new=1");
      return;
    }
    if (announceShortcut(window, action)) event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  useSalesShortcut("help", () => setHelpOpen(true));

  return <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />;
}

/**
 * Runs `handler` whenever the given shortcut is announced (subscribed while
 * mounted). Return false from it when there is nothing to do, so the key
 * press is left to the browser.
 */
export function useSalesShortcut(action: ShortcutAction, handler: () => boolean | void): void {
  const onShortcut = useEffectEvent(() => handler());

  useEffect(() => {
    const listener = shortcutListener(action, () => onShortcut());
    window.addEventListener(SALES_SHORTCUT_EVENT, listener);
    return () => window.removeEventListener(SALES_SHORTCUT_EVENT, listener);
  }, [action]);
}
