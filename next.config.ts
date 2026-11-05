import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    // Vercel Blob's public object host — lets next/image serve resized/
    // optimized thumbnails for IMAGE asset cards instead of the full file.
    remotePatterns: [{ protocol: "https", hostname: "**.public.blob.vercel-storage.com" }],
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
  // Sentry puts a list of every page route into a script that loads on every
  // page, /login included. Sales is secret from people without Sales access,
  // so its routes stay out of that list (their Sentry transactions are named by
  // URL instead). Guarded by tests/lib/sales/sentry-route-manifest.test.ts and
  // `npm run check:sales-secrecy`.
  routeManifestInjection: { exclude: (route) => /^\/sales(\/|$)/.test(route) },
});
