// Setting up a Shopify store from Admin (convex/integrations.ts): the order webhooks CultRemix
// handles (convex/lib/shopify/webhookRoute.ts), subscribed by the app itself. The three privacy
// webhooks are set in the app's settings instead (docs/launch-checklist.md).

export const ORDER_WEBHOOK_TOPICS = ["ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"] as const;

export const SHOP_CHECK_QUERY = `query CultRemixShopCheck {
  shop { name myshopifyDomain }
  publications(first: 20) { nodes { id name } }
  webhookSubscriptions(first: 100) { nodes { id topic uri } }
}`;

export const WEBHOOK_CREATE_MUTATION = `mutation CultRemixWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

export type ShopCheck = {
  shop: { name: string; myshopifyDomain: string };
  publications: { nodes: Array<{ id: string; name: string }> };
  webhookSubscriptions: { nodes: Array<{ id: string; topic: string; uri?: string | null }> };
};

export function shopifyWebhookUri(siteUrl: string) {
  return `${siteUrl.replace(/\/+$/u, "")}/webhooks/shopify`;
}

// The order topics not yet subscribed to this deployment's endpoint.
export function missingTopics(existing: ShopCheck["webhookSubscriptions"]["nodes"], uri: string) {
  return ORDER_WEBHOOK_TOPICS.filter((topic) => !existing.some((sub) => sub.topic === topic && sub.uri === uri));
}

