import { economicsConfigFile } from "../../convex/lib/economicsConfigs";

// GET /economics/<file>: the published config's exact canonical bytes, or 404.
export function economicsConfigResponse(file: string): Response {
  const found = economicsConfigFile(file);
  if (!found) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(found.json, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
