import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// In-memory Convex tests (convex-test): queries, mutations, and their rules run against the real
// schema without a deployment. Helpers live in tests/convex-local/setup.ts.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "edge-runtime",
    include: ["tests/convex-local/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
    // A file's first call through an HTTP route or a scheduled action loads every Convex module,
    // which can pass 5 seconds when the machine is busy (seen at load averages of 30 and up).
    testTimeout: 30_000,
    // The in-memory deployment has no DEPLOYMENT_ENV; the suite pins v5's math; tests that need v6 stub ECONOMICS_VERSION.
    env: { ECONOMICS_VERSION: "5", ARTIST_HASH_SECRET: "test-artist-hash-secret" },
  },
});
