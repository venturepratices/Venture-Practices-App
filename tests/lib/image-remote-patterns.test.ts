import { afterEach, describe, expect, it, vi } from "vitest";
import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";

import { assetImageRemotePatterns } from "@/lib/image-remote-patterns";

// Guard for audit finding High 5 (S2/M2): the billed Next.js image resizer
// (/_next/image) must only resize our own uploaded asset pictures. It used to
// accept any Vercel Blob store in the world, any path, and any query string,
// so a stranger could vary `?x=1`, `?x=2`... and bill a new resize each time.

// Fake values in the real token shape: vercel_blob_rw_<storeId>_<secret>.
const FAKE_TOKEN = "vercel_blob_rw_AbC123xYz_fakeSecretPart_withUnderscores";
const OUR_HOST = "abc123xyz.public.blob.vercel-storage.com";
// What `upload(\`assets/${clientId}/${file.name}\`)` with addRandomSuffix returns.
const OUR_UPLOAD = `https://${OUR_HOST}/assets/cmabc123client/Pricing%202.0%20(final)-Xy7Qp2LmN4.png`;

function allows(patterns: ReturnType<typeof assetImageRemotePatterns>, src: string) {
  return patterns.some((pattern) => matchRemotePattern(pattern, new URL(src)));
}

describe("image resizer allow-list with the assets store token set", () => {
  const patterns = assetImageRemotePatterns(FAKE_TOKEN);

  it("pins the host to our own public assets store, only under /assets/, with no query string", () => {
    expect(patterns).toEqual([
      { protocol: "https", hostname: OUR_HOST, port: "", pathname: "/assets/**", search: "" },
    ]);
  });

  it("still resizes our uploaded asset pictures", () => {
    expect(allows(patterns, OUR_UPLOAD)).toBe(true);
    expect(allows(patterns, `https://${OUR_HOST}/assets/c1/photo.v2.final.jpeg`)).toBe(true);
  });

  it("refuses pictures from any other Blob store", () => {
    expect(allows(patterns, "https://someoneelse.public.blob.vercel-storage.com/assets/c1/cat.png")).toBe(false);
    expect(allows(patterns, `https://x.${OUR_HOST}/assets/c1/cat.png`)).toBe(false);
  });

  it("refuses any query string, so cache-busting `?x=1` cannot buy a new resize", () => {
    expect(allows(patterns, `${OUR_UPLOAD}?x=1`)).toBe(false);
    expect(allows(patterns, `${OUR_UPLOAD}?download=1`)).toBe(false);
  });

  it("refuses files outside /assets/ and non-https links", () => {
    expect(allows(patterns, `https://${OUR_HOST}/sales-files/deal1/contract.png`)).toBe(false);
    expect(allows(patterns, `https://${OUR_HOST}/backups/2026-11-07.json`)).toBe(false);
    expect(allows(patterns, `https://${OUR_HOST}/assetsX/c1/cat.png`)).toBe(false);
    expect(allows(patterns, OUR_UPLOAD.replace("https:", "http:"))).toBe(false);
  });

  it("never puts the secret part of the token into the config", () => {
    expect(JSON.stringify(patterns)).not.toContain("fakeSecret");
    expect(JSON.stringify(patterns)).not.toContain("vercel_blob_rw");
  });
});

describe("image resizer allow-list without a usable assets store token", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a read-write Blob token", "some-other-token"],
    ["store id with odd characters", "vercel_blob_rw_bad.host/x_secret"],
  ])("falls back to any public Blob host but keeps the path and query limits (%s)", (_label, token) => {
    const patterns = assetImageRemotePatterns(token);
    expect(patterns).toEqual([
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com", port: "", pathname: "/assets/**", search: "" },
    ]);
    expect(allows(patterns, OUR_UPLOAD)).toBe(true);
    expect(allows(patterns, "https://previewstore.public.blob.vercel-storage.com/assets/c1/cat.png")).toBe(true);
    expect(allows(patterns, `${OUR_UPLOAD}?x=1`)).toBe(false);
    expect(allows(patterns, `https://${OUR_HOST}/sales-files/deal1/contract.png`)).toBe(false);
  });
});

// The first import of next.config.ts loads Sentry's build wrapper, which can
// take a few seconds on a cold start.
describe("next.config.ts", { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadImagesConfig() {
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    return config.images;
  }

  it("uses the pinned allow-list when ASSETS_READ_WRITE_TOKEN is set at build time", async () => {
    vi.stubEnv("ASSETS_READ_WRITE_TOKEN", FAKE_TOKEN);
    const images = await loadImagesConfig();
    expect(images?.remotePatterns).toEqual([
      { protocol: "https", hostname: OUR_HOST, port: "", pathname: "/assets/**", search: "" },
    ]);
  });

  it("uses the limited wildcard allow-list when ASSETS_READ_WRITE_TOKEN is absent", async () => {
    vi.stubEnv("ASSETS_READ_WRITE_TOKEN", undefined);
    const images = await loadImagesConfig();
    expect(images?.remotePatterns).toEqual([
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com", port: "", pathname: "/assets/**", search: "" },
    ]);
  });
});
