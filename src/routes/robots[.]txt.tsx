import { createFileRoute } from "@tanstack/react-router";
import { ROBOTS_TXT } from "~/lib/sitemap";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => new Response(ROBOTS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } }),
    },
  },
});

