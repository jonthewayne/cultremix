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
import { launchShopProduct, listingFor } from "../../convex/lib/shopProduct";
import { PRINT_SIZES } from "../../shared/config/print-products";
import { DEFAULT_PLACEMENT } from "../../src/lib/print/shirtPlacement";

// The launch shirt in the launch colors, front print: 4 colors x S-2XL.
const LAUNCH = listingFor({ offeredColors: undefined }, launchShopProduct(), DEFAULT_PLACEMENT);
const NAME = LAUNCH.name;

describe("product naming", () => {
  it("formats handle, title, and SKU with the product", () => {
    const cr = crNumber(101, 1);
    expect(cr).toBe("101-001");
    expect(productHandle(cr, 586)).toBe("cr-101-001-586");
    expect(productHandle(cr)).toBe("cr-101-001");
    expect(productTitle(cr, "Night Swim", "Hoodie")).toBe("CR 101-001 · Night Swim · Hoodie");
    expect(productTitle(cr)).toBe("CR 101-001");
    expect(variantSku(cr, "BLACK", "2XL", 586)).toBe("CR-101-001-586-BLACK-2XL");
    expect(variantSku(cr, "BLACK", "2XL")).toBe("CR-101-001-BLACK-2XL");
  });
});

describe("variantList", () => {
  it("is every listed color x S-2XL, with 2XL at the 2XL price", () => {
    const list = variantList("101-001", LAUNCH);
    expect(LAUNCH.colors.map((c) => c.code)).toEqual(["WHITE", "IVORY", "PEPPER", "BLACK"]);
    expect(list).toHaveLength(20);
    expect(new Set(list.map((v) => v.sku)).size).toBe(20);
    for (const color of LAUNCH.colors) {
      expect(list.filter((v) => v.color === color.code).map((v) => v.size)).toEqual([...PRINT_SIZES]);
    }
    expect(list.filter((v) => v.size === "2XL").every((v) => v.priceCents === 3900)).toBe(true);
    expect(list.filter((v) => v.size !== "2XL").every((v) => v.priceCents === 3600)).toBe(true);
    expect(list[0].sku).toBe("CR-101-001-586-WHITE-S");
  });

  it("lists only the colors the product carries, in the creator's order", () => {
    const listing = listingFor({ offeredColors: ["true-navy", "moss", "butter"] }, launchShopProduct(), DEFAULT_PLACEMENT);
    const list = variantList("101-001", listing);
    expect(list).toHaveLength(10);
    expect(list.map((v) => v.sku).slice(0, 2)).toEqual(["CR-101-001-586-TRUENAVY-S", "CR-101-001-586-TRUENAVY-M"]);
    expect(list[5]).toMatchObject({ color: "BUTTER", colorName: "Butter", size: "S", printfulVariantId: 15166 });
  });

  it("skips sizes a color doesn't come in", () => {
    const listing = { ...LAUNCH, colors: [{ ...LAUNCH.colors[0], variants: LAUNCH.colors[0].variants.filter((v) => v.size !== "2XL") }] };
    expect(variantList("101-001", listing).map((v) => v.size)).toEqual(["S", "M", "L", "XL"]);
  });

  it("prices a back print with the product's back extra", () => {
    const back = listingFor({ offeredColors: undefined }, launchShopProduct(), { ...DEFAULT_PLACEMENT, side: "back" });
    expect(back.priceCents).toBe(3600 + launchShopProduct().backExtraCents);
    expect(variantList("101-001", back).find((v) => v.size === "2XL")?.priceCents).toBe(3900 + launchShopProduct().backExtraCents);
  });
});

describe("buildProductSetInput", () => {
  const input = buildProductSetInput({ workId: "w123", cr: "101-001", title: "Night Swim", listing: LAUNCH });

  it("sends every variant, untracked, CONTINUE, with prices as strings", () => {
    expect(input.handle).toBe("cr-101-001-586");
    expect(input.title).toBe(`CR 101-001 · Night Swim · ${NAME}`);
    expect(input.productType).toBe("T-shirt");
    expect(input.variants).toHaveLength(20);
    expect(input.productOptions.map((o) => o.name)).toEqual(["Color", "Size"]);
    for (const variant of input.variants) {
      expect(variant.inventoryItem.tracked).toBe(false);
      expect(variant.inventoryPolicy).toBe("CONTINUE");
      expect(variant.inventoryItem.sku).toMatch(/^CR-101-001-586-[A-Z]+-(S|M|L|XL|2XL)$/u);
    }
    const large = input.variants.find((v) => v.inventoryItem.sku.endsWith("-2XL"))!;
    expect(large.price).toBe("39.00");
    expect(input.variants[0].price).toBe("36.00");
  });

  it("points back to the work and the product with metafields", () => {
    expect(input.metafields).toEqual([
      { namespace: "cultremix", key: "work_id", type: "single_line_text_field", value: "w123" },
      { namespace: "cultremix", key: "cr_number", type: "single_line_text_field", value: "101-001" },
      { namespace: "cultremix", key: "printful_product", type: "single_line_text_field", value: "586" },
    ]);
    expect("files" in input).toBe(false);
  });

  it("names the Color option values after the listing's colors", () => {
    const listing = listingFor({ offeredColors: ["blue-jean", "ivory"] }, launchShopProduct(), DEFAULT_PLACEMENT);
    const offered = buildProductSetInput({ workId: "w", cr: "101-003", listing });
    expect(offered.productOptions[0]).toEqual({ name: "Color", values: [{ name: "Blue Jean" }, { name: "Ivory" }] });
    expect(offered.variants).toHaveLength(10);
    expect(offered.variants[0].optionValues).toEqual([
      { optionName: "Color", name: "Blue Jean" },
      { optionName: "Size", name: "S" },
    ]);
  });

  it("adds images when given", () => {
    const withImages = buildProductSetInput({ workId: "w", cr: "101-002", imageUrls: ["https://media/a.png"], listing: LAUNCH });
    expect(withImages.files).toEqual([{ originalSource: "https://media/a.png", contentType: "IMAGE", alt: `CR 101-002 · ${NAME}` }]);
  });
});

function variantNodes(cr: string) {
  return variantList(cr, LAUNCH).map((v, i) => ({
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
    const matched = matchVariants("101-001", nodes, LAUNCH);
    expect(matched).toHaveLength(20);
    expect(matched[3].shopifyVariantId).toBe("gid://shopify/ProductVariant/1003");
  });

  it("refuses an incomplete list", () => {
    expect(() => matchVariants("101-001", variantNodes("101-001").slice(1), LAUNCH)).toThrow(/did not return/u);
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
              product: { id: "gid://shopify/Product/9", handle: "cr-101-001-586", variants: { nodes: variantNodes("101-001") } },
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
    const result = await syncProduct(admin, { workId: "w1", cr: "101-001", title: "Night Swim", listing: LAUNCH });
    expect(result.productId).toBe("gid://shopify/Product/9");
    expect(result.variants).toHaveLength(20);
    const productCall = JSON.parse(calls[1].body) as { query: string; variables: { identifier: { handle: string }; input: { variants: Array<unknown> } } };
    expect(productCall.variables.identifier).toEqual({ handle: "cr-101-001-586" });
    expect(productCall.variables.input.variants).toHaveLength(20);
    // Every variant comes back: 13 colors x 5 sizes is more than 50.
    expect(productCall.query).toContain("variants(first: 250)");
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
    await expect(syncProduct(admin, { workId: "w", cr: "101-001", listing: LAUNCH })).rejects.toThrow(/Handle taken/u);
  });
});

