import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

export default nextConfig;
