// Verifies an environment's deployed CultRemixRegistry on Monad's explorers, so its source code and
// Read Contract tab show there (scripts/chain/verifyRegistry.ts). deploy-testnet.ts runs this after
// a deploy; run it by hand to try again.
//
//   bun run chain:verify:testnet [--registry 0x…]     dev's registry, on Monad testnet
//   bun run chain:verify:mainnet [--registry 0x…]     production's, on Monad mainnet
//
// --registry defaults to the address recorded in shared/config/chains.ts. The constructor's admin and
// relayer default to the environment's relayer, which the deploy makes both; --admin and --relayer
// override them. Sourcify always; Monadscan too when ETHERSCAN_API_KEY is in
// ~/.config/cultremix/chain.env. Safe to rerun.
import { isAddress } from "viem";
import { CHAIN_ENVIRONMENTS } from "../../shared/config/chains";
import { chainEnvValue } from "./chainEnv";
import { verifyEverywhere } from "./verifyRegistry";
import type { Address } from "viem";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
const option = (name: string) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const address = (name: string): Address | undefined => {
  const value = option(name);
  if (value === undefined) return undefined;
  if (!isAddress(value)) fail(`${name} needs an address.`);
  return value;
};
const env = option("--env") ?? "dev";
if (env !== "dev" && env !== "prod") fail("--env takes dev or prod.");
const settings = CHAIN_ENVIRONMENTS[env];
const registry = address("--registry") ?? settings.registryAddress ?? fail(`No ${env} registry is recorded yet; pass --registry 0x….`);
const defaultRelayer = settings.relayerAddress ?? fail(`No ${env} relayer is recorded; pass --admin and --relayer.`);
const admin = address("--admin") ?? defaultRelayer;
const relayer = address("--relayer") ?? defaultRelayer;

console.log(`Verifying ${registry} on ${settings.network.name} (${settings.network.chainId})…`);
const results = await verifyEverywhere(
  { chainId: settings.network.chainId, registry, admin, relayer },
  chainEnvValue("ETHERSCAN_API_KEY") ?? undefined,
);
for (const result of results) console.log(`  ${result.explorer}: ${result.detail.replace(/\n/gu, "\n    ")}`);
if (!results.some((result) => result.ok)) process.exit(1);
