import { redirect } from "@tanstack/react-router";
import { sanitizeRedirect } from "~/lib/sanitize-redirect";

type AuthRouteGuardArgs = {
  context: {
    isAuthenticated?: boolean;
  };
  location: {
    href?: string;
    pathname?: string;
    searchStr?: string;
  };
};

export function requireAuthenticatedRoute({
  context,
  location,
}: AuthRouteGuardArgs) {
  if (context.isAuthenticated) return;

  const requestedPath =
    location.href ?? `${location.pathname ?? "/studio"}${location.searchStr ?? ""}`;

  throw redirect({
    to: "/login",
    search: { redirect: sanitizeRedirect(requestedPath) },
    replace: true,
  });
}
