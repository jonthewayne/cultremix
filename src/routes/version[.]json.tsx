import { createFileRoute } from "@tanstack/react-router";
import { BUILD_ID } from "~/lib/buildVersion";

// Which build is live: the git commit it was built from. Open tabs read it to notice a deploy
// (src/lib/buildVersion.ts), and Ops can check what they deployed. Never cached.
export const Route = createFileRoute("/version.json")({
  server: {
    handlers: {
      GET: () => Response.json({ build: BUILD_ID }, { headers: { "cache-control": "no-store" } }),
    },
  },
});
