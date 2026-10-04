import {
  PRINT_COLORS,
  PRINT_PRODUCT,
  PRINT_SIZES,
  priceCentsFor,
  type PrintSize,
} from "../../../shared/config/print-products";
import { METAFIELD_NAMESPACE } from "../../../shared/config/shopify";
import type { ShopifyAdmin } from "./adminClient";

// Builds the productSet input for a published work: handle cr-FFF-EEE, the full 4 x 5 variant
// list on every call (productSet replaces what it is given), inventory untracked with CONTINUE as
// a backstop (KTD-17), and metafields that point back to the work.

export function crNumber(family: number, expression: number): string {
  return `${String(family).padStart(3, "0")}-${String(expression).padStart(3, "0")}`;
}

export function productHandle(cr: string): string {
  return `cr-${cr}`;
}

export function productTitle(cr: string, title?: string): string {
  const name = title?.trim();
  return name ? `CR ${cr} · ${name}` : `CR ${cr}`;
}

export function variantSku(cr: string, colorCode: string, size: PrintSize | string): string {
  return `CR-${cr}-${colorCode}-${size}`;
}

export type PlannedVariant = {
  color: string; // color code
  colorName: string;
  size: PrintSize;
  sku: string;
  priceCents: number;
  printfulVariantId: number | null;
};

export function variantList(cr: string): Array<PlannedVariant> {
  const out: Array<PlannedVariant> = [];
  for (const color of PRINT_COLORS) {
    for (const size of PRINT_SIZES) {
      out.push({
        color: color.code,
        colorName: color.name,
        size,
        sku: variantSku(cr, color.code, size),
        priceCents: priceCentsFor(size),
        printfulVariantId: color.printfulVariantIds[size],
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
}) {
  const variants = variantList(args.cr);
  return {
    handle: productHandle(args.cr),
    title: productTitle(args.cr, args.title),
    vendor: PRINT_PRODUCT.vendor,
    productType: PRINT_PRODUCT.productType,
    status: "ACTIVE",
    productOptions: [
      { name: "Color", values: PRINT_COLORS.map((c) => ({ name: c.name })) },
      { name: "Size", values: PRINT_SIZES.map((s) => ({ name: s })) },
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
    ],
    ...(args.imageUrls?.length
      ? {
          files: args.imageUrls.map((url, i) => ({
            originalSource: url,
            contentType: "IMAGE",
            alt: `${productTitle(args.cr, args.title)}${i ? ` (${i + 1})` : ""}`,
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
      variants(first: 50) { nodes { id sku selectedOptions { name value } } }
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

export type VariantNode = { id: string; sku: string | null; selectedOptions: Array<{ name: string; value: string }> };

type ProductSetResult = {
  productSet: {
    product: { id: string; handle: string; variants: { nodes: Array<VariantNode> } } | null;
    userErrors: Array<{ field?: Array<string> | null; message: string; code?: string | null }>;
  };
};

export type SyncedVariant = PlannedVariant & { shopifyVariantId: string };

// Matches Shopify's variants back to the planned list by SKU, falling back to the options.
export function matchVariants(cr: string, nodes: Array<VariantNode>): Array<SyncedVariant> {
  const planned = variantList(cr);
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

// Writes the product (by handle) and publishes it to the Headless channel the Storefront token
// reads from. Returns the product and every variant's GID.
export async function syncProduct(
  admin: ShopifyAdmin,
  args: { workId: string; cr: string; title?: string; imageUrls?: Array<string> },
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
  const variants = matchVariants(args.cr, product.variants.nodes);
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
