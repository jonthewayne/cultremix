import type { ActionCtx } from "../../_generated/server";

// POST /webhooks/printful. Filled in with fulfillment (step 5).
export async function handlePrintfulWebhook(_ctx: ActionCtx, _request: Request): Promise<Response> {
  return new Response("Not configured", { status: 503 });
}
