// Deploys the dev CultRemixRegistry to Monad testnet from the dev relayer, which becomes the
// registry's admin and relayer, then registers economic config v1. The key is read here from
// ~/.config/cultremix/chain.env (MONAD_RELAYER_PRIVATE_KEY_DEV) and never printed.
//
//   bun run chain:deploy:testnet                        read-only: relayer, balance, cost
//   bun run chain:deploy:testnet --broadcast            deploy, then register config v1
//   bun run chain:deploy:testnet --broadcast --registry 0x…
//                                                       register config v1 on an existing registry
//   bun run chain:deploy:testnet --local http://127.0.0.1:8545 [--broadcast]
//                                                       rehearse on anvil (chain 10143) with its
//                                                       first account; reads no secrets
//
// Afterwards, record the address as CHAIN_ENVIRONMENTS.dev.registryAddress in
// shared/config/chains.ts. Run it while the dev relayer is idle: it uses the relayer's nonces.
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
import type { RegistryTarget } from "./deployRegistry";
import type { Address, Hex } from "viem";

const KEY_FILE = join(homedir(), ".config", "cultremix", "chain.env");
const KEY_NAME = "MONAD_RELAYER_PRIVATE_KEY_DEV";
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
    local: null as string | null,
    registry: null as Address | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--broadcast") args.broadcast = true;
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
  return args;
}

/** The dev relayer key from chain.env. Error messages never include the value. */
function relayerKey(): Hex {
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
  const dev = CHAIN_ENVIRONMENTS.dev;
  const local = args.local !== null;
  const target: RegistryTarget = {
    rpcUrl: args.local ?? MONAD_TESTNET.rpcUrl,
    chainId: MONAD_TESTNET.chainId,
    name: local ? "anvil" : MONAD_TESTNET.name,
  };
  const key = local ? (ANVIL_KEY as Hex) : relayerKey();
  const relayer = privateKeyToAccount(key).address;
  if (
    !local &&
    (!dev.relayerAddress ||
      relayer.toLowerCase() !== dev.relayerAddress.toLowerCase())
  ) {
    fail(
      `The key in ${KEY_FILE} belongs to ${relayer}, not the dev relayer ${dev.relayerAddress ?? "(none recorded)"}.`,
    );
  }

  const quote = await deploymentQuote(target, key);
  if (quote.chainId !== MONAD_TESTNET.chainId)
    fail(
      `${target.rpcUrl} reports chain ${quote.chainId}, not Monad testnet (${MONAD_TESTNET.chainId}).`,
    );
  const needed = quote.cost * HEADROOM;
  console.log(
    `Network     ${target.name} (${quote.chainId}) at ${target.rpcUrl}`,
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
      `The dev registry is already recorded (${dev.registryAddress}). To register config v1 on it, pass --registry ${dev.registryAddress}.`,
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
      `Deploy tx   ${local ? deployed.txHash : explorerTxUrl(MONAD_TESTNET, deployed.txHash)}`,
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
      `Config tx   ${local ? registered.txHash : explorerTxUrl(MONAD_TESTNET, registered.txHash!)}`,
    );

  console.log("\nNext:");
  if (local) {
    console.log(
      `  Rehearsal done. A dev Convex deployment can use it with CHAIN_REGISTRY_ADDRESS=${registry} and MONAD_RPC_URL=${target.rpcUrl}.`,
    );
  } else {
    console.log(
      `  1. Set CHAIN_ENVIRONMENTS.dev.registryAddress to "${registry}" in shared/config/chains.ts and commit.`,
    );
    console.log(`     ${explorerAddressUrl(MONAD_TESTNET, registry)}`);
    console.log(
      "  2. Deploy Convex dev, turn on chain writes in /admin/chain, and press Register economic config v1:",
    );
    console.log(
      "     its write finds this registration onchain and confirms without sending.",
    );
  }
}

main().catch((error: unknown) =>
  fail(error instanceof Error ? error.message : String(error)),
);
