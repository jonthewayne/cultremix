// Deploys CultRemixRegistry with viem and registers an economic config hash, as the registry
// admin. Shared by scripts/chain/deploy-testnet.ts and the anvil run (tests/chain-e2e). Never
// prints or returns the key it is given.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeRegisterEconomicConfig } from "../../convex/lib/chain/calldata";
import { registryAbi, registryBytecode } from "./registryArtifact";
import type { Address, Hex } from "viem";

export type RegistryTarget = { rpcUrl: string; chainId: number; name: string };

function clients(target: RegistryTarget, key: Hex) {
  const chain = defineChain({
    id: target.chainId,
    name: target.name,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [target.rpcUrl] } },
  });
  const account = privateKeyToAccount(key);
  const transport = http(target.rpcUrl, { retryCount: 2, timeout: 30_000 });
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

/** What a deployment costs at today's fees, and what the deployer holds. Read-only. */
export async function deploymentQuote(
  target: RegistryTarget,
  key: Hex,
  options: { admin?: Address; relayer?: Address } = {},
) {
  const { account, publicClient } = clients(target, key);
  const data = encodeDeployData({
    abi: registryAbi,
    bytecode: registryBytecode,
    args: [
      options.admin ?? account.address,
      options.relayer ?? account.address,
    ],
  });
  const [chainId, balance, fees, gas] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBalance({ address: account.address }),
    publicClient.estimateFeesPerGas(),
    publicClient.estimateGas({ account, data }),
  ]);
  return {
    deployer: account.address,
    chainId,
    balance,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    cost: gas * fees.maxFeePerGas,
  };
}

export async function deployRegistry(
  target: RegistryTarget,
  key: Hex,
  options: { admin?: Address; relayer?: Address } = {},
) {
  const { account, publicClient, walletClient } = clients(target, key);
  const reported = await publicClient.getChainId();
  if (reported !== target.chainId)
    throw new Error(
      `The RPC reports chain ${reported}, not ${target.chainId}.`,
    );
  const admin = options.admin ?? account.address;
  const relayer = options.relayer ?? account.address;
  const txHash = await walletClient.deployContract({
    abi: registryAbi,
    bytecode: registryBytecode,
    args: [admin, relayer],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`The deployment ${txHash} did not succeed.`);
  const address = getAddress(receipt.contractAddress);
  const [onchainAdmin, listed] = await Promise.all([
    publicClient.readContract({
      address,
      abi: registryAbi,
      functionName: "admin",
    }),
    publicClient.readContract({
      address,
      abi: registryAbi,
      functionName: "isRelayer",
      args: [relayer],
    }),
  ]);
  if (onchainAdmin.toLowerCase() !== admin.toLowerCase() || !listed)
    throw new Error(
      "The new registry doesn't list the expected admin and relayer.",
    );
  return { address, txHash, blockNumber: receipt.blockNumber, admin, relayer };
}

/** Registers an economic config hash as the registry admin; a version already holding this hash is left alone. */
export async function registerConfig(
  target: RegistryTarget,
  key: Hex,
  registry: Address,
  version: number,
  configHash: Hex,
) {
  const { publicClient, walletClient } = clients(target, key);
  const existing = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "economicConfigHash",
    args: [BigInt(version)],
  });
  if (existing.toLowerCase() === configHash.toLowerCase())
    return { txHash: null, alreadyRegistered: true };
  if (!/^0x0{64}$/u.test(existing))
    throw new Error(
      `Config version ${version} is already registered with another hash.`,
    );
  const txHash = await walletClient.sendTransaction({
    to: registry,
    data: encodeRegisterEconomicConfig(BigInt(version), configHash),
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success")
    throw new Error(`Registering config ${version} (${txHash}) reverted.`);
  return { txHash, alreadyRegistered: false };
}
