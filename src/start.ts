import { createMiddleware, createStart } from "@tanstack/react-start";

// Security headers on every page, server route, and server function response the Worker makes
// (TanStack Start reads this file at startup). Another site can't frame CultRemix (clickjacking),
// browsers don't guess file types, other sites see only our origin as the referrer, and pages can't
// ask for the camera, microphone, or location. The Content-Security-Policy sets only framing, the
// base URL, and plugins: limiting scripts, styles, images, and connections would need every
// Convex, R2, and Shopify origin listed and tested first. HSTS goes out only on cultremix.com, so
// a dev host on the tailnet isn't pinned to HTTPS, and leaves subdomains out: a year is hard to take
// back, and a subdomain pointed at another service later shouldn't inherit it.
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
const HSTS = "max-age=31536000";

export function securityHeadersFor(url: string): Record<string, string> {
  const host = new URL(url).hostname;
  const ours = host === "cultremix.com" || host.endsWith(".cultremix.com");
  return ours ? { ...SECURITY_HEADERS, "Strict-Transport-Security": HSTS } : SECURITY_HEADERS;
}

const securityHeaders = createMiddleware().server(async ({ request, next }) => {
  const result = await next();
  const headers = securityHeadersFor(request.url);
  try {
    for (const [name, value] of Object.entries(headers)) result.response.headers.set(name, value);
    return result;
  } catch {
    // A response with immutable headers: copy it with the headers added.
    const copy = new Response(result.response.body, result.response);
    for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
    return { ...result, response: copy };
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders],
}));
