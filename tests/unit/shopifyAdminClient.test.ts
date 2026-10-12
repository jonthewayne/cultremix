import { describe, expect, it } from "vitest";
import {
  
  TOKEN_REFRESH_EARLY_MS,
  createShopifyAdmin,
  shopifyAdminConfigFromEnv
} from "../../convex/lib/shopify/adminClient";
import type { CachedToken } from "../../convex/lib/shopify/adminClient";

const HOUR = 60 * 60 * 1000;

function harness(start = 1_000_000) {
  let clock = start;
  let issued = 0;
  let stored: CachedToken | null = null;
  const seen: Array<string> = [];
  const revoked = new Set<string>();
  const fetchFake = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/admin/oauth/access_token")) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("client_credentials");
      expect(body.get("client_id")).toBe("cid");
      issued++;
      return Response.json({ access_token: `tok-${issued}`, scope: "write_products", expires_in: 86399 });
    }
    const token = new Headers(init?.headers).get("X-Shopify-Access-Token") ?? "";
    seen.push(token);
    if (revoked.has(token)) return new Response("Unauthorized", { status: 401 });
    return Response.json({ data: { shop: { name: "CultRemix" } } });
  };
  const admin = createShopifyAdmin({
    config: { shopDomain: "cultremix-dev.myshopify.com", clientId: "cid", clientSecret: "csecret" },
    fetch: fetchFake,
    now: () => clock,
    tokenStore: { get: async () => stored, set: async (t) => void (stored = t) },
  });
  return {
    admin,
    seen,
    revoked,
    issued: () => issued,
    stored: () => stored,
    advance: (ms: number) => void (clock += ms),
  };
}

describe("Shopify Admin token cache", () => {
  it("requests a token once and reuses it", async () => {
    const h = harness();
    await h.admin.graphql("{ shop { name } }");
    await h.admin.graphql("{ shop { name } }");
    expect(h.issued()).toBe(1);
    expect(h.seen).toEqual(["tok-1", "tok-1"]);
    expect(h.stored()?.accessToken).toBe("tok-1");
  });

  it("refreshes early, before the 24h token runs out", async () => {
    const h = harness();
    await h.admin.graphql("{ shop { name } }");
    h.advance(24 * HOUR - TOKEN_REFRESH_EARLY_MS - 5 * 60 * 1000);
    await h.admin.graphql("{ shop { name } }");
    expect(h.issued()).toBe(1);
    h.advance(10 * 60 * 1000);
    await h.admin.graphql("{ shop { name } }");
    expect(h.issued()).toBe(2);
    expect(h.seen.at(-1)).toBe("tok-2");
  });

  it("refreshes once on 401 and retries", async () => {
    const h = harness();
    await h.admin.graphql("{ shop { name } }");
    h.revoked.add("tok-1");
    const data = await h.admin.graphql<{ shop: { name: string } }>("{ shop { name } }");
    expect(data.shop.name).toBe("CultRemix");
    expect(h.issued()).toBe(2);
    expect(h.seen).toEqual(["tok-1", "tok-1", "tok-2"]);
  });

  it("reuses a token another action stored", async () => {
    const stored: CachedToken = { accessToken: "shared", expiresAt: Date.now() + 20 * HOUR };
    let issued = 0;
    const admin = createShopifyAdmin({
      config: { shopDomain: "s.myshopify.com", clientId: "a", clientSecret: "b" },
      fetch: async (url, init) => {
        if (url.endsWith("access_token")) {
          issued++;
          return Response.json({ access_token: "new", expires_in: 86399 });
        }
        expect(new Headers(init?.headers).get("X-Shopify-Access-Token")).toBe("shared");
        return Response.json({ data: { ok: true } });
      },
      tokenStore: { get: async () => stored, set: async () => {} },
    });
    await admin.graphql("{ ok }");
    expect(issued).toBe(0);
  });

  it("reports GraphQL errors and throttling", async () => {
    const admin = createShopifyAdmin({
      config: { shopDomain: "s.myshopify.com", clientId: "a", clientSecret: "b" },
      fetch: async (url) =>
        url.endsWith("access_token")
          ? Response.json({ access_token: "t", expires_in: 86399 })
          : Response.json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }),
      tokenStore: { get: async () => null, set: async () => {} },
    });
    await expect(admin.graphql("{ x }")).rejects.toMatchObject({ retryable: true });
  });
});

describe("shopifyAdminConfigFromEnv", () => {
  it("needs domain, client ID, and secret", () => {
    expect(shopifyAdminConfigFromEnv({})).toBeNull();
    expect(
      shopifyAdminConfigFromEnv({ SHOPIFY_SHOP_DOMAIN: "s.myshopify.com", SHOPIFY_CLIENT_ID: "a", SHOPIFY_CLIENT_SECRET: "b" }),
    ).toEqual({ shopDomain: "s.myshopify.com", clientId: "a", clientSecret: "b", apiVersion: undefined });
  });
});
