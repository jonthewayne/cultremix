import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";

export const {
  handler,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthReactStart({
  convexUrl: process.env.VITE_CONVEX_URL!,
  convexSiteUrl: process.env.VITE_CONVEX_SITE_URL!,
});

const SESSION_COOKIE = /^(?:__Secure-)?better-auth\.session_token=/;

// Gets this request's one-hour Convex token, like the library's getToken. Better Auth renews
// the session at most once a day during this call and answers with a renewed session cookie.
// getToken drops that cookie, so only the database moved and the browser's cookie still ran
// out 400 days after sign-in however often someone came back. Passing it on keeps both sliding.
export async function getTokenAndRenewSession(): Promise<string | null> {
  const { getRequestHeaders, getResponseHeaders } = await import("@tanstack/react-start/server");
  const siteUrl = process.env.VITE_CONVEX_SITE_URL!.replace(/\/+$/, "");
  const headers = new Headers(getRequestHeaders());
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("accept-encoding", "identity");
  headers.set("host", new URL(siteUrl).host);
  const response = await fetch(`${siteUrl}/api/auth/convex/token`, { headers });
  for (const cookie of response.headers.getSetCookie()) {
    if (SESSION_COOKIE.test(cookie)) getResponseHeaders().append("set-cookie", cookie);
  }
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { token?: string } | null;
  return data?.token ?? null;
}
