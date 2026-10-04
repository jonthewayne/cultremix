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
    description: "Members publish designs and get CR numbers, and remixes join their family.",
    defaultOn: true,
    notWiredYet: "Not wired yet: publishing stays open either way.",
  },
  {
    key: "commerce.checkout",
    label: "Checkout",
    description: "Shoppers can buy prints. While this is off, production shows Early access.",
    defaultOn: false,
    notWiredYet: "Not wired yet: buying stays closed either way. Today this switch only changes the production label.",
  },
  {
    key: "chain.writes",
    label: "Monad records",
    description:
      "Published works and remixes are recorded in the registry on Monad. While this is off, admins confirm lineage corrections offchain.",
    defaultOn: false,
    notWiredYet: "Not wired yet: nothing is written to Monad until the registry lands. Today this switch only decides how lineage corrections are confirmed.",
  },
  {
    key: "social.backs",
    label: "Backs",
    description: "Members can back works they love.",
    defaultOn: false,
    notWiredYet: "Not wired yet: there's no backing to turn on.",
  },
  {
    key: "gen.upscale",
    label: "Print-size art",
    description: "Creators can upscale art to print size in the Print Studio (2 credits; the owner is exempt). Off refuses new upscales.",
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
