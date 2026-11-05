import { beforeEach, describe, expect, it, vi } from "vitest";

import { changePanelUrl, pageRendered, refreshAfterWrite } from "@/lib/sales/panel-url";

// Opening and closing the deal panel changes only `deal` and `compose` in the
// URL. Browsing deals must not re-run the whole Deals page on the server, so
// the change goes through the browser's history API. A write's refresh that is
// still on its way would be dropped by such a change (Next lets the URL change
// win), so until a fresh page has come back the change goes through the router,
// which brings the page fresh from the server.

function fakes() {
  return {
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
  };
}

beforeEach(() => {
  // Each test starts as a page that has just come from the server.
  pageRendered();
});

describe("changePanelUrl", () => {
  it("opens a deal with a new history entry and no server round trip", () => {
    const { router, history } = fakes();
    changePanelUrl("/sales/deals?pipeline=direct-mail&deal=d1", "push", router, history);

    expect(history.pushState).toHaveBeenCalledWith(null, "", "/sales/deals?pipeline=direct-mail&deal=d1");
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("closes a deal by replacing the entry, so Back does not reopen it, again with no server round trip", () => {
    const { router, history } = fakes();
    changePanelUrl("/sales/deals?pipeline=direct-mail", "replace", router, history);

    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/sales/deals?pipeline=direct-mail");
    expect(history.pushState).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("goes through the router right after a write, so a refresh still on its way is not lost", () => {
    const { router, history } = fakes();
    refreshAfterWrite(router);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    changePanelUrl("/sales/deals?pipeline=direct-mail", "replace", router, history);
    expect(router.replace).toHaveBeenCalledWith("/sales/deals?pipeline=direct-mail", { scroll: false });
    expect(history.replaceState).not.toHaveBeenCalled();

    changePanelUrl("/sales/deals?pipeline=direct-mail&deal=d2", "push", router, history);
    expect(router.push).toHaveBeenCalledWith("/sales/deals?pipeline=direct-mail&deal=d2", { scroll: false });
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("keeps using the router until a fresh page has come back, then goes back to the history API", () => {
    const { router, history } = fakes();
    refreshAfterWrite(router);
    // The close's own navigation can be dropped too (a quick reopen), so one change is not enough.
    changePanelUrl("/sales/activities", "replace", router, history);
    changePanelUrl("/sales/activities?deal=d1", "push", router, history);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);

    pageRendered();
    changePanelUrl("/sales/activities", "replace", router, history);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });
});
