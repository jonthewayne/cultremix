import { useEffect } from "react";
import { REF_COOKIE, REF_COOKIE_MAX_AGE_SECONDS } from "../../shared/config/shopify";

// First-touch referral: the first ?ref= a visitor arrives with is kept for 30 days and goes onto
// their Shopify cart as the _ref attribute when the cart is created.

const REF_PATTERN = /^[a-z0-9_-]{1,40}$/iu;

export function validRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && REF_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function refCookieToSet(search: string, cookieHeader: string, secure: boolean): string | null {
  if (new RegExp(`(?:^|;\\s*)${REF_COOKIE}=`, "u").test(cookieHeader)) return null;
  const ref = validRef(new URLSearchParams(search).get("ref"));
  if (!ref) return null;
  return [`${REF_COOKIE}=${ref}`, "Path=/", "SameSite=Lax", `Max-Age=${REF_COOKIE_MAX_AGE_SECONDS}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function useCaptureRef() {
  useEffect(() => {
    const cookie = refCookieToSet(window.location.search, document.cookie, window.location.protocol === "https:");
    if (cookie) document.cookie = cookie;
  }, []);
}
