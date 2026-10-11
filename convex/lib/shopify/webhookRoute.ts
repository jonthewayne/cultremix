import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import {
  SHOPIFY_DISPUTE_TOPICS,
  SHOPIFY_PRIVACY_TOPICS,
  SHOPIFY_WEBHOOK_MAX_BYTES,
  SHOPIFY_WEBHOOK_TOPICS,
} from "../../../shared/config/shopify";
import { parseDispute } from "../disputes";
import { verifyShopifyWebhook } from "./webhookVerify";

// POST /webhooks/shopify (KTD-12). Order: size limit, HMAC over the raw body, shop domain, topic,
// then the delivery is stored (event, payload, inbox entry) before the 200. Shopify retries
// anything that isn't 2xx, so only a bad signature or a malformed body is refused.

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? "").trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
}

const text = (body: string, status: number) => new Response(body, { status });

export async function handleShopifyWebhook(ctx: ActionCtx, request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > SHOPIFY_WEBHOOK_MAX_BYTES) return text("Too large", 413);
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > SHOPIFY_WEBHOOK_MAX_BYTES) return text("Too large", 413);

  const secret = process.env.SHOPIFY_CLIENT_SECRET ?? "";
  if (!secret) return text("Not configured", 503);
  if (!(await verifyShopifyWebhook(raw, request.headers.get("x-shopify-hmac-sha256"), secret))) {
    return text("Unauthorized", 401);
  }

  const webhookId = request.headers.get("x-shopify-webhook-id")?.trim();
  if (!webhookId) return text("Missing webhook id", 400);
  const topic = request.headers.get("x-shopify-topic")?.trim() ?? "";

  const shop = normalizeDomain(request.headers.get("x-shopify-shop-domain"));
  if (shop !== normalizeDomain(process.env.SHOPIFY_SHOP_DOMAIN)) {
    await ctx.runMutation(internal.orders.recordIgnoredWebhook, {
      source: "shopify",
      eventKey: webhookId,
      topic,
      reason: "other shop",
    });
    return text("Ignored", 200);
  }
  // Privacy webhooks (convex/privacy.ts) name a customer and orders, not one order.
  if ((SHOPIFY_PRIVACY_TOPICS as ReadonlyArray<string>).includes(topic)) {
    let privacy: { customer?: { id?: unknown }; orders_requested?: unknown; orders_to_redact?: unknown };
    try {
      privacy = JSON.parse(new TextDecoder().decode(raw)) as typeof privacy;
    } catch {
      return text("Bad JSON", 400);
    }
    const ids = (list: unknown) =>
      (Array.isArray(list) ? list : [])
        .filter((id): id is number | string => typeof id === "number" || (typeof id === "string" && /^\d+$/u.test(id)))
        .map(String);
    const customerId = privacy.customer?.id;
    const result = await ctx.runMutation(internal.privacy.recordRequest, {
      webhookId,
      topic: topic as (typeof SHOPIFY_PRIVACY_TOPICS)[number],
      shopDomain: shop,
      ...(typeof customerId === "number" || typeof customerId === "string" ? { customerId: String(customerId) } : {}),
      orderIds: topic === "customers/data_request" ? ids(privacy.orders_requested) : ids(privacy.orders_to_redact),
    });
    return text(result === "duplicate" ? "Duplicate" : "OK", 200);
  }
  // Chargebacks and inquiries (convex/disputes.ts) carry their own status; the order isn't fetched.
  if ((SHOPIFY_DISPUTE_TOPICS as ReadonlyArray<string>).includes(topic)) {
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return text("Bad JSON", 400);
    }
    const dispute = parseDispute(payload);
    if (!dispute) return text("Missing dispute or order id", 400);
    const triggeredAt = Date.parse(request.headers.get("x-shopify-triggered-at") ?? "");
    const result = await ctx.runMutation(internal.disputes.record, {
      webhookId,
      topic,
      ...dispute,
      ...(Number.isFinite(triggeredAt) ? { eventAt: triggeredAt } : {}),
    });
    return text(result === "duplicate" ? "Duplicate" : "OK", 200);
  }
  if (!(SHOPIFY_WEBHOOK_TOPICS as ReadonlyArray<string>).includes(topic)) {
    await ctx.runMutation(internal.orders.recordIgnoredWebhook, {
      source: "shopify",
      eventKey: webhookId,
      topic,
      reason: "unknown topic",
    });
    return text("Ignored", 200);
  }

  const body = new TextDecoder().decode(raw);
  let payload: { id?: unknown; order_id?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return text("Bad JSON", 400);
  }
  const idOf = (value: unknown) =>
    typeof value === "number" || (typeof value === "string" && /^\d+$/u.test(value)) ? String(value) : null;
  const shopifyOrderId = topic === "refunds/create" ? idOf(payload.order_id) : idOf(payload.id);
  if (!shopifyOrderId) return text("Missing order id", 400);
  const refundId = topic === "refunds/create" ? (idOf(payload.id) ?? undefined) : undefined;

  const result = await ctx.runMutation(internal.orders.ingestShopifyWebhook, {
    webhookId,
    topic,
    shopifyOrderId,
    refundId,
    body,
  });
  return text(result === "duplicate" ? "Duplicate" : "OK", 200);
}
