import {
  GARMENT_KINDS,
  PRINT_PRODUCT,
  PRINT_SIZES,
  type GarmentKind,
  type PrintSize,
} from "../../../shared/config/print-products";
import { METAFIELD_NAMESPACE } from "../../../shared/config/shopify";
import type { ShopifyAdmin } from "./adminClient";

// Builds the productSet input for one listing, a published work on one product
// (convex/lib/shopProduct.ts): handle cr-FFF-EEE-<printful id> (a kept design: kept-<work id>-<printful
// id>, unlisted), every color it is sold in times
// every size the color comes in, on every call (productSet replaces what it is given, so a color no
// longer sold leaves the store), inventory untracked with CONTINUE as a backstop (KTD-17), and
// metafields that point back to the work and the product.

export function crNumber(family: number, expression: number): string {
  return `${String(family).padStart(3, "0")}-${String(expression).padStart(3, "0")}`;
}

export function productHandle(cr: string, printfulProductId?: number): string {
  return printfulProductId === undefined ? `cr-${cr}` : `cr-${cr}-${printfulProductId}`;
}

// A kept design's handle: its work's ID instead of its family-0 number, which counts up and could
// be guessed. Shopify still opens an unlisted product by its handle, so the handle has to be the
// secret part.
export function keptHandle(workId: string, printfulProductId?: number): string {
  return printfulProductId === undefined ? `kept-${workId}` : `kept-${workId}-${printfulProductId}`;
}

// A kept design has no public number, so its product (what its creator sees at checkout and in
// Shopify's emails) is named "Kept design · <title>".
export function productTitle(cr: string, title?: string, garment?: string, kept = false): string {
  const name = title?.trim();
  const label = kept ? "Kept design" : `CR ${cr}`;
  const base = name ? `${label} · ${name}` : label;
  return garment ? `${base} · ${garment}` : base;
}

export function variantSku(cr: string, colorCode: string, size: PrintSize | string, printfulProductId?: number): string {
  return printfulProductId === undefined ? `CR-${cr}-${colorCode}-${size}` : `CR-${cr}-${printfulProductId}-${colorCode}-${size}`;
}

// What a listing sells: the product, its prices, and its colors with their Printful variant ids.
export type SaleListing = {
  printfulProductId: number;
  kind: GarmentKind;
  name: string;
  priceCents: number;
  largePriceCents: number;
  colors: ReadonlyArray<{ code: string; name: string; variants: ReadonlyArray<{ size: string; id: number }> }>;
};

export type PlannedVariant = {
  color: string; // color code
  colorName: string;
  size: PrintSize;
  sku: string;
  priceCents: number;
  printfulVariantId: number | null;
};

export function variantList(cr: string, listing: SaleListing): Array<PlannedVariant> {
  const out: Array<PlannedVariant> = [];
  for (const color of listing.colors) {
    for (const size of PRINT_SIZES) {
      const variant = color.variants.find((v) => v.size === size);
      if (!variant) continue;
      out.push({
        color: color.code,
        colorName: color.name,
        size,
        sku: variantSku(cr, color.code, size, listing.printfulProductId),
        priceCents: size === "2XL" ? listing.largePriceCents : listing.priceCents,
        printfulVariantId: variant.id,
      });
    }
  }
  return out;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function buildProductSetInput(args: {
  workId: string;
  cr: string;
  title?: string;
  imageUrls?: Array<string>;
  listing: SaleListing;
  kept?: boolean;
}) {
  const variants = variantList(args.cr, args.listing);
  const colors = args.listing.colors.filter((c) => variants.some((v) => v.color === c.code));
  const sizes = PRINT_SIZES.filter((size) => variants.some((v) => v.size === size));
  const title = productTitle(args.cr, args.title, args.listing.name, args.kept);
  return {
    handle: args.kept
      ? keptHandle(args.workId, args.listing.printfulProductId)
      : productHandle(args.cr, args.listing.printfulProductId),
    title,
    vendor: PRINT_PRODUCT.vendor,
    productType: GARMENT_KINDS[args.listing.kind]?.label ?? PRINT_PRODUCT.productType,
    // A kept design sells to its creator alone, so its product is unlisted: Shopify leaves it out
    // of product lists, search, collections, recommendations, and the sitemap, while carts and
    // checkout treat it like an active product (Admin API 2025-10 and later).
    status: args.kept ? "UNLISTED" : "ACTIVE",
    productOptions: [
      { name: "Color", values: colors.map((c) => ({ name: c.name })) },
      { name: "Size", values: sizes.map((s) => ({ name: s })) },
    ],
    variants: variants.map((variant) => ({
      optionValues: [
        { optionName: "Color", name: variant.colorName },
        { optionName: "Size", name: variant.size },
      ],
      price: money(variant.priceCents),
      inventoryPolicy: "CONTINUE",
      inventoryItem: { sku: variant.sku, tracked: false, requiresShipping: true },
    })),
    metafields: [
      { namespace: METAFIELD_NAMESPACE, key: "work_id", type: "single_line_text_field", value: args.workId },
      { namespace: METAFIELD_NAMESPACE, key: "cr_number", type: "single_line_text_field", value: args.cr },
      {
        namespace: METAFIELD_NAMESPACE,
        key: "printful_product",
        type: "single_line_text_field",
        value: String(args.listing.printfulProductId),
      },
    ],
    ...(args.imageUrls?.length
      ? {
          files: args.imageUrls.map((url, i) => ({
            originalSource: url,
            contentType: "IMAGE",
            alt: `${title}${i ? ` (${i + 1})` : ""}`,
          })),
        }
      : {}),
  };
}

export const PRODUCT_SET_MUTATION = `mutation CultRemixProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product {
      id
      handle
      variants(first: 250) { nodes { id sku selectedOptions { name value } } }
    }
    userErrors { field message code }
  }
}`;

export const PUBLICATIONS_QUERY = `query CultRemixPublications {
  publications(first: 20) { nodes { id name } }
}`;

export const PUBLISH_MUTATION = `mutation CultRemixPublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { userErrors { field message } }
}`;

export const ARCHIVE_MUTATION = `mutation CultRemixArchive($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id status } userErrors { field message } }
}`;

export type VariantNode = { id: string; sku: string | null; selectedOptions: Array<{ name: string; value: string }> };

type ProductSetResult = {
  productSet: {
    product: { id: string; handle: string; variants: { nodes: Array<VariantNode> } } | null;
    userErrors: Array<{ field?: Array<string> | null; message: string; code?: string | null }>;
  };
};

export type SyncedVariant = PlannedVariant & { shopifyVariantId: string };

// Matches Shopify's variants back to the planned list by SKU, falling back to the options.
export function matchVariants(cr: string, nodes: Array<VariantNode>, listing: SaleListing): Array<SyncedVariant> {
  const planned = variantList(cr, listing);
  const out: Array<SyncedVariant> = [];
  for (const variant of planned) {
    const node =
      nodes.find((n) => n.sku === variant.sku) ??
      nodes.find(
        (n) =>
          n.selectedOptions.some((o) => o.name === "Color" && o.value === variant.colorName) &&
          n.selectedOptions.some((o) => o.name === "Size" && o.value === variant.size),
      );
    if (!node) throw new Error(`Shopify did not return variant ${variant.sku}.`);
    out.push({ ...variant, shopifyVariantId: node.id });
  }
  return out;
}

// Sets a product's status: ARCHIVED for one CultRemix no longer sells (a kept design's, once it's
// shared with the world), DRAFT for one taken off sale for now (a design taken down, which an
// approval can make ACTIVE again). Shopify keeps either for the orders that used it, and nothing can
// buy it.
export async function setProductStatus(admin: ShopifyAdmin, productId: string, status: "ARCHIVED" | "DRAFT"): Promise<void> {
  const data = await admin.graphql<{ productUpdate: { userErrors: Array<{ message: string }> } }>(ARCHIVE_MUTATION, {
    product: { id: productId, status },
  });
  if (data.productUpdate.userErrors.length) {
    throw new Error(`Shopify refused ${status.toLowerCase()}: ${data.productUpdate.userErrors.map((e) => e.message).join("; ")}`);
  }
}

export async function archiveProduct(admin: ShopifyAdmin, productId: string): Promise<void> {
  await setProductStatus(admin, productId, "ARCHIVED");
}

// Writes the product (by handle) and publishes it to the Headless channel the Storefront token
// reads from. Returns the product and every variant's GID.
export async function syncProduct(
  admin: ShopifyAdmin,
  args: { workId: string; cr: string; title?: string; imageUrls?: Array<string>; listing: SaleListing; kept?: boolean },
): Promise<{ productId: string; variants: Array<SyncedVariant> }> {
  const input = buildProductSetInput(args);
  const data = await admin.graphql<ProductSetResult>(PRODUCT_SET_MUTATION, {
    input,
    identifier: { handle: input.handle },
  });
  const { product, userErrors } = data.productSet;
  if (userErrors.length || !product) {
    throw new Error(`productSet refused: ${userErrors.map((e) => e.message).join("; ") || "no product"}`);
  }
  const variants = matchVariants(args.cr, product.variants.nodes, args.listing);
  const publications = await admin.graphql<{ publications: { nodes: Array<{ id: string; name: string }> } }>(
    PUBLICATIONS_QUERY,
  );
  const headless = publications.publications.nodes.find((p) => /headless/iu.test(p.name));
  if (!headless) throw new Error("The store has no Headless sales channel to publish to.");
  const published = await admin.graphql<{ publishablePublish: { userErrors: Array<{ message: string }> } }>(
    PUBLISH_MUTATION,
    { id: product.id, input: [{ publicationId: headless.id }] },
  );
  if (published.publishablePublish.userErrors.length) {
    throw new Error(`Publishing refused: ${published.publishablePublish.userErrors.map((e) => e.message).join("; ")}`);
  }
  return { productId: product.id, variants };
}
