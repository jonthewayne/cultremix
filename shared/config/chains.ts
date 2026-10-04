// Monad networks and the per-environment chain settings (V1 plan KTD-14). Dev and staging use
// Monad testnet; production uses mainnet. Each environment has its own registry.
//
// assertDeploymentConsistency() runs at the start of every Convex action with chain or wallet
// effects. It fails closed on any mismatch, including a set of values that agree with each other
// but belong to another environment (for example prod pointed at testnet).

export type DeploymentEnv = "dev" | "staging" | "prod";
export type Address = `0x${string}`;

export type ChainNetwork = {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrl: string;
  explorerUrl: string;
  // Circle's blockchain code for wallets on this network.
  circleBlockchain: "MONAD-TESTNET" | "MONAD";
};

// Explorer links verified 2026-10-03: testnet.monadscan.com serves /tx/<hash> and
// /address/<address> for Monad testnet (testnet.monadexplorer.com now redirects to MonadVision).
export const MONAD_TESTNET: ChainNetwork = {
  chainId: 10143,
  name: "Monad Testnet",
  testnet: true,
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadscan.com",
  circleBlockchain: "MONAD-TESTNET",
};

export const MONAD_MAINNET: ChainNetwork = {
  chainId: 143,
  name: "Monad",
  testnet: false,
  rpcUrl: "https://rpc.monad.xyz",
  explorerUrl: "https://monadscan.com",
  circleBlockchain: "MONAD",
};

export type ChainEnvironment = {
  network: ChainNetwork;
  // The registry for this environment, or null until it is deployed.
  registryAddress: Address | null;
  // The relayer EOA, when known. MONAD_RELAYER_PRIVATE_KEY must belong to it.
  relayerAddress: Address | null;
  // Circle key environment: TEST_API_KEY:... or LIVE_API_KEY:...
  circleKeyEnvironment: "TEST" | "LIVE";
  // Circle wallet set, when known. CIRCLE_WALLET_SET_ID must equal it.
  circleWalletSetId: string | null;
};

export const CHAIN_ENVIRONMENTS: Record<DeploymentEnv, ChainEnvironment> = {
  dev: {
    network: MONAD_TESTNET,
    registryAddress: null,
    relayerAddress: "0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921",
    circleKeyEnvironment: "TEST",
    circleWalletSetId: null,
  },
  staging: {
    network: MONAD_TESTNET,
    registryAddress: null,
    relayerAddress: null,
    circleKeyEnvironment: "TEST",
    circleWalletSetId: null,
  },
  prod: {
    network: MONAD_MAINNET,
    registryAddress: null,
    relayerAddress: null,
    circleKeyEnvironment: "LIVE",
    circleWalletSetId: null,
  },
};

export function explorerTxUrl(network: ChainNetwork, txHash: string) {
  return `${network.explorerUrl}/tx/${txHash}`;
}

export function explorerAddressUrl(network: ChainNetwork, address: string) {
  return `${network.explorerUrl}/address/${address}`;
}

/**
 * The network whose public explorer shows a chain's transactions, or null when there is none to
 * link to: an unknown chain, or a dev deployment pointed at a localhost node.
 */
export function explorerNetwork(env: Record<string, string | undefined>, chainId: number): ChainNetwork | null {
  const rpcUrl = env.MONAD_RPC_URL?.trim();
  if (env.DEPLOYMENT_ENV?.trim() === "dev" && rpcUrl && LOCAL_RPC.test(rpcUrl)) return null;
  return [MONAD_TESTNET, MONAD_MAINNET].find((network) => network.chainId === chainId) ?? null;
}

export class DeploymentConfigError extends Error {
  constructor(message: string) {
    super(`Deployment config: ${message}`);
    this.name = "DeploymentConfigError";
  }
}

// How member wallets are held. "local" is the dev-only signer used when Circle keys are absent.
export type Custody =
  | { mode: "circle"; walletSetId: string }
  | { mode: "local" }
  | { mode: "unavailable"; reason: string };

export type ChainDeployment = {
  env: DeploymentEnv;
  network: ChainNetwork;
  rpcUrl: string;
  registryAddress: Address | null;
  relayerAddress: Address | null;
  custody: Custody;
};

type Env = Record<string, string | undefined>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const LOCAL_RPC = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/u;

function isDeploymentEnv(value: string | undefined): value is DeploymentEnv {
  return value === "dev" || value === "staging" || value === "prod";
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Resolves this deployment's chain settings from its environment variables and the committed
 * matrix above, or throws DeploymentConfigError. It does not read secret values beyond checking
 * that they are present and, for CIRCLE_API_KEY, which Circle environment the key belongs to.
 *
 *   DEPLOYMENT_ENV          dev | staging | prod
 *   MONAD_RPC_URL           optional; https only, except a localhost node in dev
 *   CHAIN_REGISTRY_ADDRESS  optional; dev only (a local or fresh dev registry). Elsewhere it may
 *                           only repeat the committed address.
 *   CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID   all three, or none
 *   DEV_WALLET_SECRET       dev only, when the Circle keys are absent
 */
export function assertDeploymentConsistency(env: Env): ChainDeployment {
  const name = env.DEPLOYMENT_ENV;
  if (!isDeploymentEnv(name)) {
    throw new DeploymentConfigError(`DEPLOYMENT_ENV must be dev, staging, or prod (got ${name ?? "nothing"}).`);
  }
  const settings = CHAIN_ENVIRONMENTS[name];
  const network = settings.network;

  // Network: fixed by the environment. Staging and dev never reach mainnet; prod never testnet.
  if (name === "prod" ? network.testnet : !network.testnet) {
    throw new DeploymentConfigError(`${name} is on the wrong Monad network.`);
  }

  // RPC. The live chain ID is checked again before the first chain call (assertRpcChainId).
  const rpcUrl = env.MONAD_RPC_URL?.trim() || network.rpcUrl;
  if (!rpcUrl.startsWith("https://") && !(name === "dev" && LOCAL_RPC.test(rpcUrl))) {
    throw new DeploymentConfigError("MONAD_RPC_URL must use https (a localhost node is allowed in dev).");
  }
  const otherNetwork = network.testnet ? MONAD_MAINNET : MONAD_TESTNET;
  if (rpcUrl.replace(/\/$/u, "") === otherNetwork.rpcUrl) {
    throw new DeploymentConfigError(`MONAD_RPC_URL is the ${otherNetwork.name} endpoint, but ${name} uses ${network.name}.`);
  }

  // Registry address.
  const override = env.CHAIN_REGISTRY_ADDRESS?.trim();
  let registryAddress = settings.registryAddress;
  if (override) {
    if (!ADDRESS.test(override)) throw new DeploymentConfigError("CHAIN_REGISTRY_ADDRESS is not an address.");
    if (name === "dev") {
      registryAddress = override as Address;
    } else if (!registryAddress || !sameAddress(override, registryAddress)) {
      throw new DeploymentConfigError(`CHAIN_REGISTRY_ADDRESS does not match the committed ${name} registry.`);
    }
  }
  if (registryAddress) {
    for (const [otherName, other] of Object.entries(CHAIN_ENVIRONMENTS)) {
      if (otherName !== name && other.registryAddress && sameAddress(other.registryAddress, registryAddress)) {
        throw new DeploymentConfigError(`The registry address belongs to ${otherName}.`);
      }
    }
  }

  // Custody: Circle needs all three values, with a key from this environment's Circle mode.
  const circleValues = [env.CIRCLE_API_KEY, env.CIRCLE_ENTITY_SECRET, env.CIRCLE_WALLET_SET_ID];
  const circleCount = circleValues.filter((value) => value?.trim()).length;
  let custody: Custody;
  if (circleCount === 3) {
    const apiKey = env.CIRCLE_API_KEY!.trim();
    const keyEnvironment = apiKey.startsWith("LIVE_API_KEY:") ? "LIVE" : apiKey.startsWith("TEST_API_KEY:") ? "TEST" : null;
    if (keyEnvironment !== settings.circleKeyEnvironment) {
      throw new DeploymentConfigError(`${name} needs a Circle ${settings.circleKeyEnvironment} API key.`);
    }
    const walletSetId = env.CIRCLE_WALLET_SET_ID!.trim();
    if (settings.circleWalletSetId && walletSetId !== settings.circleWalletSetId) {
      throw new DeploymentConfigError(`CIRCLE_WALLET_SET_ID does not match the committed ${name} wallet set.`);
    }
    for (const [otherName, other] of Object.entries(CHAIN_ENVIRONMENTS)) {
      if (otherName !== name && other.circleWalletSetId === walletSetId) {
        throw new DeploymentConfigError(`CIRCLE_WALLET_SET_ID belongs to ${otherName}.`);
      }
    }
    custody = { mode: "circle", walletSetId };
  } else if (circleCount > 0) {
    throw new DeploymentConfigError("Set all of CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID, or none.");
  } else if (env.DEV_WALLET_SECRET?.trim()) {
    if (name !== "dev") {
      throw new DeploymentConfigError("DEV_WALLET_SECRET is allowed only in dev; staging and prod use Circle wallets.");
    }
    custody = { mode: "local" };
  } else {
    custody = { mode: "unavailable", reason: "No Circle keys are set." };
  }

  return {
    env: name,
    network,
    rpcUrl,
    registryAddress,
    relayerAddress: settings.relayerAddress,
    custody,
  };
}

/**
 * The relayer key must belong to this environment: the committed relayer address when there is
 * one, and never another environment's relayer. A dev deployment pointed at a localhost node
 * (anvil) may use that node's own funded account.
 */
export function assertRelayerAddress(deployment: ChainDeployment, relayerAddress: string) {
  const localDev = deployment.env === "dev" && LOCAL_RPC.test(deployment.rpcUrl);
  if (deployment.relayerAddress && !localDev && !sameAddress(deployment.relayerAddress, relayerAddress)) {
    throw new DeploymentConfigError(`MONAD_RELAYER_PRIVATE_KEY is not the ${deployment.env} relayer.`);
  }
  for (const [otherName, other] of Object.entries(CHAIN_ENVIRONMENTS)) {
    if (otherName !== deployment.env && other.relayerAddress && sameAddress(other.relayerAddress, relayerAddress)) {
      throw new DeploymentConfigError(`MONAD_RELAYER_PRIVATE_KEY belongs to the ${otherName} relayer.`);
    }
  }
}

/** The RPC must report this environment's chain ID before any chain call. */
export function assertRpcChainId(deployment: ChainDeployment, reportedChainId: number) {
  if (reportedChainId !== deployment.network.chainId) {
    throw new DeploymentConfigError(
      `The RPC reports chain ${reportedChainId}, but ${deployment.env} uses ${deployment.network.name} (${deployment.network.chainId}).`,
    );
  }
}
