import { describe, expect, it } from "vitest";
import { PRINTFUL_WEBHOOK_EVENTS, areasFromPrintfiles, webhookConfig } from "../../convex/lib/printful/setup";
import { ORDER_WEBHOOK_TOPICS, missingTopics, shopifyWebhookUri } from "../../convex/lib/shopify/setup";

describe("Printful setup", () => {
  it("asks for every webhook the route handles, in one list", () => {
    expect(webhookConfig("https://vibrant-rook-798.convex.site/")).toEqual({
      default_url: "https://vibrant-rook-798.convex.site/webhooks/printful",
      events: PRINTFUL_WEBHOOK_EVENTS.map((type) => ({ type })),
    });
    expect(PRINTFUL_WEBHOOK_EVENTS).toContain("shipment_sent");
  });

  it("reads each placement's print area from its largest print file, in inches", () => {
    const areas = areasFromPrintfiles({
      product_id: 146,
      available_placements: { front: "Front print", back: "Back print", label_outside: "Outside label", sleeve_left: "Left sleeve" },
      printfiles: [
        { printfile_id: 1, width: 1650, height: 1650, dpi: 150 },
        { printfile_id: 2, width: 2100, height: 2100, dpi: 150 },
        { printfile_id: 3, width: 1800, height: 2400, dpi: 150 },
        { printfile_id: 4, width: 450, height: 450, dpi: 150 },
      ],
      variant_printfiles: [
        { variant_id: 10, placements: { front: 1, back: 3, label_outside: 4 } },
        { variant_id: 11, placements: { front: 2, back: 3, label_outside: 4 } },
      ],
    });
    // Small sizes print smaller (11 x 11 in); the largest (14 x 14 in) is the file to make.
    expect(areas).toEqual({
      front: { widthIn: 14, heightIn: 14 },
      back: { widthIn: 12, heightIn: 16 },
      placements: ["front", "back", "label_outside"],
    });
  });

  it("has no back when no variant prints one", () => {
    const areas = areasFromPrintfiles({
      available_placements: { front: "Front print" },
      printfiles: [{ printfile_id: 1, width: 3600, height: 4800, dpi: 300 }],
      variant_printfiles: [{ variant_id: 1, placements: { front: 1 } }],
    });
    expect(areas).toEqual({ front: { widthIn: 12, heightIn: 16 }, back: null, placements: ["front"] });
    expect(areasFromPrintfiles({})).toEqual({ front: null, back: null, placements: [] });
  });
});

describe("Shopify setup", () => {
  it("subscribes only the order topics this deployment doesn't have yet", () => {
    const uri = shopifyWebhookUri("https://savory-tiger-504.convex.site");
    expect(uri).toBe("https://savory-tiger-504.convex.site/webhooks/shopify");
    expect(missingTopics([], uri)).toEqual([...ORDER_WEBHOOK_TOPICS]);
    expect(
      missingTopics(
        [
          { id: "1", topic: "ORDERS_PAID", uri },
          { id: "2", topic: "ORDERS_CANCELLED", uri: "https://elsewhere.example/webhooks/shopify" },
        ],
        uri,
      ),
    ).toEqual(["ORDERS_CANCELLED", "REFUNDS_CREATE"]);
  });
});

