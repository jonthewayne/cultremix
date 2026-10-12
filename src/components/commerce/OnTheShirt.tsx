import type { GarmentKind } from "../../../shared/config/print-products";
import type { PrintArea, RelativePlacement } from "~/lib/print/shirtPlacement";
import { ChestMarkPreview, GarmentPreview, useImageAspect } from "~/components/publish/GarmentPreview";
import { garmentLabel, garmentTones } from "~/lib/print/garmentMockup";
import { markPlacement, toInches } from "~/lib/print/shirtPlacement";

// On the work page: the picked style drawn in the picked color, with the design at the size and on
// the side its creator chose, so buyers see how big it prints and where, and a back print's chest
// mark on the front beside it.
export function OnTheShirt({
  kind,
  placement,
  printArea,
  markArea,
  hex,
  artUrl,
}: {
  kind: GarmentKind;
  placement: RelativePlacement;
  printArea: PrintArea;
  // The front print area, when the back print has a chest mark.
  markArea?: PrintArea;
  hex: string;
  artUrl?: string;
}) {
  const aspect = useImageAspect(artUrl);
  const inches = toInches(placement, aspect, printArea);
  const mark = placement.side === "back" && placement.mark !== undefined && markArea ? placement.mark : undefined;
  const markWidth = mark !== undefined && markArea ? markPlacement(mark, aspect, markArea).widthIn : null;
  return (
    <div className="flex items-center gap-4">
      <div className="h-28 w-28 shrink-0 rounded-2xl p-1" style={{ background: garmentTones(hex).backdrop }}>
        <GarmentPreview kind={kind} hex={hex} imageUrl={artUrl} aspect={aspect} placement={inches} area={printArea} showArea={false} />
      </div>
      {mark !== undefined && markArea && (
        <div className="-ml-2 h-20 w-20 shrink-0 rounded-2xl p-1" style={{ background: garmentTones(hex).backdrop }}>
          <ChestMarkPreview kind={kind} hex={hex} imageUrl={artUrl} aspect={aspect} markIn={mark} area={markArea} />
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {placement.side === "back" ? "Printed on the back" : "Printed on the front"} of the {garmentLabel(kind).toLowerCase()}, about{" "}
        {Math.round(inches.widthIn)} inches wide on a large
        {markWidth !== null ? `, with a ${Math.round(markWidth * 2) / 2}-inch one on the front chest.` : "."}
      </p>
    </div>
  );
}
