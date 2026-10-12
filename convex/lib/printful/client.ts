// Printful v2 (V1 U10, "Fulfillment"). A small client over fetch so tests replace the transport.
// Orders are keyed by external_id = the Shopify order ID, which is how a retry finds an order an
// earlier, ambiguous create may already have made. Paths and fields are v2's; U0 confirms the
// order-item PATCH/DELETE calls used for refunds against a real draft.

export const PRINTFUL_API_BASE = "https://api.printful.com";
export const PRINTFUL_WEBHOOK_MAX_BYTES = 256 * 1024;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class PrintfulError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // True when the request may have taken effect anyway (network error, 5xx, 409, 429): a create
    // is then polled by external_id, never sent again.
    readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = "PrintfulError";
  }
}

export type PrintfulOrderItem = {
  id: number;
  external_id?: string | null;
  catalog_variant_id?: number | null;
  quantity: number;
};

export type PrintfulOrder = {
  id: number;
  external_id: string | null;
  store_id?: number;
  status: string;
  order_items?: Array<PrintfulOrderItem>;
};

export type PrintfulShipment = {
  id: number;
  status?: string;
  carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  shipment_items?: Array<{ order_item_id: number; quantity: number }>;
};

// A shipment as fulfillment stores it.
export type ShipmentRecord = {
  id: string;
  shippedAt: number;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  items: Array<{ printfulItemId: number; quantity: number }>;
};

// A listed shipment counts once it has left Printful.
export function hasShipped(shipment: PrintfulShipment): boolean {
  return Boolean(shipment.shipped_at) || ["shipped", "delivered", "in_transit"].includes((shipment.status ?? "").toLowerCase());
}

export function shipmentFromPrintful(shipment: PrintfulShipment, fallbackAt: number): ShipmentRecord {
  const shippedAt = shipment.shipped_at ? Date.parse(shipment.shipped_at) : NaN;
  const out: ShipmentRecord = {
    id: String(shipment.id),
    shippedAt: Number.isFinite(shippedAt) ? shippedAt : fallbackAt,
    items: (shipment.shipment_items ?? []).map((i) => ({ printfulItemId: i.order_item_id, quantity: i.quantity })),
  };
  if (shipment.carrier) out.carrier = shipment.carrier;
  if (shipment.tracking_number) out.trackingNumber = shipment.tracking_number;
  if (shipment.tracking_url) out.trackingUrl = shipment.tracking_url;
  return out;
}

export type PrintfulRecipient = {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  zip: string;
  phone?: string;
  email?: string;
};

// Printful's regular DTG placements. Each print file covers its placement's whole print area at
// 300 DPI with the design where its creator put it (convex/printTools.ts renderListings), so no
// position is sent: Printful fits the file to the area.
export type PrintfulPlacement = "front" | "back";

export type PrintfulOrderRequest = {
  external_id: string;
  shipping: "STANDARD";
  recipient: PrintfulRecipient;
  order_items: Array<{
    source: "catalog";
    catalog_variant_id: number;
    quantity: number;
    external_id: string;
    placements: Array<{ placement: PrintfulPlacement; technique: "dtg"; layers: Array<{ type: "file"; url: string }> }>;
  }>;
};

export type PrintfulConfig = { token: string; storeId: string };

export function printfulConfigFromEnv(env: Record<string, string | undefined> = process.env): PrintfulConfig | null {
  const token = env.PRINTFUL_API_TOKEN?.trim();
  const storeId = env.PRINTFUL_STORE_ID?.trim();
  return token && storeId ? { token, storeId } : null;
}

// The create body for one Shopify order: one catalog item per open line, on its listing's side.
export function buildOrderRequest(args: {
  shopifyOrderId: string;
  recipient: PrintfulRecipient;
  lines: Array<{ lineItemId: string; catalogVariantId: number; quantity: number; printUrl: string; placement?: PrintfulPlacement }>;
}): PrintfulOrderRequest {
  return {
    external_id: args.shopifyOrderId,
    shipping: "STANDARD",
    recipient: args.recipient,
    order_items: args.lines.map((line) => ({
      source: "catalog",
      catalog_variant_id: line.catalogVariantId,
      quantity: line.quantity,
      external_id: line.lineItemId,
      placements: [{ placement: line.placement ?? "front", technique: "dtg", layers: [{ type: "file", url: line.printUrl }] }],
    })),
  };
}

export function createPrintful(deps: { config: PrintfulConfig; fetch?: FetchLike; base?: string }) {
  const doFetch: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const base = deps.base ?? PRINTFUL_API_BASE;

  // v2 answers { data }, v1 (the print-file endpoint) answers { result }.
  async function call<T>(method: string, path: string, body?: unknown, allow404 = false, envelope: "data" | "result" = "data"): Promise<T | null> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${deps.config.token}`,
          "X-PF-Store-Id": deps.config.storeId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new PrintfulError(`Printful unreachable: ${error instanceof Error ? error.message : String(error)}`, 0, true);
    }
    if (response.status === 404 && allow404) return null;
    const text = await response.text();
    if (!response.ok) {
      let message = `Printful ${method} ${path} answered ${response.status}.`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string }; detail?: string; result?: string };
        message = parsed.error?.message ?? parsed.detail ?? (typeof parsed.result === "string" ? parsed.result : message);
      } catch {
        // keep the generic message
      }
      const ambiguous = response.status >= 500 || response.status === 409 || response.status === 429;
      throw new PrintfulError(message, response.status, ambiguous);
    }
    if (!text) return null;
    const parsed = JSON.parse(text) as { data?: T; result?: T };
    return ((envelope === "result" ? parsed.result : parsed.data) ?? null);
  }

  return {
    async getOrderByExternalId(externalId: string): Promise<PrintfulOrder | null> {
      return call<PrintfulOrder>("GET", `/v2/orders/@${encodeURIComponent(externalId)}`, undefined, true);
    },
    async getOrder(id: number): Promise<PrintfulOrder | null> {
      return call<PrintfulOrder>("GET", `/v2/orders/${id}`, undefined, true);
    },
    async createOrder(request: PrintfulOrderRequest): Promise<PrintfulOrder> {
      const order = await call<PrintfulOrder>("POST", "/v2/orders", request);
      if (!order) throw new PrintfulError("Printful answered without an order.", 200, true);
      return order;
    },
    async confirmOrder(id: number): Promise<PrintfulOrder | null> {
      return call<PrintfulOrder>("POST", `/v2/orders/${id}/confirmation`);
    },
    // Deletes a draft (only drafts can be deleted). Already gone counts as done.
    async deleteOrder(id: number): Promise<void> {
      await call("DELETE", `/v2/orders/${id}`, undefined, true);
    },
    async setItemQuantity(orderId: number, itemId: number, quantity: number): Promise<void> {
      await call("PATCH", `/v2/orders/${orderId}/order-items/${itemId}`, { quantity });
    },
    async deleteItem(orderId: number, itemId: number): Promise<void> {
      await call("DELETE", `/v2/orders/${orderId}/order-items/${itemId}`, undefined, true);
    },
    async listShipments(orderId: number): Promise<Array<PrintfulShipment>> {
      return (await call<Array<PrintfulShipment>>("GET", `/v2/orders/${orderId}/shipments`, undefined, true)) ?? [];
    },
    // The store the token and store id reach (a check that both are right).
    async getStore(): Promise<{ id: number; name?: string; type?: string } | null> {
      return call<{ id: number; name?: string; type?: string }>("GET", `/v2/stores/${encodeURIComponent(deps.config.storeId)}`, undefined, true);
    },
    // A catalog product's print files: each placement's file size and DPI, per variant.
    async printfiles(productId: number): Promise<PrintfulPrintfiles | null> {
      return call<PrintfulPrintfiles>("GET", `/mockup-generator/printfiles/${productId}`, undefined, true, "result");
    },
    // Sets the store's webhooks (it replaces what was there) and returns the signing key.
    async setWebhooks(config: PrintfulWebhookConfig): Promise<{ secret_key?: string; events?: Array<{ type: string }> } | null> {
      return call<{ secret_key?: string; events?: Array<{ type: string }> }>("POST", "/v2/webhooks", config);
    },
  };
}

// GET /mockup-generator/printfiles/<product id> (v1): sizes in pixels at dpi, and which file each
// variant uses on each placement.
export type PrintfulPrintfiles = {
  product_id?: number;
  available_placements?: Record<string, string>;
  printfiles?: Array<{ printfile_id: number; width: number; height: number; dpi: number }>;
  variant_printfiles?: Array<{ variant_id: number; placements: Record<string, number> }>;
};

export type PrintfulWebhookConfig = { default_url: string; events: Array<{ type: string }> };

export type Printful = ReturnType<typeof createPrintful>;

// Printful order status -> our fulfillment state (V1 plan).
export const PRINTFUL_STATUS_STATE = {
  draft: "draft",
  pending: "submitted",
  inreview: "submitted",
  onhold: "on_hold",
  inprocess: "in_production",
  partial: "partial",
  fulfilled: "shipped",
  canceled: "canceled",
  failed: "needs_attention",
} as const;

export type PrintfulState = (typeof PRINTFUL_STATUS_STATE)[keyof typeof PRINTFUL_STATUS_STATE];

// Later states outrank earlier ones; an event that would move an order backwards is ignored.
const RANK: Record<string, number> = {
  draft: 1,
  submitted: 2,
  on_hold: 2,
  in_production: 3,
  partial: 4,
  shipped: 5,
  canceled: 5,
  needs_attention: 0,
};

export function stateForStatus(status: string): PrintfulState | null {
  return (PRINTFUL_STATUS_STATE as Record<string, PrintfulState>)[status.toLowerCase()] ?? null;
}

// Whether moving from `current` to `next` goes forward. needs_attention is always allowed in, and
// any real Printful state may follow it (the owner may have fixed the order in Printful).
export function isForward(current: string, next: string): boolean {
  if (next === "needs_attention") return true;
  const from = RANK[current];
  if (from === undefined) return true;
  if (current === "shipped" || current === "canceled") return false;
  return RANK[next] >= from;
}
