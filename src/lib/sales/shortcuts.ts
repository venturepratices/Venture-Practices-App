// The Sales keyboard shortcuts (spec 16.1, the same keys as Pipedrive). Pure
// and client-safe: `SalesShortcuts` turns each key press into one of these
// actions, and the page that owns the matching control (the board filter, Add
// deal, the deal panel composer) listens for it with `useSalesShortcut`.

export type ShortcutAction = "search" | "new-deal" | "new-email" | "new-task" | "help";

/** The window event a shortcut is announced on; `detail` is the ShortcutAction. */
export const SALES_SHORTCUT_EVENT = "sales:shortcut";

/**
 * Announces a shortcut on `target` (the window). True when a screen took it,
 * so the key press is used up; false when nothing on this screen does that
 * (`/` on Activities has no search box, `e` on a read-only deal has no
 * composer), and the key is then left to the browser.
 */
export function announceShortcut(target: EventTarget, action: ShortcutAction): boolean {
  return !target.dispatchEvent(new CustomEvent<ShortcutAction>(SALES_SHORTCUT_EVENT, { detail: action, cancelable: true }));
}

/**
 * A listener for announceShortcut: runs `handler` for `action` and marks the
 * key as taken, unless the handler returns false (it had nothing to do).
 */
export function shortcutListener(action: ShortcutAction, handler: () => boolean | void): (event: Event) => void {
  return (event) => {
    if (!(event instanceof CustomEvent) || event.detail !== action) return;
    if (handler() !== false) event.preventDefault();
  };
}

/**
 * The open window on top: none, the deal panel, or any other (Add deal, Value,
 * Lost, the next-step prompt, a delete confirm, the shortcuts list). Base UI
 * marks an open dialog's popup `data-open` (a closing one `data-closed`), and
 * a dialog opened later sits later in the document, also one opened from
 * inside the panel. The deal panel's popup carries DEAL_PANEL_ATTRIBUTE.
 */
export type ModalSurface = "deal-panel" | "other" | null;

export const DEAL_PANEL_ATTRIBUTE = "data-sales-deal-panel";
const OPEN_WINDOW = '[role="dialog"][data-open], [role="alertdialog"][data-open]';

export function topModalSurface(root: {
  querySelectorAll(selectors: string): ArrayLike<{ hasAttribute(name: string): boolean }>;
}): ModalSurface {
  const open = root.querySelectorAll(OPEN_WINDOW);
  if (open.length === 0) return null;
  return open[open.length - 1].hasAttribute(DEAL_PANEL_ATTRIBUTE) ? "deal-panel" : "other";
}

// Keys pressed while typing are text, never a shortcut. Open menus and lists
// use letters to jump to an item, so those count as typing too, and so does a
// select box: the app's selects are Base UI buttons with role="combobox" that
// pick an option by its first letter even while closed (and do not stop the
// key), so `n` on the Pipeline select would both switch the pipeline and open
// Add deal. The combobox role also covers the Combobox text input.
const TYPING_TARGET =
  'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"]';

/** True when a key press on `target` is typing (see TYPING_TARGET), so no shortcut may run. */
export function isTypingTarget(target: { closest(selectors: string): unknown } | null): boolean {
  return !!target?.closest(TYPING_TARGET);
}

/** The rows of the "Keyboard shortcuts" list, in the mockup's order. */
export const SHORTCUT_HELP: { keys: string; label: string }[] = [
  { keys: "/", label: "Search" },
  { keys: "n", label: "New deal" },
  { keys: "e", label: "New email (in an open deal)" },
  { keys: "t", label: "New task (in an open deal)" },
  { keys: "Esc", label: "Close panel or window" },
  { keys: "?", label: "This list" },
];

/**
 * Which action a key press means, or null. Never while the person is typing,
 * and never with Ctrl, Cmd or Alt held (those belong to the browser). While a
 * window is open only its own keys work: `e` and `t` in the deal panel, and
 * nothing under any other window (`n` would stack Add deal on it, `/` would
 * focus the board search behind it). Esc is not here: the open panel or window
 * closes itself.
 */
export function resolveShortcut(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; inEditable: boolean },
  ctx: { surface: ModalSurface },
): ShortcutAction | null {
  if (e.inEditable || e.ctrlKey || e.metaKey || e.altKey || ctx.surface === "other") return null;
  const inPanel = ctx.surface === "deal-panel";
  switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
    case "/":
      return inPanel ? null : "search";
    case "n":
      return inPanel ? null : "new-deal";
    case "?":
      return inPanel ? null : "help";
    case "e":
      return inPanel ? "new-email" : null;
    case "t":
      return inPanel ? "new-task" : null;
    default:
      return null;
  }
}
