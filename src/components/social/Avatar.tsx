import { useState } from "react";
import { cn } from "~/lib/utils";

// A member's picture, or the first letter of their name on black.
export function Avatar({ username, image, className }: { username: string; image?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initial = username.replace(/^@/u, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "@container relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-black font-black text-white",
        className,
      )}
    >
      {image && !broken ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden className="text-[50cqw] leading-none">
          {initial}
        </span>
      )}
    </span>
  );
}
