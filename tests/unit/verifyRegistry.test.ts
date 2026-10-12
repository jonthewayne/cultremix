import { describe, expect, it } from "vitest";
import { chainEnvValue } from "../../scripts/chain/chainEnv";
import { REGISTRY_CONTRACT, SOURCIFY_MONAD_URL, constructorArgs, sourcifyMatch, verifyArgs, verifyEnv } from "../../scripts/chain/verifyRegistry";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROD_RELAYER = "0x1672581d1B190d045197439039446bD48bd9a74A";
const DEV_RELAYER = "0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921";
const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("verifying the registry on Monad's explorers", () => {
  it("encodes the constructor's (admin, relayer) as cast does", () => {
    // cast abi-encode 'constructor(address,address)' <prod relayer> <dev relayer>
    expect(constructorArgs(PROD_RELAYER, DEV_RELAYER)).toBe(
      "0x0000000000000000000000001672581d1b190d045197439039446bd48bd9a74a0000000000000000000000007d39bcfd08b206feaacb4f1e2817adb22e06f921",
    );
  });

  it("asks forge for Sourcify through Monad's endpoint, or Monadscan through Etherscan's v2 API", () => {
    const base = { chainId: 143, registry: REGISTRY, admin: PROD_RELAYER, relayer: PROD_RELAYER } as const;
    const sourcify = verifyArgs({ ...base, verifier: "sourcify" });
    expect(sourcify.slice(0, 5)).toEqual(["verify-contract", REGISTRY, REGISTRY_CONTRACT, "--chain", "143"]);
    expect(sourcify).toContain(constructorArgs(PROD_RELAYER, PROD_RELAYER));
    expect(sourcify.slice(-4)).toEqual(["--verifier", "sourcify", "--verifier-url", SOURCIFY_MONAD_URL]);
    expect(verifyArgs({ ...base, chainId: 10143, verifier: "etherscan" }).slice(-4)).toEqual([
      "--verifier",
      "etherscan",
      "--verifier-url",
      "https://api.etherscan.io/v2/api?chainid=10143",
    ]);
  });

  it("hands forge the Etherscan key only in its environment, and only for Etherscan", () => {
    const args = verifyArgs({ chainId: 143, registry: REGISTRY, admin: PROD_RELAYER, relayer: PROD_RELAYER, verifier: "etherscan" });
    expect(args.join(" ")).not.toContain("secret-key");
    expect(verifyEnv({ PATH: "/bin" }, "etherscan", "secret-key")).toEqual({ PATH: "/bin", ETHERSCAN_API_KEY: "secret-key" });
    // A key in the shell's environment never reaches the Sourcify run.
    expect(verifyEnv({ PATH: "/bin", ETHERSCAN_API_KEY: "inherited" }, "sourcify")).toEqual({ PATH: "/bin" });
    expect(() => verifyEnv({}, "etherscan")).toThrow(/Etherscan API key/u);
  });

  it("reads Sourcify's match for an address, and null when it isn't verified", async () => {
    const seen: Array<string> = [];
    const answer = (status: number, body: unknown) =>
      (async (url: string) => {
        seen.push(url);
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch;
    expect(await sourcifyMatch(143, REGISTRY, answer(200, { match: "exact_match" }))).toBe("exact_match");
    expect(seen[0]).toBe(`${SOURCIFY_MONAD_URL}/v2/contract/143/${REGISTRY}`);
    expect(await sourcifyMatch(143, REGISTRY, answer(404, { match: null }))).toBeNull();
    await expect(sourcifyMatch(143, REGISTRY, answer(500, {}))).rejects.toThrow(/500/u);
  });

  it("reads a key from chain.env, quoted or not, and nothing for a missing file or name", () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-env-"));
    const file = join(dir, "chain.env");
    writeFileSync(file, "# keys\nexport ETHERSCAN_API_KEY=\"abc123\"\nEMPTY=\nMONAD_RPC_URL_MAINNET = https://rpc.example\n");
    expect(chainEnvValue("ETHERSCAN_API_KEY", file)).toBe("abc123");
    expect(chainEnvValue("MONAD_RPC_URL_MAINNET", file)).toBe("https://rpc.example");
    expect(chainEnvValue("EMPTY", file)).toBeNull();
    expect(chainEnvValue("NOPE", file)).toBeNull();
    expect(chainEnvValue("ETHERSCAN_API_KEY", join(dir, "missing.env"))).toBeNull();
  });
});
