import { ConvexTestingHelper } from "convex-helpers/testing";

export function canRunConvexIntegrationTests() {
  return Boolean(
    process.env.VITE_CONVEX_URL &&
      process.env.TEST_HELPER_SECRET &&
      process.env.CONVEX_DEPLOY_KEY,
  );
}

export function createTestHelper() {
  const backendUrl = process.env.VITE_CONVEX_URL;
  const adminKey = process.env.CONVEX_DEPLOY_KEY;
  if (!backendUrl || !adminKey) {
    throw new Error("VITE_CONVEX_URL and CONVEX_DEPLOY_KEY are required");
  }
  return new ConvexTestingHelper({ backendUrl, adminKey });
}

export function getTestSecret() {
  if (!process.env.TEST_HELPER_SECRET) {
    throw new Error("TEST_HELPER_SECRET is required");
  }
  return process.env.TEST_HELPER_SECRET;
}
