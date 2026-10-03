import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

// Renders a stored image, or a drawn placeholder for the dev stand-in ("fake:" keys). With
// fullUrl, it shows url (a smaller copy) first and switches to fullUrl once that has loaded.
export function Art({
  url,
  fullUrl,
  alt,
  className,
}: {
  url?: string;
  fullUrl?: string;
  alt: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [upgraded, setUpgraded] = useState<string | null>(null);
  useEffect(() => {
    if (!fullUrl || fullUrl === url || fullUrl.startsWith("fake:")) return;
    let live = true;
    const full = new Image();
    full.onload = () => {
      if (live) setUpgraded(fullUrl);
    };
    full.src = fullUrl;
    return () => {
      live = false;
    };
  }, [url, fullUrl]);
  if (!url) return null;
  if (url.startsWith("fake:")) return <FakeArt seed={url} className={className} />;
  return (
    <motion.img
      src={upgraded && upgraded === fullUrl ? upgraded : url}
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
