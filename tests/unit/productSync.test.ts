import { describe, expect, it } from "vitest";
import {
  buildProductSetInput,
  crNumber,
  matchVariants,
  productHandle,
  productTitle,
  syncProduct,
  variantList,
  variantSku,
} from "../../convex/lib/shopify/productSync";
import { createShopifyAdmin } from "../../convex/lib/shopify/adminClient";
import { PRINT_COLORS, PRINT_SIZES } from "../../shared/config/print-products";

describe("product naming", () => {
  it("formats handle, title, and SKU", () => {
    const cr = crNumber(101, 1);
    expect(cr).toBe("101-001");
    expect(productHandle(cr)).toBe("cr-101-001");
    expect(productTitle(cr, "Night Swim")).toBe("CR 101-001 · Night Swim");
    expect(productTitle(cr)).toBe("CR 101-001");
    expect(variantSku(cr, "BLACK", "2XL")).toBe("CR-101-001-BLACK-2XL");
  });
});

describe("variantList", () => {
  it("is the full 4 colors x S-2XL list with 2XL at $39", () => {
    const list = variantList("101-001");
    expect(PRINT_COLORS).toHaveLength(4);
    expect(list).toHaveLength(20);
    expect(new Set(list.map((v) => v.sku)).size).toBe(20);
    for (const color of PRINT_COLORS) {
      expect(list.filter((v) => v.color === color.code).map((v) => v.size)).toEqual([...PRINT_SIZES]);
    }
    expect(list.filter((v) => v.size === "2XL").every((v) => v.priceCents === 3900)).toBe(true);
    expect(list.filter((v) => v.size !== "2XL").every((v) => v.priceCents === 3600)).toBe(true);
    expect(list[0].sku).toBe(`CR-101-001-${PRINT_COLORS[0].code}-S`);
  });
});

describe("buildProductSetInput", () => {
  const input = buildProductSetInput({ workId: "w123", cr: "101-001", title: "Night Swim" });

  it("sends every variant, untracked, CONTINUE, with prices as strings", () => {
    expect(input.handle).toBe("cr-101-001");
    expect(input.title).toBe("CR 101-001 · Night Swim");
    expect(input.variants).toHaveLength(20);
    expect(input.productOptions.map((o) => o.name)).toEqual(["Color", "Size"]);
    for (const variant of input.variants) {
      expect(variant.inventoryItem.tracked).toBe(false);
      expect(variant.inventoryPolicy).toBe("CONTINUE");
      expect(variant.inventoryItem.sku).toMatch(/^CR-101-001-[A-Z]+-(S|M|L|XL|2XL)$/u);
    }
    const large = input.variants.find((v) => v.inventoryItem.sku.endsWith("-2XL"))!;
    expect(large.price).toBe("39.00");
    expect(input.variants[0].price).toBe("36.00");
  });

  it("points back to the work with metafields", () => {
    expect(input.metafields).toEqual([
      { namespace: "cultremix", key: "work_id", type: "single_line_text_field", value: "w123" },
      { namespace: "cultremix", key: "cr_number", type: "single_line_text_field", value: "101-001" },
    ]);
    expect("files" in input).toBe(false);
  });

  it("adds images when given", () => {
    const withImages = buildProductSetInput({ workId: "w", cr: "101-002", imageUrls: ["https://media/a.png"] });
    expect(withImages.files).toEqual([{ originalSource: "https://media/a.png", contentType: "IMAGE", alt: "CR 101-002" }]);
  });
});

function variantNodes(cr: string) {
  return variantList(cr).map((v, i) => ({
    id: `gid://shopify/ProductVariant/${1000 + i}`,
    sku: v.sku,
    selectedOptions: [
      { name: "Color", value: v.colorName },
      { name: "Size", value: v.size },
    ],
  }));
}

describe("matchVariants", () => {
  it("maps by SKU, or by options when SKU is missing", () => {
    const nodes = variantNodes("101-001").map((n, i) => (i === 3 ? { ...n, sku: null } : n));
    const matched = matchVariants("101-001", nodes);
    expect(matched).toHaveLength(20);
    expect(matched[3].shopifyVariantId).toBe("gid://shopify/ProductVariant/1003");
  });

  it("refuses an incomplete list", () => {
    expect(() => matchVariants("101-001", variantNodes("101-001").slice(1))).toThrow(/did not return/u);
  });
});

describe("syncProduct", () => {
  it("sets the product by handle and publishes it to Headless", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchFake = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/admin/oauth/access_token")) {
        return Response.json({ access_token: "tok", expires_in: 86399 });
      }
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query.includes("productSet")) {
        return Response.json({
          data: {
            productSet: {
              product: { id: "gid://shopify/Product/9", handle: "cr-101-001", variants: { nodes: variantNodes("101-001") } },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("publications")) {
        return Response.json({ data: { publications: { nodes: [{ id: "gid://shopify/Publication/1", name: "Online Store" }, { id: "gid://shopify/Publication/2", name: "Headless" }] } } });
      }
      return Response.json({ data: { publishablePublish: { userErrors: [] } } });
    };
    let stored: { accessToken: string; expiresAt: number } | null = null;
    const admin = createShopifyAdmin({
      config: { shopDomain: "cultremix-dev.myshopify.com", clientId: "id", clientSecret: "secret" },
      fetch: fetchFake,
      tokenStore: { get: async () => stored, set: async (t) => void (stored = t) },
    });
    const result = await syncProduct(admin, { workId: "w1", cr: "101-001", title: "Night Swim" });
    expect(result.productId).toBe("gid://shopify/Product/9");
    expect(result.variants).toHaveLength(20);
    const productCall = JSON.parse(calls[1].body) as { variables: { identifier: { handle: string }; input: { variants: Array<unknown> } } };
    expect(productCall.variables.identifier).toEqual({ handle: "cr-101-001" });
    expect(productCall.variables.input.variants).toHaveLength(20);
    const publish = JSON.parse(calls[3].body) as { variables: { input: Array<{ publicationId: string }> } };
    expect(publish.variables.input).toEqual([{ publicationId: "gid://shopify/Publication/2" }]);
    expect(calls[1].url).toBe("https://cultremix-dev.myshopify.com/admin/api/2026-07/graphql.json");
  });

  it("surfaces productSet userErrors", async () => {
    const admin = createShopifyAdmin({
      config: { shopDomain: "s.myshopify.com", clientId: "id", clientSecret: "secret" },
      fetch: async (url) =>
        url.endsWith("access_token")
          ? Response.json({ access_token: "tok", expires_in: 86399 })
          : Response.json({ data: { productSet: { product: null, userErrors: [{ message: "Handle taken" }] } } }),
      tokenStore: { get: async () => null, set: async () => {} },
    });
    await expect(syncProduct(admin, { workId: "w", cr: "101-001" })).rejects.toThrow(/Handle taken/u);
  });
});
