import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // next-auth imports `next/server` (bare, no extension) from its own
    // internal files. Next.js resolves that; Vite's ESM resolver does not,
    // because `next` has no exports map entry for "./server". The alias
    // below points Vite at the real file so tests that reach a route
    // whose import chain touches next-auth can load. In production these
    // files run under Next.js itself, not Vite, so this alias has no effect.
    alias: [{ find: /^next\/server$/, replacement: "next/server.js" }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // next-auth's own files use a bare `import "next/server"` that Node's ESM
    // resolver refuses (`next` has no export map entry for "./server"). Inlining
    // next-auth makes Vite transform its files, so the alias above applies.
    server: {
      deps: {
        inline: [/next-auth/],
      },
    },
  },
});
