import { SHARE_IMAGE, SHARE_IMAGE_ALT, SITE_NAME, SITE_URL } from "./site";

// What a link preview shows. Loaders build one from the data they already fetched; heads turn it
// into Open Graph and Twitter card tags, which override the root's defaults tag by tag.
export type ShareCard = {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
  // "summary_large_image" for designs and the site card; "summary" for a square avatar.
  card: "summary" | "summary_large_image";
  type: "website" | "profile";
  username?: string;
};

type WorkLike = {
  cr: string;
  title?: string;
  creator: { username: string };
  artUrl?: string;
  artMediumUrl?: string;
  parentCr?: string;
};

type ProfileLike = { username: string; bio?: string; image?: string; creatorNumber?: number };

// Crawlers need absolute image addresses. Site paths get the public origin; anything else that
// isn't a web address (a dev placeholder, say) gets nothing.
export function absoluteUrl(url: string | undefined) {
  if (!url) return undefined;
  if (/^https?:\/\//iu.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${SITE_URL}${url}`;
  return undefined;
}

export function workShareCard(item: WorkLike): ShareCard {
  const name = `CR ${item.cr}`;
  const by = `@${item.creator.username}`;
  const image = absoluteUrl(item.artMediumUrl) ?? absoluteUrl(item.artUrl);
  const lead = item.parentCr ? `A remix of CR ${item.parentCr} by ${by}.` : `A design by ${by}.`;
  return {
    title: item.title ? `${name} · ${item.title}` : name,
    description: `${lead} Wear it, share it, or remix it on ${SITE_NAME}.`,
    url: `${SITE_URL}/cr/${encodeURIComponent(item.cr)}`,
    image: image ?? SHARE_IMAGE,
    imageAlt: image ? `${item.title ?? name} by ${by}` : SHARE_IMAGE_ALT,
    card: "summary_large_image",
    type: "website",
  };
}

export function profileShareCard(profile: ProfileLike): ShareCard {
  const handle = `@${profile.username}`;
  const avatar = absoluteUrl(profile.image);
  return {
    title: profile.creatorNumber === undefined ? handle : `${handle} · Creator № ${profile.creatorNumber}`,
    description: profile.bio || `See what ${handle} is making on ${SITE_NAME}.`,
    url: `${SITE_URL}/u/${encodeURIComponent(profile.username)}`,
    image: avatar ?? SHARE_IMAGE,
    imageAlt: avatar ? handle : SHARE_IMAGE_ALT,
    card: avatar ? "summary" : "summary_large_image",
    type: "profile",
    username: profile.username,
  };
}

type FamilyLike = { family: number; designs: number; startedBy?: string; image?: string; imageTitle?: string };

export function familyShareCard(family: FamilyLike): ShareCard {
  const name = `Family ${family.family}`;
  const image = absoluteUrl(family.image);
  const count = `${family.designs} ${family.designs === 1 ? "design" : "designs"}`;
  const by = family.startedBy ? `, started by @${family.startedBy}` : "";
  return {
    title: name,
    description: `${count}${by}. See every variation and fork on ${SITE_NAME}.`,
    url: `${SITE_URL}/family/${family.family}`,
    image: image ?? SHARE_IMAGE,
    imageAlt: image ? (family.imageTitle ?? name) : SHARE_IMAGE_ALT,
    card: "summary_large_image",
    type: "website",
  };
}

// A page without a card of its own: its title and address over the site card, so a shared link
// doesn't preview as the home page.
export function pageMeta(title: string, path: string, description?: string) {
  return [
    { title: `${title} · ${SITE_NAME}` },
    { property: "og:url", content: `${SITE_URL}${path}` },
    { property: "og:title", content: title },
    { name: "twitter:title", content: title },
    ...(description
      ? [
          { name: "description", content: description },
          { property: "og:description", content: description },
          { name: "twitter:description", content: description },
        ]
      : []),
  ];
}

export function shareMeta(card: ShareCard) {
  return [
    { title: `${card.title} · ${SITE_NAME}` },
    { name: "description", content: card.description },
    { property: "og:type", content: card.type },
    { property: "og:url", content: card.url },
    { property: "og:title", content: card.title },
    { property: "og:description", content: card.description },
    { property: "og:image", content: card.image },
    { property: "og:image:alt", content: card.imageAlt },
    ...(card.username ? [{ property: "profile:username", content: card.username }] : []),
    { name: "twitter:card", content: card.card },
    { name: "twitter:title", content: card.title },
    { name: "twitter:description", content: card.description },
    { name: "twitter:image", content: card.image },
    { name: "twitter:image:alt", content: card.imageAlt },
  ];
}
