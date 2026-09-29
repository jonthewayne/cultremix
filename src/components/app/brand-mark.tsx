import { GalleryVerticalEnd } from "lucide-react";
import { cn } from "~/lib/utils";

export function BrandMark({
  className,
  showName = true,
}: {
  className?: string;
  showName?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <GalleryVerticalEnd className="size-4" />
      </span>
      {showName && <span>CultRemix</span>}
    </span>
  );
}
