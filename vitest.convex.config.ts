import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const testEnv = loadEnv("test", process.cwd(), "");
for (const [key, value] of Object.entries(testEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/convex/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
