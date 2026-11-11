import { beforeEach, describe, expect, it, vi } from "vitest";

// Guard for audit finding M6: every place that starts Sentry (server, edge
// and browser) must use the shared scrub hooks, so no runtime sends URLs,
// headers or cookies unscrubbed. Sentry itself is replaced with a stand-in,
// so nothing is sent anywhere.

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  captureRequestError: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentryMock);

import { sentryScrubHooks } from "@/lib/sentry-scrub";

describe("Sentry setup in each runtime", () => {
  beforeEach(() => {
    sentryMock.init.mockClear();
  });

  it.each([
    ["server", () => import("../../sentry.server.config")],
    ["edge", () => import("../../sentry.edge.config")],
    ["browser", () => import("../../instrumentation-client")],
  ])("the %s setup passes the scrub hooks to Sentry", async (_runtime, load) => {
    await load();
    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeSend: sentryScrubHooks.beforeSend,
        beforeSendTransaction: sentryScrubHooks.beforeSendTransaction,
        beforeBreadcrumb: sentryScrubHooks.beforeBreadcrumb,
      }),
    );
  });
});
