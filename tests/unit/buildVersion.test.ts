import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_ID, isChunkLoadError, mayReload, newerBuildLive } from "../../src/lib/buildVersion";

// Open tabs move onto a new build after a deploy (src/lib/buildVersion.ts).
describe("noticing a new build", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("knows what browsers say when a code file is gone", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://cultremix.com/assets/cr._cr-CO37aCb5.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://cultremix.com/assets/x.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/app-DULautEN.css"))).toBe(true);
    expect(isChunkLoadError(new Error("Sign in first."))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it("reloads at most once a minute", () => {
    expect(mayReload(null, 1_000)).toBe(true);
    expect(mayReload(1_000, 30_000)).toBe(false);
    expect(mayReload(1_000, 61_000)).toBe(true);
  });

  it("compares the live build with this page's, and stays quiet when it can't tell", async () => {
    const answer = (response: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(response));
    answer(() => Promise.resolve(Response.json({ build: BUILD_ID + "-next" })));
    expect(await newerBuildLive()).toBe(true);
    answer(() => Promise.resolve(Response.json({ build: BUILD_ID })));
    expect(await newerBuildLive()).toBe(false);
    answer(() => Promise.resolve(new Response("Not found", { status: 404 })));
    expect(await newerBuildLive()).toBe(false);
    answer(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await newerBuildLive()).toBe(false);
  });
});
