import { SHOPIFY_API_VERSION } from "../../../shared/config/shopify";

// Shopify Admin API client (KTD-12). The token comes from the Dev Dashboard app's
// client-credentials grant and lasts 24 hours; it is cached in a store shared across actions,
// refreshed an hour early, and refreshed once more if a call answers 401. fetch is injectable so
// tests never touch the network.

export type ShopifyAdminConfig = {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
};

export type CachedToken = { accessToken: string; expiresAt: number };

export type TokenStore = {
  get: () => Promise<CachedToken | null>;
  set: (token: CachedToken) => Promise<void>;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// Refresh when less than this much life is left.
export const TOKEN_REFRESH_EARLY_MS = 60 * 60 * 1000;

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

export function shopifyAdminConfigFromEnv(env: Record<string, string | undefined> = process.env): ShopifyAdminConfig | null {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN?.trim();
  const clientId = env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!shopDomain || !clientId || !clientSecret) return null;
  return { shopDomain, clientId, clientSecret, apiVersion: env.SHOPIFY_API_VERSION?.trim() || undefined };
}

export function createShopifyAdmin(deps: {
  config: ShopifyAdminConfig;
  tokenStore: TokenStore;
  fetch?: FetchLike;
  now?: () => number;
}) {
  const { config, tokenStore } = deps;
  const doFetch: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const version = config.apiVersion ?? SHOPIFY_API_VERSION;
  let memory: CachedToken | null = null;

  async function requestToken(): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const response = await doFetch(`https://${config.shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new ShopifyError(`Shopify token request failed (${response.status}).`, response.status, response.status >= 500 || response.status === 429);
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new ShopifyError("Shopify token response had no token.", 502, true);
    const token = { accessToken: data.access_token, expiresAt: now() + (data.expires_in ?? 86399) * 1000 };
    memory = token;
    await tokenStore.set(token);
    return token;
  }

  async function token(force = false): Promise<string> {
    if (!force) {
      const fresh = (t: CachedToken | null) => t && t.expiresAt - now() > TOKEN_REFRESH_EARLY_MS;
      if (fresh(memory)) return memory!.accessToken;
      const stored = await tokenStore.get();
      if (stored && fresh(stored)) {
        memory = stored;
        return stored.accessToken;
      }
    }
    return (await requestToken()).accessToken;
  }

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const send = async (accessToken: string) =>
      doFetch(`https://${config.shopDomain}/admin/api/${version}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query, variables }),
      });
    let response = await send(await token());
    if (response.status === 401) response = await send(await token(true));
    if (!response.ok) {
      throw new ShopifyError(
        `Shopify Admin API answered ${response.status}.`,
        response.status,
        response.status >= 500 || response.status === 429,
      );
    }
    const json = (await response.json()) as { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> };
    if (json.errors?.length) {
      const throttled = json.errors.some((e) => e.extensions?.code === "THROTTLED");
      throw new ShopifyError(`Shopify Admin API error: ${json.errors.map((e) => e.message).join("; ")}`, 200, throttled);
    }
    if (!json.data) throw new ShopifyError("Shopify Admin API returned no data.", 502, true);
    return json.data;
  }

  return { graphql, token, apiVersion: version, shopDomain: config.shopDomain };
}

export type ShopifyAdmin = ReturnType<typeof createShopifyAdmin>;
