import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import { PRINTFUL_WEBHOOK_MAX_BYTES, shipmentFromPrintful, type PrintfulOrder, type PrintfulShipment } from "./client";
import { printfulEventKey, verifyPrintfulWebhook } from "./webhookVerify";

// POST /webhooks/printful. Order: size limit, signature over the raw body, store ID, then the
// event is deduplicated by its body hash (without `retries`) and applied. Printful retries
// anything that isn't 2xx, so only a bad signature or a malformed body is refused.

type PrintfulWebhook = {
  type?: unknown;
  occurred_at?: unknown;
  retries?: unknown;
  store_id?: unknown;
  data?: { order?: Partial<PrintfulOrder> & { id?: unknown }; shipment?: PrintfulShipment; reason?: unknown };
};

// Event types that imply a status when the payload's order doesn't carry one.
const TYPE_STATUS: Record<string, string> = {
  order_failed: "failed",
  order_canceled: "canceled",
  order_put_hold: "onhold",
  order_put_hold_approval: "onhold",
};

const text = (body: string, status: number) => new Response(body, { status });

export async function handlePrintfulWebhook(ctx: ActionCtx, request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > PRINTFUL_WEBHOOK_MAX_BYTES) return text("Too large", 413);
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > PRINTFUL_WEBHOOK_MAX_BYTES) return text("Too large", 413);

  // The env's key, else the one Connect Printful stored (convex/integrations.ts).
  const secret = process.env.PRINTFUL_WEBHOOK_SECRET?.trim() || ((await ctx.runQuery(internal.integrations.printfulWebhookSecret, {})) ?? "");
  if (!secret) return text("Not configured", 503);
  if (!(await verifyPrintfulWebhook(raw, request.headers.get("x-pf-webhook-signature"), secret))) {
    return text("Unauthorized", 401);
  }

  const body = new TextDecoder().decode(raw);
  let payload: PrintfulWebhook;
  try {
    payload = JSON.parse(body) as PrintfulWebhook;
  } catch {
    return text("Bad JSON", 400);
  }
  if (!payload || typeof payload !== "object" || typeof payload.type !== "string") return text("Bad event", 400);
  const type = payload.type;
  const storeId = payload.store_id === undefined || payload.store_id === null ? "" : String(payload.store_id);
  const order = payload.data?.order;
  const printfulOrderId = typeof order?.id === "number" ? order.id : undefined;
  const externalId = typeof order?.external_id === "string" && order.external_id ? order.external_id : undefined;
  const eventKey = await printfulEventKey(payload as Record<string, unknown>, storeId, String(printfulOrderId ?? externalId ?? ""));

  if (storeId !== (process.env.PRINTFUL_STORE_ID ?? "").trim()) {
    await ctx.runMutation(internal.orders.recordIgnoredWebhook, { source: "printful", eventKey, topic: type, reason: "other store" });
    return text("Ignored", 200);
  }
  if (printfulOrderId === undefined && !externalId) {
    await ctx.runMutation(internal.orders.recordIgnoredWebhook, { source: "printful", eventKey, topic: type, reason: "no order" });
    return text("Ignored", 200);
  }

  const occurred = typeof payload.occurred_at === "string" ? Date.parse(payload.occurred_at) : NaN;
  const occurredAt = Number.isFinite(occurred) ? occurred : Date.now();
  const status = typeof order?.status === "string" ? order.status : TYPE_STATUS[type];
  const reason = typeof payload.data?.reason === "string" ? payload.data.reason.slice(0, 300) : undefined;
  const shipment = payload.data?.shipment;
  const items = Array.isArray(order?.order_items)
    ? order.order_items
        .filter((item) => typeof item?.id === "number")
        .map((item) => ({ id: item.id, externalId: typeof item.external_id === "string" ? item.external_id : null }))
    : undefined;

  const result = await ctx.runMutation(internal.fulfillment.ingestPrintfulEvent, {
    eventKey,
    type,
    body,
    storeId,
    occurredAt,
    printfulOrderId,
    externalId,
    status,
    reason,
    items,
    shipment:
      type === "shipment_sent" && shipment && typeof shipment.id === "number"
        ? shipmentFromPrintful(shipment, occurredAt)
        : undefined,
  });
  return text(result === "duplicate" ? "Duplicate" : result === "ignored" ? "Ignored" : "OK", 200);
}
