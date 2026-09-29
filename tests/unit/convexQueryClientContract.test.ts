import { describe, expect, it } from "vitest";
import { ConvexQueryClient } from "@convex-dev/react-query";

describe("ConvexQueryClient SSR contract", () => {
  it("keeps the methods and HTTP auth handoff used by the router", () => {
    const client = new ConvexQueryClient("https://example.convex.cloud", {
      expectAuth: true,
    });

    expect(client.hashFn).toBeTypeOf("function");
    expect(client.queryFn).toBeTypeOf("function");
    expect(client.connect).toBeTypeOf("function");
    expect(client.serverHttpClient).toBeDefined();
    expect(client.serverHttpClient?.setAuth).toBeTypeOf("function");
    expect(client.convexClient).toBeDefined();
  });
});
