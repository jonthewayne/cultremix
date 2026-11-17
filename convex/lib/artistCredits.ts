// Outside artists a design credits (docs/decisions.md; convex/artists.ts). Pure: input checks, link
// matching, and page slugs, so they're tested without a database.

import { MAX_ARTIST_CREDITS } from "./economics";

export { MAX_ARTIST_CREDITS };
export const MAX_ARTIST_NAME = 60;
export const MAX_ARTIST_LINK = 300;

export type ArtistInput = { name: string; link: string };
export type CleanArtist = { name: string; link: string; key: string };

// A link as written, made a full https URL when it has no scheme ("instagram.com/jane").
export function normalizeLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || [...trimmed].length > MAX_ARTIST_LINK || /\s/u.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/iu.test(trimmed) ? trimmed : "https://" + trimmed;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

// Query parameters that only track or style a visit; they never say whose page it is.
const TRACKING = /^(?:utm_.*|hl|lang|locale|igshid|igsh|fbclid|gclid|si|ref|ref_src|ref_url|source|feature|s|t|mibextid)$/iu;

// Sites where many artists live: a link to one has to name the artist's own page (a path, or a
// profile id in the query), so "instagram.com" alone can't stand for anyone.
const SHARED_HOSTS = new Set([
  "instagram.com", "youtube.com", "youtu.be", "facebook.com", "x.com", "twitter.com", "tiktok.com", "behance.net",
  "dribbble.com", "pinterest.com", "tumblr.com", "deviantart.com", "artstation.com", "linktr.ee", "etsy.com",
  "threads.net", "bsky.app", "vimeo.com", "flickr.com", "reddit.com", "patreon.com", "substack.com", "medium.com",
]);

// What two links are compared by: host and path, lowercase, without www or a trailing slash, plus
// any query parameters other than tracking ones, sorted, values as written (a video's id is
// case-sensitive). "https://www.Instagram.com/Jane/?hl=en" and "instagram.com/jane" match;
// "youtube.com/watch?v=abc" and "youtube.com/watch?v=xyz" don't.
export function linkKey(link: string): string {
  const url = new URL(link);
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./u, "");
  const path = url.pathname.replace(/\/+$/u, "").toLowerCase();
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING.test(name))
    .map(([name, value]) => `${name.toLowerCase()}=${value}`)
    .sort();
  return host + path + (params.length > 0 ? "?" + params.join("&") : "");
}

// A link to a shared site's front page, which can't say who the artist is.
export function isBareSharedLink(link: string): boolean {
  const key = linkKey(link);
  return SHARED_HOSTS.has(key);
}

// The credits a creator or staff typed, cleaned: each needs a name and a link to the artist's
// work, at most three, and the same link twice counts once.
export function cleanArtistInputs(
  inputs: ReadonlyArray<ArtistInput>,
): { ok: true; artists: Array<CleanArtist> } | { ok: false; message: string } {
  const out: Array<CleanArtist> = [];
  for (const input of inputs) {
    const name = input.name.replace(/\s+/gu, " ").trim();
    const linkText = input.link.trim();
    if (!name && !linkText) continue;
    if (!name) return { ok: false, message: "Give each artist a name." };
    if ([...name].length > MAX_ARTIST_NAME) return { ok: false, message: `Keep each artist's name under ${MAX_ARTIST_NAME} characters.` };
    const link = normalizeLink(linkText);
    if (!link) return { ok: false, message: `Add a link to where ${name}'s work lives, like their site or Instagram.` };
    if (isBareSharedLink(link)) {
      return { ok: false, message: `Link to ${name}'s own page there, like instagram.com/theirname.` };
    }
    const key = linkKey(link);
    if (out.some((artist) => artist.key === key)) continue;
    out.push({ name, link, key });
  }
  if (out.length > MAX_ARTIST_CREDITS) return { ok: false, message: `Credit up to ${MAX_ARTIST_CREDITS} artists.` };
  return { ok: true, artists: out };
}

// "Jane Doe" -> "jane-doe"; letters and digits only, at most 40 characters.
export function slugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40)
    .replace(/-+$/u, "");
  return slug || "artist";
}

// The code a claimant posts where their work lives: "cultremix-" and six letters and digits.
export function claimCode(random: () => number = Math.random): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(random() * alphabet.length)];
  return "cultremix-" + code;
}
