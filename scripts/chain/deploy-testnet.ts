// Deploys an environment's CultRemixRegistry from that environment's relayer, which becomes the
// registry's admin and relayer, then registers economic config v1. Dev deploys to Monad testnet
// with MONAD_RELAYER_PRIVATE_KEY_DEV; production deploys to Monad mainnet with
// MONAD_RELAYER_PRIVATE_KEY_PROD. Keys are read here from ~/.config/cultremix/chain.env and never
// printed.
//
//   bun run chain:deploy:testnet                        read-only: relayer, balance, cost
//   bun run chain:deploy:testnet --broadcast            deploy, then register config v1
//   bun run chain:deploy:testnet --broadcast --registry 0x…
//                                                       register config v1 on an existing registry
//   bun run chain:deploy:testnet --local http://127.0.0.1:8545 [--broadcast]
//                                                       rehearse on anvil (chain 10143) with its
//                                                       first account; reads no secrets
//   bun run chain:deploy:mainnet                        the same for production, on Monad mainnet;
//   bun run chain:deploy:mainnet --broadcast --confirm-mainnet
//                                                       spends real MON, so it needs both flags
//
// Afterwards, record the address as CHAIN_ENVIRONMENTS.<env>.registryAddress in
// shared/config/chains.ts. Run it while that relayer is idle: it uses the relayer's nonces.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, formatEther, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { configHashFor } from "../../convex/lib/chain/ids";
import {
  ECONOMIC_CONFIG_V1,
  canonicalConfigJson,
} from "../../convex/lib/economics";
import {
  CHAIN_ENVIRONMENTS,
  MONAD_MAINNET,
  MONAD_TESTNET,
  explorerAddressUrl,
  explorerTxUrl,
} from "../../shared/config/chains";
import {
  deployRegistry,
  deploymentQuote,
  registerConfig,
} from "./deployRegistry";
import { registryAbi } from "./registryArtifact";
import { chainEnvValue } from "./chainEnv";
import { verifyEverywhere } from "./verifyRegistry";
import type { RegistryTarget } from "./deployRegistry";
import type { Address, Hex } from "viem";

const KEY_FILE = join(homedir(), ".config", "cultremix", "chain.env");
const KEY_NAMES = { dev: "MONAD_RELAYER_PRIVATE_KEY_DEV", prod: "MONAD_RELAYER_PRIVATE_KEY_PROD" } as const;
// Anvil's first account: a well-known test key, for --local only.
const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// Deployment plus the config transaction, with room for fee movement.
const HEADROOM = 2n;

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

function parseArgs(argv: Array<string>) {
  const args = {
    broadcast: false,
    confirmMainnet: false,
    env: "dev" as "dev" | "prod",
    local: null as string | null,
    registry: null as Address | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--broadcast") args.broadcast = true;
    else if (arg === "--confirm-mainnet") args.confirmMainnet = true;
    else if (arg === "--env") {
      const value = argv[++i];
      if (value !== "dev" && value !== "prod") fail("--env takes dev or prod.");
      args.env = value;
    }
    else if (arg === "--local")
      args.local =
        argv[++i] ??
        fail("--local needs an RPC URL, like http://127.0.0.1:8545.");
    else if (arg === "--registry") {
      const value = argv[++i];
      if (!value || !isAddress(value))
        fail("--registry needs a registry address.");
      args.registry = value;
    } else fail(`Unknown option ${arg}.`);
  }
  if (
    args.local &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/u.test(args.local)
  )
    fail("--local takes a localhost RPC URL.");
  if (args.local && args.env === "prod") fail("--local rehearses the dev registry only.");
  if (args.env === "prod" && args.broadcast && !args.confirmMainnet)
    fail("This spends real MON on Monad mainnet. Add --confirm-mainnet to go ahead.");
  return args;
}

/** The environment's relayer key from chain.env. Error messages never include the value. */
function relayerKey(KEY_NAME: string): Hex {
  let text: string;
  try {
    text = readFileSync(KEY_FILE, "utf8");
  } catch {
    fail(`Couldn't read ${KEY_FILE}.`);
  }
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match || match[1] !== KEY_NAME) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/u, "$2");
    const key = value.startsWith("0x") ? value : `0x${value}`;
    if (!/^0x[0-9a-fA-F]{64}$/u.test(key))
      fail(`${KEY_NAME} in ${KEY_FILE} isn't a 32-byte hex private key.`);
    return key as Hex;
  }
  fail(`${KEY_FILE} has no ${KEY_NAME}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dev = CHAIN_ENVIRONMENTS[args.env];
  const network = args.env === "prod" ? MONAD_MAINNET : MONAD_TESTNET;
  const local = args.local !== null;
  const rpcUrl = args.local ?? (args.env === "prod" ? (chainEnvValue("MONAD_RPC_URL_MAINNET") ?? network.rpcUrl) : network.rpcUrl);
  const target: RegistryTarget = {
    rpcUrl,
    chainId: network.chainId,
    name: local ? "anvil" : network.name,
  };
  const key = local ? (ANVIL_KEY as Hex) : relayerKey(KEY_NAMES[args.env]);
  const relayer = privateKeyToAccount(key).address;
  if (
    !local &&
    (!dev.relayerAddress ||
      relayer.toLowerCase() !== dev.relayerAddress.toLowerCase())
  ) {
    fail(
      `The key in ${KEY_FILE} belongs to ${relayer}, not the ${args.env} relayer ${dev.relayerAddress ?? "(none recorded)"}.`,
    );
  }

  const quote = await deploymentQuote(target, key);
  if (quote.chainId !== network.chainId)
    fail(
      `The RPC reports chain ${quote.chainId}, not ${network.name} (${network.chainId}).`,
    );
  const needed = quote.cost * HEADROOM;
  // The RPC URL can carry a provider key, so only its host is shown.
  console.log(
    `Network     ${target.name} (${quote.chainId}) at ${new URL(target.rpcUrl).host}`,
  );
  console.log(`Relayer     ${relayer} (admin and relayer of the new registry)`);
  console.log(`Balance     ${formatEther(quote.balance)} MON`);
  console.log(
    `Deploy cost ~${formatEther(quote.cost)} MON (${quote.gas} gas); needs ${formatEther(needed)} MON with the config transaction`,
  );

  const config = {
    version: ECONOMIC_CONFIG_V1.version,
    hash: configHashFor(canonicalConfigJson(ECONOMIC_CONFIG_V1)),
  };
  if (!local && dev.registryAddress && !args.registry) {
    fail(
      `The ${args.env} registry is already recorded (${dev.registryAddress}). To register config v1 on it, pass --registry ${dev.registryAddress}.`,
    );
  }
  if (!args.broadcast) {
    console.log(
      `\nDry run: nothing sent. Add --broadcast to ${args.registry ? `register config v${config.version} on ${args.registry}` : "deploy and register config v1"}.`,
    );
    return;
  }
  if (quote.balance < needed)
    fail(
      `The relayer needs at least ${formatEther(needed)} MON. Fund ${relayer} and run this again.`,
    );

  let registry: Address;
  if (args.registry) {
    registry = args.registry;
    const reader = createPublicClient({ transport: http(target.rpcUrl) });
    const admin = await reader
      .readContract({
        address: registry,
        abi: registryAbi,
        functionName: "admin",
      })
      .catch(() => fail(`${registry} isn't a CultRemix registry.`));
    if (admin.toLowerCase() !== relayer.toLowerCase())
      fail(`The relayer isn't the admin of ${registry}.`);
  } else {
    console.log("\nDeploying CultRemixRegistry…");
    const deployed = await deployRegistry(target, key, {
      admin: relayer,
      relayer,
    });
    registry = deployed.address;
    console.log(`Registry    ${registry} (block ${deployed.blockNumber})`);
    console.log(
      `Deploy tx   ${local ? deployed.txHash : explorerTxUrl(network, deployed.txHash)}`,
    );
  }

  console.log(
    `Registering economic config v${config.version} (${config.hash})…`,
  );
  const registered = await registerConfig(
    target,
    key,
    registry,
    config.version,
    config.hash,
  );
  if (registered.alreadyRegistered)
    console.log(
      `Config v${config.version} was already registered with this hash.`,
    );
  else
    console.log(
      `Config tx   ${local ? registered.txHash : explorerTxUrl(network, registered.txHash!)}`,
    );

  // Explorers show the source and a Read Contract tab only for a verified contract, and /onchain
  // tells people to use that tab. A failure here leaves the deploy as it is.
  if (!local) {
    const retry = `bun run chain:verify:${args.env === "prod" ? "mainnet" : "testnet"} --registry ${registry}`;
    console.log("\nVerifying the registry's source code…");
    try {
      const results = await verifyEverywhere(
        { chainId: network.chainId, registry, admin: relayer, relayer },
        chainEnvValue("ETHERSCAN_API_KEY") ?? undefined,
      );
      for (const result of results) console.log(`  ${result.explorer}: ${result.detail.replace(/\n/gu, "\n    ")}`);
      if (!results.some((result) => result.ok)) console.log(`  Not verified yet; the deploy itself is done. Try again: ${retry}`);
    } catch (error) {
      console.log(`  Couldn't verify (${error instanceof Error ? error.message : String(error)}); the deploy itself is done. Try again: ${retry}`);
    }
  }

  console.log("\nNext:");
  if (local) {
    console.log(
      `  Rehearsal done. A dev Convex deployment can use it with CHAIN_REGISTRY_ADDRESS=${registry} and MONAD_RPC_URL=${target.rpcUrl}.`,
    );
  } else {
    console.log(
      `  1. Set CHAIN_ENVIRONMENTS.${args.env}.registryAddress to "${registry}" in shared/config/chains.ts and commit.`,
    );
    console.log(`     ${explorerAddressUrl(network, registry)}`);
    console.log(
      `  2. Deploy Convex ${args.env}, turn on chain writes in /admin/chain, and press Register economic config v1:`,
    );
    console.log(
      "     its write finds this registration onchain and confirms without sending.",
    );
  }
}

main().catch((error: unknown) =>
  fail(error instanceof Error ? error.message : String(error)),
);
