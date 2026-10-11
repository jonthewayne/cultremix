import { createFileRoute, redirect } from "@tanstack/react-router";

// The starter's workspace dashboard (organizations and resources) isn't part of CultRemix; a
// member's home is the studio, so an old link or a typed /dashboard lands there.
export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/studio", replace: true });
  },
});

