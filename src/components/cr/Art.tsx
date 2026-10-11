import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { useFadeIn } from "~/hooks/use-fade-in";
import { isPreloaded } from "~/lib/imagePreload";
import { cn } from "~/lib/utils";

// Renders a stored image, or a drawn placeholder for the dev stand-in ("fake:" keys). With
// fullUrl, it shows url (a smaller copy) first and switches to fullUrl once that has loaded, or
// starts with fullUrl when it was already loaded ahead. instant skips the fade in (the viewer,
// where paging should land on a drawn design).
export function Art({
  url,
  fullUrl,
  alt,
  className,
  instant = false,
  smallUrl,
  sizes,
  priority = false,
}: {
  url?: string;
  fullUrl?: string;
  alt: string;
  className?: string;
  instant?: boolean;
  // A smaller copy (the 400 px thumb beside url's 1200 px medium) and how wide the image shows, so
  // the browser picks the smallest that's sharp enough (a feed square on a phone needs the thumb).
  smallUrl?: string;
  sizes?: string;
  // The page's largest image: fetched first, and never lazily.
  priority?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  // Art on the server-rendered page shows as soon as it loads; art that mounts later fades in.
  const fadeIn = useFadeIn();
  const imgRef = useRef<HTMLImageElement>(null);
  // A server-rendered image can finish loading before React hydrates and attaches onLoad, so
  // check once on mount; otherwise it would stay invisible.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  const [upgraded, setUpgraded] = useState<string | null>(() => (fullUrl && isPreloaded(fullUrl) ? fullUrl : null));
  useEffect(() => {
    if (!fullUrl || fullUrl === url || fullUrl.startsWith("fake:") || upgraded === fullUrl) return;
    let live = true;
    const full = new Image();
    full.onload = () => {
      if (live) setUpgraded(fullUrl);
    };
    full.src = fullUrl;
    return () => {
      live = false;
    };
  }, [url, fullUrl, upgraded]);
  if (!url) return null;
  if (url.startsWith("fake:")) return <FakeArt seed={url} className={className} />;
  const src = upgraded && upgraded === fullUrl ? upgraded : url;
  // Two widths when there's a small copy (and no full-size upgrade in play); otherwise just src.
  const choices =
    smallUrl && sizes && !upgraded && !smallUrl.startsWith("fake:")
      ? { srcSet: `${smallUrl} ${SMALL_WIDTH}w, ${src} ${MEDIUM_WIDTH}w`, sizes }
      : {};
  const loading = priority ? ({ fetchPriority: "high" } as const) : ({ loading: "lazy" } as const);
  if (instant) return <img src={src} alt={alt} draggable={false} decoding="sync" className={className} />;
  if (!fadeIn) return <img src={src} {...choices} {...loading} alt={alt} draggable={false} className={className} />;
  return (
    <m.img
      ref={imgRef}
      src={src}
      {...choices}
      {...loading}
      alt={alt}
      draggable={false}
      className={className}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={loaded ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      onLoad={() => setLoaded(true)}
    />
  );
}

// The widths of the copies beside every original (convex/lib/sizes.ts SIZES).
const SMALL_WIDTH = 400;
const MEDIUM_WIDTH = 1200;

function FakeArt({ seed, className }: { seed: string; className?: string }) {
  let hue = 0;
  for (const char of seed) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return (
    <svg viewBox="0 0 1024 1536" className={cn(className)} role="img" aria-label="Dev placeholder design">
      <circle cx="512" cy="640" r="340" fill={`hsl(${hue} 80% 50%)`} />
      <rect x="232" y="1000" width="560" height="150" fill={`hsl(${(hue + 180) % 360} 70% 30%)`} />
      <text x="512" y="1110" textAnchor="middle" fontSize="110" fontWeight="900" fill="#fff" fontFamily="Inter, Arial">
        DEV
      </text>
    </svg>
  );
}
