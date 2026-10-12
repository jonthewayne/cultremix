import { describe, expect, it } from "vitest";
import { readinessItems } from "../../convex/lib/readiness";
import type { ReadinessInput } from "../../convex/lib/readiness";

const ready: ReadinessInput = {
  env: "prod",
  printful: { keys: true, connected: true, signingKey: true },
  shopify: { keys: true, connected: true },
  products: { names: ["Comfort Colors 1717"], chosen: true },
  upscale: { flag: true, falKey: true },
  onSale: 3,
  checkout: true,
  confirming: { env: true, flag: true },
  chain: { problem: null, registry: "0xabc", relayerKey: true, custody: "circle", writes: true },
};
const missing = (input: ReadinessInput) => readinessItems(input).filter((item) => !item.ok).map((item) => item.key);
const detail = (input: ReadinessInput, key: string) => readinessItems(input).find((item) => item.key === key)?.detail;

// Admin, Overview's Ready to sell list (convex/lib/readiness.ts).
describe("ready to sell", () => {
  it("is all done on a production with everything set up", () => {
    expect(missing(ready)).toEqual([]);
    expect(readinessItems(ready).map((item) => item.key)).toEqual(["printful", "shopify", "products", "upscale", "onSale", "confirming", "checkout", "registry", "relayer", "wallets", "writes"]);
  });

  it("says what each missing piece needs, in the order to do it", () => {
    const fresh: ReadinessInput = {
      env: "prod",
      printful: { keys: false, connected: false, signingKey: false },
      shopify: { keys: true, connected: false },
      products: { names: ["Launch shirt"], chosen: false },
      upscale: { flag: false, falKey: false },
      onSale: 0,
      checkout: false,
      confirming: { env: false, flag: true },
      chain: { problem: null, registry: null, relayerKey: false, custody: "unavailable", writes: false },
    };
    expect(missing(fresh)).toEqual(["printful", "shopify", "products", "upscale", "onSale", "confirming", "checkout", "registry", "relayer", "wallets", "writes"]);
    expect(detail(fresh, "printful")).toMatch(/PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID/u);
    expect(detail(fresh, "shopify")).toBe("Its keys are set. Press Connect Shopify in For sale.");
    expect(detail(fresh, "upscale")).toBe("Approving a design for sale upscales its art first: set FAL_KEY and turn on Print-size art in Switches.");
    expect(detail(fresh, "confirming")).toMatch(/PRINTFUL_AUTO_CONFIRM=true/u);
    expect(detail(fresh, "registry")).toBe("Not deployed. Once the relayer has MON: bun run chain:deploy:mainnet");
    expect(detail(fresh, "wallets")).toBe(
      "Put Circle's live API key in ~/.config/cultremix/circle.env as CIRCLE_API_KEY_LIVE, then run bun run circle:setup --env prod --apply (or, as a stopgap, set MANAGED_WALLET_SECRET for CultRemix's own wallets). Until then, each Monad record waits for its creator's wallet.",
    );
    // Managed wallets count as wallets, with a reminder about their secret.
    const managed = { ...fresh, chain: { ...fresh.chain, custody: "managed" as const } };
    expect(missing(managed)).not.toContain("wallets");
    expect(detail(managed, "wallets")).toMatch(/MANAGED_WALLET_SECRET/u);
    // A Printful connection without a signing key isn't done.
    expect(detail({ ...ready, printful: { keys: true, connected: true, signingKey: false } }, "printful")).toMatch(/no signing key/u);
    expect(detail({ ...ready, confirming: { env: true, flag: false } }, "confirming")).toMatch(/Send paid orders to print is off/u);
  });

  it("doesn't ask dev to confirm orders, and names its testnet deploy and its own wallets", () => {
    const dev: ReadinessInput = { ...ready, env: "dev", confirming: { env: false, flag: true }, chain: { ...ready.chain, registry: null, custody: "local" } };
    expect(missing(dev)).toEqual(["registry"]);
    expect(detail(dev, "confirming")).toMatch(/dev and staging stop at Printful drafts/u);
    expect(detail(dev, "registry")).toMatch(/chain:deploy:testnet/u);
    expect(detail(dev, "wallets")).toMatch(/Dev's own wallets/u);
  });

  it("shows a chain setting that doesn't hold together as the registry's problem", () => {
    const broken: ReadinessInput = { ...ready, env: "unknown", chain: { ...ready.chain, problem: "Deployment config: DEPLOYMENT_ENV must be dev, staging, or prod (got nothing).", custody: "unavailable" } };
    expect(missing(broken)).toEqual(["confirming", "registry", "wallets"]);
    expect(detail(broken, "registry")).toMatch(/^Deployment config: DEPLOYMENT_ENV/u);
  });
});
