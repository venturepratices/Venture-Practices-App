import { afterEach, describe, expect, it, vi } from "vitest";

// Sales is secret from one team member. Sentry's Next.js SDK scans src/app at
// build time and injects a list of every page route into the browser bundle
// (through instrumentation-client, which lands in a bootstrap script Next puts
// on every page, /login included). Unfiltered, that list names /sales,
// /sales/deals and /sales/activities. next.config.ts must keep the Sales routes
// out of it. This loads the real config the way `next build` does (Turbopack)
// and reads the list Sentry would inject. The build-level proof is
// `npm run check:sales-secrecy` after a build.

const SALES_ROUTE = /^\/sales(\/|$)/;

/** Depth-first search of the final config for the value Sentry injects under `key`. */
function findInjectedValue(node: unknown, key: string, seen = new Set<unknown>()): unknown {
  if (!node || typeof node !== "object" || seen.has(node)) return undefined;
  seen.add(node);
  if (Object.prototype.hasOwnProperty.call(node, key)) return (node as Record<string, unknown>)[key];
  for (const child of Object.values(node)) {
    const found = findInjectedValue(child, key, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

type RouteManifest = { staticRoutes: { path: string }[]; dynamicRoutes: { path: string }[]; isrRoutes: string[] };

// Loading the real @sentry/nextjs (its server SDK comes with it) took about 2s
// on its own and 11s while the whole suite ran in parallel, so the 5s default
// is too tight. The config work itself takes well under a second.
const LOADS_REAL_SENTRY_SDK = 60_000;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("next.config.ts: Sentry's route list", () => {
  it("still lists the app's routes but names no Sales route", async () => {
    vi.stubEnv("TURBOPACK", "1");
    vi.resetModules();
    const config = (await import("../../../next.config")).default;

    const injected = findInjectedValue(config, "_sentryRouteManifest");
    expect(typeof injected).toBe("string");
    const manifest = JSON.parse(injected as string) as RouteManifest;
    const routes = [
      ...manifest.staticRoutes.map((route) => route.path),
      ...manifest.dynamicRoutes.map((route) => route.path),
      ...manifest.isrRoutes,
    ];

    // The list is the real one (so the check below is not passing on an empty list).
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/team");
    expect(routes.filter((route) => SALES_ROUTE.test(route))).toEqual([]);
    expect(injected).not.toMatch(/sales|\/deals/i);
  }, LOADS_REAL_SENTRY_SDK);
});
