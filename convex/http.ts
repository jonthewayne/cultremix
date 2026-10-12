import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { handleShopifyWebhook } from "./lib/shopify/webhookRoute";
import { handlePrintfulWebhook } from "./lib/printful/webhookRoute";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Serves images kept in Convex file storage (IMAGE_STORE=convex). With ?download=<name>, the
// browser saves the file under that name instead of showing it.
http.route({
  pathPrefix: "/img/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const id = url.pathname.slice("/img/".length);
    let blob: Blob | null = null;
    try {
      blob = await ctx.storage.get(id as Id<"_storage">);
    } catch {
      blob = null;
    }
    if (!blob) return new Response("Not found", { status: 404 });
    const download = url.searchParams.get("download")?.replace(/[^A-Za-z0-9._-]/gu, "").slice(0, 80);
    return new Response(blob, {
      headers: {
        "Content-Type": blob.type || "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
        ...(download ? { "Content-Disposition": `attachment; filename="${download}"` } : {}),
      },
    });
  }),
});

// Shop webhooks: Shopify orders and refunds; Printful order and shipment events.
http.route({
  path: "/webhooks/shopify",
  method: "POST",
  handler: httpAction(handleShopifyWebhook),
});
http.route({
  path: "/webhooks/printful",
  method: "POST",
  handler: httpAction(handlePrintfulWebhook),
});

export default http;
