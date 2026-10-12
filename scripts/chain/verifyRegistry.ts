// Verifies a deployed CultRemixRegistry's source code, so explorers show it with a Read Contract
// tab: on Sourcify through Monad's endpoint (MonadVision shows those; no key needed), and on
// Monadscan through Etherscan's API when there's an Etherscan key. forge recompiles
// contracts/src/CultRemixRegistry.sol with contracts/foundry.toml's settings, which reproduce the
// deployed bytecode exactly, metadata hash included (checked October 12 against
// scripts/chain/registryArtifact.ts). The key never goes on a command line or into output.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters } from "viem";
import type { Address } from "viem";

// Monad's Sourcify instance (BlockVision), as Monad's Foundry template uses; it serves chains 143 and
// 10143.
export const SOURCIFY_MONAD_URL = "https://sourcify-api-monad.blockvision.org";
export const REGISTRY_CONTRACT = "src/CultRemixRegistry.sol:CultRemixRegistry";

export type Verifier = "sourcify" | "etherscan";
export type VerifyTarget = { verifier: Verifier; chainId: number; registry: Address; admin: Address; relayer: Address };

// The registry's constructor arguments, ABI-encoded: (admin, relayer).
export function constructorArgs(admin: Address, relayer: Address) {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }], [admin, relayer]);
}

// forge's arguments for one verifier. forge reads an Etherscan key from ETHERSCAN_API_KEY in its
// environment, so the key is never an argument.
export function verifyArgs(target: VerifyTarget): Array<string> {
  const common = [
    "verify-contract",
    target.registry,
    REGISTRY_CONTRACT,
    "--chain",
    String(target.chainId),
    "--constructor-args",
    constructorArgs(target.admin, target.relayer),
    "--watch",
  ];
  return target.verifier === "sourcify"
    ? [...common, "--verifier", "sourcify", "--verifier-url", SOURCIFY_MONAD_URL]
    : [...common, "--verifier", "etherscan", "--verifier-url", `https://api.etherscan.io/v2/api?chainid=${target.chainId}`];
}

// The environment forge runs in: an Etherscan key only for Etherscan, and never one inherited.
export function verifyEnv(base: Record<string, string | undefined>, verifier: Verifier, etherscanKey?: string) {
  const env: Record<string, string | undefined> = { ...base };
  delete env.ETHERSCAN_API_KEY;
  if (verifier === "etherscan") {
    if (!etherscanKey) throw new Error("Verifying on Monadscan needs an Etherscan API key.");
    env.ETHERSCAN_API_KEY = etherscanKey;
  }
  return env;
}

function forgeBin() {
  const installed = join(homedir(), ".foundry", "bin", "forge");
  return process.env.FORGE_BIN?.trim() || (existsSync(installed) ? installed : "forge");
}

// Runs one verification. ok is forge's exit status (with --watch it waits for the verdict); summary
// is forge's last lines, with the key masked in case a message ever repeats it.
export async function runVerify(target: VerifyTarget, etherscanKey?: string) {
  const proc = Bun.spawn([forgeBin(), ...verifyArgs(target)], {
    cwd: fileURLToPath(new URL("../../contracts", import.meta.url)),
    env: verifyEnv(process.env, target.verifier, etherscanKey),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  let text = `${out}\n${err}`;
  if (etherscanKey) text = text.split(etherscanKey).join("***");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: code === 0, summary: lines.slice(-4).join("\n") };
}

// What Monad's Sourcify holds for a contract: "exact_match" (the metadata hash too), "match", or null
// when it isn't verified there.
export async function sourcifyMatch(chainId: number, address: Address, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl(`${SOURCIFY_MONAD_URL}/v2/contract/${chainId}/${address}`, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Sourcify answered ${response.status}.`);
  const body = (await response.json()) as { match?: string | null };
  return body.match ?? null;
}

export type VerifyResult = { explorer: string; ok: boolean; detail: string };

// Sourcify always, then Monadscan when there's an Etherscan key. Sourcify counts as verified when its
// lookup finds a match, whatever forge printed (an already verified contract, say).
export async function verifyEverywhere(base: Omit<VerifyTarget, "verifier">, etherscanKey?: string): Promise<Array<VerifyResult>> {
  const results: Array<VerifyResult> = [];
  const sourcify = await runVerify({ ...base, verifier: "sourcify" });
  const match = await sourcifyMatch(base.chainId, base.registry).catch(() => null);
  results.push({
    explorer: "Sourcify (MonadVision)",
    ok: match !== null,
    detail: match ? `verified, ${match.replace("_", " ")}` : sourcify.summary || "not verified",
  });
  if (etherscanKey) {
    const etherscan = await runVerify({ ...base, verifier: "etherscan" }, etherscanKey);
    results.push({ explorer: "Monadscan", ok: etherscan.ok, detail: etherscan.ok ? "verified" : etherscan.summary });
  } else {
    results.push({ explorer: "Monadscan", ok: false, detail: "skipped: put ETHERSCAN_API_KEY in ~/.config/cultremix/chain.env to verify there too" });
  }
  return results;
}
