import type { PrintfulPrintfiles, PrintfulWebhookConfig } from "./client";

// Setting up a Printful store from Admin (convex/integrations.ts and convex/merch.ts): the
// webhooks CultRemix handles (convex/lib/printful/webhookRoute.ts), and print areas read from
// Printful's print files.

// The events the webhook route applies. Printful's webhook setup replaces the whole list, so all
// of them go in one call.
export const PRINTFUL_WEBHOOK_EVENTS = [
  "order_created",
  "order_updated",
  "order_failed",
  "order_canceled",
  "order_put_hold",
  "order_remove_hold",
  "shipment_sent",
] as const;

export function webhookConfig(siteUrl: string): PrintfulWebhookConfig {
  return {
    default_url: `${siteUrl.replace(/\/+$/u, "")}/webhooks/printful`,
    events: PRINTFUL_WEBHOOK_EVENTS.map((type) => ({ type })),
  };
}

export type AreaInches = { widthIn: number; heightIn: number };
export type CheckedAreas = { front: AreaInches | null; back: AreaInches | null; placements: Array<string> };

const round2 = (n: number) => Math.round(n * 100) / 100;

// Each placement's print area: the largest print file any variant uses there (Printful scales a
// print down for smaller sizes), in inches at the file's DPI. A placement no variant uses has none.
export function areasFromPrintfiles(result: PrintfulPrintfiles): CheckedAreas {
  const files = new Map((result.printfiles ?? []).map((file) => [file.printfile_id, file]));
  const largest = (placement: string): AreaInches | null => {
    let best: AreaInches | null = null;
    for (const variant of result.variant_printfiles ?? []) {
      const file = files.get(variant.placements[placement]);
      if (!file || !(file.dpi > 0) || !(file.width > 0) || !(file.height > 0)) continue;
      const area = { widthIn: round2(file.width / file.dpi), heightIn: round2(file.height / file.dpi) };
      if (!best || area.widthIn * area.heightIn > best.widthIn * best.heightIn) best = area;
    }
    return best;
  };
  const used = new Set((result.variant_printfiles ?? []).flatMap((variant) => Object.keys(variant.placements)));
  return {
    front: largest("front"),
    back: largest("back"),
    placements: Object.keys(result.available_placements ?? {}).filter((placement) => used.has(placement)),
  };
}

