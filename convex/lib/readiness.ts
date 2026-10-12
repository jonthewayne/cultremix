import type { DeploymentEnv } from "./shopFlags";

// Admin, Overview's "Ready to sell" list (convex/admin.ts readiness): what still stands between this
// deployment and real orders and Monad records, read from its env (only whether each value is set)
// and its data. Pure, so each rule is tested without an environment.

export type ReadinessInput = {
  env: DeploymentEnv;
  printful: { keys: boolean; connected: boolean; signingKey: boolean };
  shopify: { keys: boolean; connected: boolean };
  // The products on offer, by name; chosen is false while only the built-in launch shirt is.
  products: { names: Array<string>; chosen: boolean };
  upscale: { flag: boolean; falKey: boolean };
  // Published designs with a product on sale.
  onSale: number;
  checkout: boolean;
  confirming: { env: boolean; flag: boolean };
  chain: {
    // Why this deployment's chain settings don't hold together, if they don't.
    problem: string | null;
    registry: string | null;
    relayerKey: boolean;
    custody: "circle" | "local" | "unavailable";
    writes: boolean;
  };
};

export type ReadinessItem = { key: string; group: "shop" | "monad"; label: string; ok: boolean; detail: string };

const testnet = (env: DeploymentEnv) => env !== "prod";

export function readinessItems(input: ReadinessInput): Array<ReadinessItem> {
  const items: Array<ReadinessItem> = [];
  const shop = (key: string, label: string, ok: boolean, detail: string) => items.push({ key, group: "shop", label, ok, detail });
  const monad = (key: string, label: string, ok: boolean, detail: string) => items.push({ key, group: "monad", label, ok, detail });

  const { printful, shopify } = input;
  shop(
    "printful",
    "Printful",
    printful.keys && printful.connected && printful.signingKey,
    !printful.keys
      ? "Set PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID in this deployment's Convex env."
      : !printful.connected
        ? "Its keys are set. Press Connect Printful in For sale."
        : !printful.signingKey
          ? "Connected, but its webhooks have no signing key. Press Connect Printful again."
          : "Connected.",
  );
  shop(
    "shopify",
    "Shopify",
    shopify.keys && shopify.connected,
    !shopify.keys
      ? "Set SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET in this deployment's Convex env."
      : !shopify.connected
        ? "Its keys are set. Press Connect Shopify in For sale."
        : "Connected.",
  );
  shop(
    "products",
    "Products on offer",
    input.products.chosen,
    input.products.chosen
      ? input.products.names.join(", ")
      : "None picked yet, so the built-in launch shirt is on offer. Pick products and prices in Products.",
  );
  shop(
    "upscale",
    "Print files",
    input.upscale.flag && input.upscale.falKey,
    input.upscale.flag && input.upscale.falKey
      ? "Approving a design upscales its art and makes its print files."
      : `Approving a design for sale upscales its art first: ${[!input.upscale.falKey && "set FAL_KEY", !input.upscale.flag && "turn on Print-size art in Switches"].filter(Boolean).join(" and ")}.`,
  );
  shop(
    "onSale",
    "Designs on sale",
    input.onSale > 0,
    input.onSale > 0 ? `${input.onSale} design${input.onSale === 1 ? "" : "s"} with a product on sale.` : "None yet. Approve designs in For sale.",
  );
  if (input.env === "prod") {
    shop(
      "confirming",
      "Sending paid orders to print",
      input.confirming.env && input.confirming.flag,
      !input.confirming.env
        ? "Paid orders stop at Printful drafts until PRINTFUL_AUTO_CONFIRM=true is set in production's Convex env."
        : !input.confirming.flag
          ? "Paused: Send paid orders to print is off in Switches, so drafts wait in Printful."
          : "Each paid order's Printful draft is confirmed an hour after payment.",
    );
  } else if (input.env === "unknown") {
    shop("confirming", "Sending paid orders to print", false, "DEPLOYMENT_ENV isn't dev, staging, or prod, so paid orders stop at Printful drafts.");
  } else {
    shop("confirming", "Sending paid orders to print", true, "Off here on purpose: dev and staging stop at Printful drafts.");
  }
  shop(
    "checkout",
    "Checkout",
    input.checkout,
    input.checkout ? "On: shoppers can buy." : "Off: shop pages say Buying opens soon. Turn it on in Switches once everything above is done.",
  );

  const chain = input.chain;
  const network = testnet(input.env) ? "testnet" : "mainnet";
  monad(
    "registry",
    "Registry",
    chain.problem === null && chain.registry !== null,
    chain.problem ?? (chain.registry ? `Deployed at ${chain.registry}.` : `Not deployed. Once the relayer has MON: bun run chain:deploy:${network}`),
  );
  monad(
    "relayer",
    "Relayer key",
    chain.relayerKey,
    chain.relayerKey ? "Set. Its MON balance is on the Monad tab." : "Set MONAD_RELAYER_PRIVATE_KEY in this deployment's Convex env.",
  );
  monad(
    "wallets",
    "Member wallets",
    chain.custody !== "unavailable",
    chain.custody === "circle"
      ? "Circle wallets."
      : chain.custody === "local"
        ? "Dev's own wallets (no Circle keys); production uses Circle."
        : input.env === "prod" || input.env === "dev"
          ? `Put Circle's ${input.env === "prod" ? "live" : "test"} API key in ~/.config/cultremix/circle.env as ${input.env === "prod" ? "CIRCLE_API_KEY_LIVE" : "CIRCLE_API_KEY_TEST"}, then run bun run circle:setup --env ${input.env} --apply. Until then, each Monad record waits for its creator's wallet.`
          : "Set CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID in this deployment's Convex env.",
  );
  monad(
    "writes",
    "Monad records",
    chain.writes,
    chain.writes ? "On: publishing records each design." : "Off. Turn it on in Switches once the registry is deployed and the relayer has MON.",
  );
  return items;
}
