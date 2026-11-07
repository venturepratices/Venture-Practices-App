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

const PINNED = [{ protocol: "https", hostname: OUR_HOST, port: "", pathname: "/assets/**", search: "" }];
const ANY_BLOB_STORE = [
  { protocol: "https", hostname: "**.public.blob.vercel-storage.com", port: "", pathname: "/assets/**", search: "" },
];

function allows(patterns: ReturnType<typeof assetImageRemotePatterns>, src: string) {
  return patterns.some((pattern) => matchRemotePattern(pattern, new URL(src)));
}

describe("image resizer allow-list with the assets store token set", () => {
  const patterns = assetImageRemotePatterns({ ASSETS_READ_WRITE_TOKEN: FAKE_TOKEN });

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

  // KNOWN LIMIT, pinned on purpose. Next's matcher ignores the #fragment, a
  // user@ part and percent-encoding, while the resizer's cache key hashes the
  // whole address (node_modules/next/dist/server/image-optimizer.js,
  // getCacheKey). So `cat.png#x1`, `#x2`... each buy a fresh resize of the same
  // picture, and remotePatterns has no setting that stops it. The Vercel
  // Firewall rule on /_next/image covers it (see the comment in
  // src/lib/image-remote-patterns.ts). If this test starts failing, Next has
  // begun refusing these itself: update that comment and the Firewall notes.
  it("cannot refuse #fragment, user@ or percent-encoded copies of an allowed picture (the Firewall must)", () => {
    const cat = `https://${OUR_HOST}/assets/c1/cat.png`;
    for (const variant of [
      `${cat}#x1`,
      `${cat}#x2`,
      cat.replace("https://", "https://u1@"),
      cat.replace("cat.png", "c%61t.png"),
    ]) {
      expect(allows(patterns, variant)).toBe(true);
    }
  });
});

describe("image resizer allow-list off Vercel without a usable assets store token", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a read-write Blob token", "some-other-token"],
    ["store id with odd characters", "vercel_blob_rw_bad.host/x_secret"],
  ])("falls back to any public Blob host but keeps the path and query limits (%s)", (_label, token) => {
    const patterns = assetImageRemotePatterns({ ASSETS_READ_WRITE_TOKEN: token });
    expect(patterns).toEqual([
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com", port: "", pathname: "/assets/**", search: "" },
    ]);
    expect(allows(patterns, OUR_UPLOAD)).toBe(true);
    expect(allows(patterns, "https://previewstore.public.blob.vercel-storage.com/assets/c1/cat.png")).toBe(true);
    expect(allows(patterns, `${OUR_UPLOAD}?x=1`)).toBe(false);
    expect(allows(patterns, `https://${OUR_HOST}/sales-files/deal1/contract.png`)).toBe(false);
  });
});

// ASSETS_STORE_ID is the second source of the store id, for when the token is
// gone, renamed or replaced by Vercel's OIDC Blob auth. Vercel shows store ids
// as `store_<id>`; @vercel/blob strips that prefix the same way.
describe("image resizer allow-list from ASSETS_STORE_ID when the token gives no store id", () => {
  it.each([
    ["Vercel's store_ form", "store_AbC123xYz"],
    ["bare id", "AbC123xYz"],
    ["surrounding spaces", "  store_AbC123xYz \n"],
  ])("pins the host to our own assets store (%s)", (_label, storeId) => {
    for (const token of [undefined, "", "some-other-token"]) {
      const patterns = assetImageRemotePatterns({ ASSETS_READ_WRITE_TOKEN: token, ASSETS_STORE_ID: storeId });
      expect(patterns).toEqual(PINNED);
      expect(allows(patterns, OUR_UPLOAD)).toBe(true);
      expect(allows(patterns, "https://someoneelse.public.blob.vercel-storage.com/assets/c1/cat.png")).toBe(false);
    }
  });

  it("prefers the token's store when both are set, because uploads go to the token's store", () => {
    const patterns = assetImageRemotePatterns({ ASSETS_READ_WRITE_TOKEN: FAKE_TOKEN, ASSETS_STORE_ID: "store_Other9" });
    expect(patterns).toEqual(PINNED);
  });

  it.each([
    ["odd characters", "store_bad.host/x"],
    ["prefix only", "store_"],
    ["blank", "   "],
  ])("ignores an unusable store id (%s)", (_label, storeId) => {
    expect(assetImageRemotePatterns({ ASSETS_STORE_ID: storeId })).toEqual(ANY_BLOB_STORE);
  });
});

// With no store id at all, the any-store fallback must never reach a deployed
// build: anyone can upload /assets/1.png, /assets/2.png... to their own free
// Blob store, and each one would be a new billed resize.
describe("image resizer allow-list on Vercel without a usable store id", () => {
  const noStoreId = [
    ["nothing set", {}],
    ["token not a Blob token", { ASSETS_READ_WRITE_TOKEN: "some-other-token" }],
    ["store id with odd characters", { ASSETS_STORE_ID: "store_bad.host/x" }],
  ] as const;

  it.each(noStoreId)("fails a production build loudly instead of allowing any Blob store (%s)", (_label, env) => {
    for (const vercel of [{ VERCEL: "1", VERCEL_ENV: "production" }, { VERCEL_ENV: "production" }]) {
      expect(() => assetImageRemotePatterns({ ...env, ...vercel })).toThrow(/ASSETS_STORE_ID/);
    }
  });

  it("does not print the variables' values in the build error", () => {
    expect(() =>
      assetImageRemotePatterns({ ASSETS_READ_WRITE_TOKEN: "some-other-token", VERCEL: "1", VERCEL_ENV: "production" }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("some-other-token") }));
  });

  it.each(noStoreId)("allows no remote pictures at all on a Preview build (%s)", (_label, env) => {
    const patterns = assetImageRemotePatterns({ ...env, VERCEL: "1", VERCEL_ENV: "preview" });
    expect(patterns).toEqual([]);
    expect(allows(patterns, OUR_UPLOAD)).toBe(false);
    expect(allows(patterns, "https://attackerstore.public.blob.vercel-storage.com/assets/1.png")).toBe(false);
  });

  it("still pins production and Preview builds when a store id is available", () => {
    for (const vercel of [{ VERCEL: "1", VERCEL_ENV: "production" }, { VERCEL: "1", VERCEL_ENV: "preview" }]) {
      expect(assetImageRemotePatterns({ ASSETS_READ_WRITE_TOKEN: FAKE_TOKEN, ...vercel })).toEqual(PINNED);
      expect(assetImageRemotePatterns({ ASSETS_STORE_ID: "store_AbC123xYz", ...vercel })).toEqual(PINNED);
    }
  });
});

// The first import of next.config.ts loads Sentry's build wrapper, which can
// take a few seconds on a cold start.
describe("next.config.ts", { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Starts from a clean slate so nothing in the shell running the tests leaks in.
  function stubBuildEnv(env: Record<string, string | undefined>) {
    for (const name of ["ASSETS_READ_WRITE_TOKEN", "ASSETS_STORE_ID", "VERCEL", "VERCEL_ENV"]) {
      vi.stubEnv(name, env[name]);
    }
  }

  async function loadImagesConfig() {
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    return config.images;
  }

  it("uses the pinned allow-list when ASSETS_READ_WRITE_TOKEN is set at build time", async () => {
    stubBuildEnv({ ASSETS_READ_WRITE_TOKEN: FAKE_TOKEN });
    const images = await loadImagesConfig();
    expect(images?.remotePatterns).toEqual(PINNED);
  });

  it("uses the pinned allow-list from ASSETS_STORE_ID when the token is absent", async () => {
    stubBuildEnv({ ASSETS_STORE_ID: "store_AbC123xYz", VERCEL: "1", VERCEL_ENV: "production" });
    const images = await loadImagesConfig();
    expect(images?.remotePatterns).toEqual(PINNED);
  });

  it("fails a production build that has neither ASSETS_READ_WRITE_TOKEN nor ASSETS_STORE_ID", async () => {
    stubBuildEnv({ VERCEL: "1", VERCEL_ENV: "production" });
    await expect(loadImagesConfig()).rejects.toThrow(/ASSETS_STORE_ID/);
  });

  it("allows no remote pictures on a Preview build with no store id", async () => {
    stubBuildEnv({ VERCEL: "1", VERCEL_ENV: "preview" });
    const images = await loadImagesConfig();
    expect(images?.remotePatterns).toEqual([]);
  });

  it("uses the limited wildcard allow-list off Vercel with no store id", async () => {
    stubBuildEnv({});
    const images = await loadImagesConfig();
    expect(images?.remotePatterns).toEqual(ANY_BLOB_STORE);
  });
});
