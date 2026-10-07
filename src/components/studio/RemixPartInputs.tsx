import { useRef } from "react";
import type { ImageState, Slot } from "~/components/studio/StudioInputs";
import { Art } from "~/components/cr/Art";
import { cn } from "~/lib/utils";

// A remix's remixable parts (convex/remixParts.ts forWork or forDesign): a character takes words to
// swap it for, or a photo; a person takes a photo of who should be them; a group takes a photo for
// each member, up to the creator's limit. The photos become the member's images, read like any
// other, and the server checks everything against the creator's rules.

export type PublicPart = {
  id: string;
  kind: "character" | "person" | "group";
  label: string;
  empty?: "keep" | "omit" | "require";
  count?: number;
  max?: number;
};
export type PartValue = { to: string; photos: Array<Slot> };

// What studio.generate takes: the parts the member filled in.
export function partEntries(parts: Array<PublicPart>, values: Record<string, PartValue>) {
  return parts.flatMap((part) => {
    const value = values[part.id];
    if (!value) return [];
    const to = part.kind === "character" ? value.to.trim() : "";
    const photos = value.photos.flatMap((slot) => (slot.imageId ? [slot.imageId] : []));
    return to || photos.length > 0 ? [{ partId: part.id, ...(to ? { to } : {}), photos }] : [];
  });
}

// People the creator asks a photo for, still without one.
export function missingPhotos(parts: Array<PublicPart>, values: Record<string, PartValue>) {
  return parts.filter((part) => part.kind === "person" && part.empty === "require" && !(values[part.id]?.photos.length ?? 0)).map((p) => p.label);
}

function hint(part: PublicPart) {
  if (part.kind === "character") return "Type what to swap it for, or add a photo.";
  if (part.kind === "person") {
    const without = part.empty === "omit" ? "Without one, they're left out." : part.empty === "require" ? "The creator asks for one." : "Without one, the original stays.";
    return `A photo of who should be ${part.label}. ${without}`;
  }
  const stay = part.count ? `With none, the original ${part.count} stay. ` : "";
  return `One photo for each. ${stay}Up to ${part.max ?? 6}.`;
}

function imageFiles(list: FileList | null | undefined) {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
}

export function RemixPartInputs({
  parts,
  values,
  states,
  onTo,
  onFiles,
  onRemovePhoto,
}: {
  parts: Array<PublicPart>;
  values: Record<string, PartValue>;
  states: Map<string, ImageState>;
  onTo: (partId: string, to: string) => void;
  onFiles: (partId: string, files: Array<File>) => void;
  onRemovePhoto: (partId: string, slotId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {parts.map((part) => (
        <PartRow
          key={part.id}
          part={part}
          value={values[part.id] ?? { to: "", photos: [] }}
          states={states}
          onTo={(to) => onTo(part.id, to)}
          onFiles={(files) => onFiles(part.id, files)}
          onRemovePhoto={(slotId) => onRemovePhoto(part.id, slotId)}
        />
      ))}
    </div>
  );
}

function PartRow({
  part,
  value,
  states,
  onTo,
  onFiles,
  onRemovePhoto,
}: {
  part: PublicPart;
  value: PartValue;
  states: Map<string, ImageState>;
  onTo: (to: string) => void;
  onFiles: (files: Array<File>) => void;
  onRemovePhoto: (slotId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const limit = part.kind === "group" ? (part.max ?? 6) : 1;
  const room = limit - value.photos.length;
  const missing = part.kind === "person" && part.empty === "require" && value.photos.length === 0;
  return (
    <div>
      <span className="text-sm font-bold uppercase tracking-wider">{part.label}</span>
      <p className={cn("text-xs", missing ? "font-semibold text-red-600" : "text-neutral-500")}>{hint(part)}</p>
      {part.kind === "character" && (
        <input
          value={value.to}
          onChange={(e) => onTo(e.target.value)}
          maxLength={120}
          placeholder={`Swap ${part.label.toLowerCase()} for…`}
          aria-label={`Swap ${part.label} for`}
          className={cn(
            "mt-1 w-full border-b-2 bg-transparent py-1 text-xl font-semibold leading-tight outline-none md:text-2xl",
            value.to.trim() ? "border-black" : "border-neutral-300 focus:border-black",
          )}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {value.photos.map((slot, i) => {
          const reading = slot.uploading || (slot.imageId ? states.get(slot.imageId)?.analysis === "pending" : true);
          return (
            <div key={slot.id} className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border-2 border-black bg-neutral-100">
              {slot.previewUrl.startsWith("fake:") ? (
                <Art url={slot.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <img src={slot.previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              )}
              {part.kind === "group" && (
                <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-black text-white">{i + 1}</span>
              )}
              <button
                type="button"
                onClick={() => onRemovePhoto(slot.id)}
                className="group absolute right-0 top-0 flex h-9 w-9 items-center justify-center"
                aria-label={`Remove photo ${i + 1} from ${part.label}`}
              >
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-black ring-1 ring-black group-hover:bg-black group-hover:text-white">
                  ×
                </span>
              </button>
              {reading && <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1 text-[9px] font-bold text-white">Reading…</span>}
            </div>
          );
        })}
        {room > 0 && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-20 min-w-20 items-center justify-center rounded-xl border-2 border-dashed border-black px-3 text-sm font-bold hover:bg-neutral-50"
          >
            + {part.kind === "group" ? (value.photos.length === 0 ? "Add photos" : "Add one") : "Photo"}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple={part.kind === "group"}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          onFiles(imageFiles(e.target.files).slice(0, Math.max(0, room)));
          e.target.value = "";
        }}
      />
    </div>
  );
}
