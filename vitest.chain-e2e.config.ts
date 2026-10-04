import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// The chain-write engine end to end against a local anvil node: the real registry bytecode, the
// real viem RPC client, and convex-test for the Convex side. Needs Foundry's anvil (ANVIL_BIN to
// point elsewhere). Not part of `bun run test`; run with `bun run test:chain:anvil`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "edge-runtime",
    include: ["tests/chain-e2e/**/*.test.ts"],
    globalSetup: ["tests/chain-e2e/globalSetup.ts"],
    server: { deps: { inline: ["convex-test"] } },
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
