// The feature flags admins can turn on and off (KTD-19). Rows live in `featureFlags`;
// a flag with no row uses `defaultOn`. `scripts/seed-environment.ts` writes every row,
// so a seeded environment never depends on the default.
export type FlagDefinition = {
  key: string;
  label: string;
  description: string;
  defaultOn: boolean;
  // Said plainly on the admin page while nothing reads the switch yet. Whoever wires the
  // switch removes this line.
  notWiredYet?: string;
};

export const FEATURE_FLAGS: ReadonlyArray<FlagDefinition> = [
  {
    key: "gen.vercel",
    label: "Studio",
    description:
      "Members make new designs in the studio through the CultRemix Gateway. Off stops new designs; anything already started still finishes.",
    defaultOn: true,
  },
  {
    key: "publishing",
    label: "Publishing",
    description: "Members publish designs and get CR numbers, and remixes join their family. Off stops new publishing; published works stay up.",
    defaultOn: true,
  },
  {
    key: "commerce.checkout",
    label: "Checkout",
    description:
      "Shoppers buy shirts through Shopify checkout, and paid orders go to Printful. Turn it on only after the Shopify and Printful keys are set. While it's off, work pages say Buying opens soon, production shows Early access, and Shopify keeps the products as drafts, so even a cart made earlier can't check out.",
    defaultOn: false,
  },
  {
    key: "fulfillment.autoConfirm",
    label: "Send paid orders to print",
    description:
      "Production confirms each paid order's Printful draft for printing when its hour's hold ends. Off pauses that: drafts wait in Printful until it's back on or you confirm them there, and the owner hears about any an hour past its hold. Production also needs PRINTFUL_AUTO_CONFIRM=true; dev and staging never confirm.",
    defaultOn: true,
  },
  {
    key: "chain.writes",
    label: "Monad records",
    description:
      "Published works, remixes, Backs, and lineage corrections are recorded in the registry on Monad. It needs a deployed registry and a funded relayer; /admin/chain shows both. While it's off, admins confirm lineage corrections offchain.",
    defaultOn: false,
  },
  {
    key: "social.backs",
    label: "Backs",
    description: "Members can Back works they love, 3 a week, recorded on Monad. Backing also needs Monad records on.",
    defaultOn: false,
  },
  {
    key: "email.sales",
    label: "Sale emails",
    description:
      "Creators get an email when a design they share in sells (one per order, from the sign-in address), as well as the notification. Test orders never email. Members can turn these off in Settings.",
    defaultOn: false,
  },
  {
    key: "gen.upscale",
    label: "Print-size art",
    description:
      "Creators can upscale art to print size (2 credits; the owner is exempt) and remove backgrounds in the Print Studio, and approving a work for sale upscales its art. Off refuses new upscales and background removals.",
    defaultOn: false,
  },
  {
    key: "print.chestMarks",
    label: "Chest marks",
    description:
      "With a design printed on the back, its creator can add a small copy on the front chest when publishing or changing where it sits. It doesn't change the price: the back print's extra already covers what Printful charges to print both sides. Off hides the choice; designs that already have a mark keep it.",
    defaultOn: false,
  },
];

export const FLAG_KEYS = FEATURE_FLAGS.map((flag) => flag.key);

export function flagDefinition(key: string): FlagDefinition | undefined {
  return FEATURE_FLAGS.find((flag) => flag.key === key);
}

export function flagDefault(key: string): boolean {
  return flagDefinition(key)?.defaultOn ?? true;
}
