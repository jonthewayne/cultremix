import type { GarmentKind } from "../../../shared/config/print-products";
import type { PrintArea, RelativePlacement } from "~/lib/print/shirtPlacement";
import { GarmentPreview, useImageAspect } from "~/components/publish/GarmentPreview";
import { garmentLabel, garmentTones } from "~/lib/print/garmentMockup";
import { toInches } from "~/lib/print/shirtPlacement";

// On the work page: the picked style drawn in the picked color, with the design at the size and on
// the side its creator chose, so buyers see how big it prints and where.
export function OnTheShirt({
  kind,
  placement,
  printArea,
  hex,
  artUrl,
}: {
  kind: GarmentKind;
  placement: RelativePlacement;
  printArea: PrintArea;
  hex: string;
  artUrl?: string;
}) {
  const aspect = useImageAspect(artUrl);
  const inches = toInches(placement, aspect, printArea);
  return (
    <div className="flex items-center gap-4">
      <div className="h-28 w-28 shrink-0 rounded-2xl p-1" style={{ background: garmentTones(hex).backdrop }}>
        <GarmentPreview kind={kind} hex={hex} imageUrl={artUrl} aspect={aspect} placement={inches} area={printArea} showArea={false} />
      </div>
      <p className="text-sm text-muted-foreground">
        {placement.side === "back" ? "Printed on the back" : "Printed on the front"} of the {garmentLabel(kind).toLowerCase()}, about{" "}
        {Math.round(inches.widthIn)} inches wide on a large.
      </p>
    </div>
  );
}

