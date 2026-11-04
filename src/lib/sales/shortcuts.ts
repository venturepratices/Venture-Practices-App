// The Sales keyboard shortcuts (spec 16.1, the same keys as Pipedrive). Pure
// and client-safe: `SalesShortcuts` turns each key press into one of these
// actions, and the page that owns the matching control (the board filter, Add
// deal, the deal panel composer) listens for it with `useSalesShortcut`.

export type ShortcutAction = "search" | "new-deal" | "new-email" | "new-task" | "help";

/** The window event a shortcut is announced on; `detail` is the ShortcutAction. */
export const SALES_SHORTCUT_EVENT = "sales:shortcut";

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
 * and never with Ctrl, Cmd or Alt held (those belong to the browser). `e` and
 * `t` work only with a deal open. Esc is not here: the open panel or window
 * closes itself.
 */
export function resolveShortcut(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; inEditable: boolean },
  ctx: { dealOpen: boolean },
): ShortcutAction | null {
  if (e.inEditable || e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
    case "/":
      return "search";
    case "n":
      return "new-deal";
    case "?":
      return "help";
    case "e":
      return ctx.dealOpen ? "new-email" : null;
    case "t":
      return ctx.dealOpen ? "new-task" : null;
    default:
      return null;
  }
}
