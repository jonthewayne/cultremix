import { ConvexClient, ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";

let client: ConvexClient | null = null;

export function getPreauthClient() {
  if (!client) {
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) throw new Error("VITE_CONVEX_URL is not set");
    client = new ConvexClient(url);
  }
  return client;
}

// A one-shot public read for pre-auth pages. Unlike the live client above, it works in route
// loaders on the server as well as in the browser, so a page can render the right text at once.
export async function preauthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgs<Query>
): Promise<FunctionReturnType<Query>> {
  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) throw new Error("VITE_CONVEX_URL is not set");
  return await new ConvexHttpClient(url).query(query, ...args);
}
