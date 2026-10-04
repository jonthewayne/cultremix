import { SHOPIFY_API_VERSION } from "../../shared/config/shopify";

// Shopify Storefront API client for carts (KTD-12). Runs only on the server with the private
// Storefront token, forwarding the shopper's IP so Shopify's bot protection sees the real buyer.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type StorefrontConfig = {
  shopDomain: string;
  privateToken: string;
  apiVersion?: string;
};

export function storefrontConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): StorefrontConfig | null {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN?.trim();
  const privateToken = env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN?.trim();
  if (!shopDomain || !privateToken) return null;
  return { shopDomain, privateToken, apiVersion: env.SHOPIFY_API_VERSION?.trim() || undefined };
}

export class StorefrontError extends Error {
  constructor(
    message: string,
    readonly code: string = "SHOPIFY",
  ) {
    super(message);
  }
}

export type CartLineView = {
  id: string;
  quantity: number;
  merchandiseId: string;
  cr: string | null;
  title: string;
  color: string | null;
  size: string | null;
  imageUrl: string | null;
  totalCents: number;
};

export type CartView = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  subtotalCents: number;
  currency: string;
  lines: Array<CartLineView>;
};

const CART_FIELDS = `fragment CartFields on Cart {
  id
  checkoutUrl
  totalQuantity
  cost { subtotalAmount { amount currencyCode } }
  lines(first: 50) {
    nodes {
      id
      quantity
      attributes { key value }
      cost { totalAmount { amount currencyCode } }
      merchandise {
        ... on ProductVariant {
          id
          image { url }
          product { title }
          selectedOptions { name value }
        }
      }
    }
  }
}`;

const CART_QUERY = `query CultRemixCart($id: ID!) { cart(id: $id) { ...CartFields } }
${CART_FIELDS}`;

const CART_CREATE = `mutation CultRemixCartCreate($input: CartInput!) {
  cartCreate(input: $input) { cart { ...CartFields } userErrors { field message code } }
}
${CART_FIELDS}`;

const CART_LINES_ADD = `mutation CultRemixCartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
  cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { field message code } }
}
${CART_FIELDS}`;

const CART_LINES_UPDATE = `mutation CultRemixCartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
  cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { field message code } }
}
${CART_FIELDS}`;

const CART_LINES_REMOVE = `mutation CultRemixCartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
  cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ...CartFields } userErrors { field message code } }
}
${CART_FIELDS}`;

type Money = { amount: string; currencyCode: string };

type RawCart = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: { subtotalAmount: Money };
  lines: {
    nodes: Array<{
      id: string;
      quantity: number;
      attributes: Array<{ key: string; value: string | null }>;
      cost: { totalAmount: Money };
      merchandise: {
        id: string;
        image: { url: string } | null;
        product: { title: string };
        selectedOptions: Array<{ name: string; value: string }>;
      };
    }>;
  };
};

type UserError = { field?: Array<string> | null; message: string; code?: string | null };

export function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

export function toCartView(cart: RawCart): CartView {
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity,
    subtotalCents: toCents(cart.cost.subtotalAmount.amount),
    currency: cart.cost.subtotalAmount.currencyCode,
    lines: cart.lines.nodes.map((line) => {
      const option = (name: string) => line.merchandise.selectedOptions.find((o) => o.name === name)?.value ?? null;
      return {
        id: line.id,
        quantity: line.quantity,
        merchandiseId: line.merchandise.id,
        cr: line.attributes.find((a) => a.key === "_cr")?.value ?? null,
        title: line.merchandise.product.title,
        color: option("Color"),
        size: option("Size"),
        imageUrl: line.merchandise.image?.url ?? null,
        totalCents: toCents(line.cost.totalAmount.amount),
      };
    }),
  };
}

export type CartLineInput = {
  merchandiseId: string;
  quantity: number;
  attributes: Array<{ key: string; value: string }>;
};

export function createStorefront(args: { config: StorefrontConfig; buyerIp?: string | null; fetch?: FetchLike }) {
  const { config } = args;
  const doFetch: FetchLike = args.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = `https://${config.shopDomain}/api/${config.apiVersion ?? SHOPIFY_API_VERSION}/graphql.json`;

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Shopify-Storefront-Private-Token": config.privateToken,
    };
    if (args.buyerIp) headers["Shopify-Storefront-Buyer-IP"] = args.buyerIp;
    const response = await doFetch(endpoint, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    if (!response.ok) throw new StorefrontError(`Shopify answered ${response.status}.`);
    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length || !body.data) {
      throw new StorefrontError(body.errors?.map((e) => e.message).join("; ") || "Shopify sent no data.");
    }
    return body.data;
  }

  async function mutate(name: string, query: string, variables: Record<string, unknown>): Promise<CartView> {
    const data = await graphql<Record<string, { cart: RawCart | null; userErrors: Array<UserError> }>>(query, variables);
    const result = data[name];
    if (result.userErrors.length || !result.cart) {
      const missing = result.userErrors.some((e) => e.code === "INVALID" && /cart/iu.test(e.field?.join(".") ?? ""));
      throw new StorefrontError(
        result.userErrors.map((e) => e.message).join("; ") || "Shopify sent no cart.",
        missing ? "CART_GONE" : (result.userErrors[0]?.code ?? "SHOPIFY"),
      );
    }
    return toCartView(result.cart);
  }

  return {
    async getCart(id: string): Promise<CartView | null> {
      const data = await graphql<{ cart: RawCart | null }>(CART_QUERY, { id });
      return data.cart ? toCartView(data.cart) : null;
    },
    createCart(lines: Array<CartLineInput>, attributes: Array<{ key: string; value: string }>) {
      return mutate("cartCreate", CART_CREATE, {
        input: { lines, attributes, buyerIdentity: { countryCode: "US" } },
      });
    },
    addLines(cartId: string, lines: Array<CartLineInput>) {
      return mutate("cartLinesAdd", CART_LINES_ADD, { cartId, lines });
    },
    updateLines(cartId: string, lines: Array<{ id: string; quantity: number }>) {
      return mutate("cartLinesUpdate", CART_LINES_UPDATE, { cartId, lines });
    },
    removeLines(cartId: string, lineIds: Array<string>) {
      return mutate("cartLinesRemove", CART_LINES_REMOVE, { cartId, lineIds });
    },
  };
}

export type Storefront = ReturnType<typeof createStorefront>;
