import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

import { assetImageRemotePatterns } from "./src/lib/image-remote-patterns";

const nextConfig: NextConfig = {
  images: {
    // Lets next/image serve resized/optimized thumbnails for IMAGE asset cards
    // instead of the full file, but only for our own asset uploads: our assets
    // Blob store, under /assets/, with no query string (see the helper). A
    // production build with no assets store id fails here on purpose.
    remotePatterns: assetImageRemotePatterns(process.env),
  },
  turbopack: {
    resolveAlias: {
      // @vercel/blob's browser bundle imports `undici` (a Node-only HTTP lib)
      // and relies on package.json's legacy `browser` field to swap in a
      // `globalThis.fetch` shim instead — that swap only works under Webpack.
      // Turbopack doesn't honor that field, so without this alias the real
      // Node `undici` ships to the browser and its network calls hang
      // silently (no error) when uploading to Vercel Blob's storage host.
      undici: "@vercel/blob/dist/undici-browser.js",
    },
  },
};

export default withSentryConfig(nextConfig, {
  silent: true, // no CLI chatter on builds without a configured auth token
});
