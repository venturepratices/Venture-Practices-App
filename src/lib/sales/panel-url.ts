// Opening and closing the deal panel changes only `deal` and `compose` in the
// URL, and the panel loads its own data. A router.push or replace would make
// Next re-run the whole page on the server (the board's pipelines, stages,
// members, totals and every column) for nothing, so the change goes through
// the browser's history API instead, which Next syncs into useSearchParams
// without asking the server (Next docs, Linking and Navigating, "Native
// History API"). Back still closes the panel.
//
// One catch: Next drops a router.refresh() still on its way when the URL
// changes through the history API (the URL change wins, and the refresh's
// answer is thrown away). So a Sales write asks for its refresh through
// refreshAfterWrite, and until the page shows a render from the server again
// (pageRendered, called by the page when its server time changes) the panel
// URL goes through the router, which brings the page fresh with it. Browsing
// deals without changing anything costs no server work at all.
//
// Client only: the state lives in the browser tab's copy of this module.

type PanelRouter = {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  refresh(): void;
};

type PanelHistory = Pick<History, "pushState" | "replaceState">;

/** A write asked for a refresh, and no fresh render from the server has shown since. */
let refreshOwed = false;

/** After a Sales write: refresh the page behind, and remember that until it has come back. */
export function refreshAfterWrite(router: Pick<PanelRouter, "refresh">): void {
  refreshOwed = true;
  router.refresh();
}

/** The page is showing a render that came from the server after the last write. */
export function pageRendered(): void {
  refreshOwed = false;
}

/**
 * Puts `href` in the address bar: a new entry to open a deal ("push"), the same
 * entry to close it ("replace", so Back does not reopen it). No server round
 * trip, unless a write's refresh may still be on its way (see above).
 */
export function changePanelUrl(
  href: string,
  mode: "push" | "replace",
  router: PanelRouter,
  history: PanelHistory = window.history,
): void {
  if (refreshOwed) {
    if (mode === "push") router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
    return;
  }
  if (mode === "push") history.pushState(null, "", href);
  else history.replaceState(null, "", href);
}
