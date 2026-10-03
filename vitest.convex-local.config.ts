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
  },
});
