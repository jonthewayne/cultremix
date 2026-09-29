import { ConvexClient } from "convex/browser";

let client: ConvexClient | null = null;

export function getPreauthClient() {
  if (!client) {
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) throw new Error("VITE_CONVEX_URL is not set");
    client = new ConvexClient(url);
  }
  return client;
}
