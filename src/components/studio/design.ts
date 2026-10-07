import type { Id } from "../../../convex/_generated/dataModel";
import type { MenuItem } from "~/components/studio/StudioSessions";
import { designFilename, isTouchDevice, saveImage } from "~/lib/saveImage";

// One design in a batch, as the studio shows it.
export type Tile = {
  generationId: Id<"generations">;
  batchId: Id<"batches">;
  status: string;
  // The original (download, "Open full size") and the copies shown in the studio.
  url?: string;
  mediumUrl?: string;
  thumbUrl?: string;
  favorite: boolean;
  // Dismissed: hidden unless the member shows dismissed designs. Never deleted.
  rejected?: boolean;
  error?: string;
  blocked?: boolean;
  backgroundColor: string;
  publishedCr?: string;
  key?: string;
  // The original's size in pixels, when known.
  width?: number;
  height?: number;
  // The model that made it, on batches an admin made with another model.
  model?: string;
  // Kept just for the member: its private page.
  keptId?: string;
};

export const isFinished = (tile: Tile) => tile.status === "succeeded";
export const isFailed = (tile: Tile) =>
  tile.status === "failed" || tile.status === "unknown_outcome" || tile.status === "expired";

// The ⋯ menu's choices for a finished design.
export function designItems(
  tile: Tile,
  actions: {
    onOpen?: () => void;
    onPublish?: () => void;
    // A fresh prompt in the same session with this design as image 1 (nothing else carried over).
    onStartFrom?: () => void;
    // Choose what people who remix it may change, and try it as a remix.
    onRemixable?: () => void;
    // Adds the design to the images already there.
    onInspire: () => void;
    onStyle: () => void;
    onReject?: () => void;
  },
): Array<MenuItem> {
  const filename = designFilename(tile);
  const items: Array<MenuItem> = [];
  if (actions.onOpen) items.push({ label: "View large", onSelect: actions.onOpen });
  items.push({ label: isTouchDevice() ? "Save image" : "Download", onSelect: () => saveImage(tile.url, filename) });
  if (tile.url && !tile.url.startsWith("fake:")) items.push({ label: "Open full size", href: tile.url });
  if (tile.key) {
    if (actions.onStartFrom) items.push({ label: "Start from this", onSelect: actions.onStartFrom });
    items.push({ label: "Add as an image", onSelect: actions.onInspire });
    items.push({ label: "Use as style", onSelect: actions.onStyle });
  }
  const out = Boolean(tile.publishedCr || tile.keptId);
  if (!out && actions.onPublish) items.push({ label: "Publish", onSelect: actions.onPublish });
  if (tile.key && !out && actions.onRemixable) items.push({ label: "Make it remixable", onSelect: actions.onRemixable });
  if (actions.onReject) items.push({ label: tile.rejected ? "Bring back" : "Dismiss", onSelect: actions.onReject });
  return items;
}
