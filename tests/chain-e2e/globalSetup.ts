// Starts a private anvil node posing as Monad testnet (chain 10143) and deploys
// CultRemixRegistry to it with scripts/chain/deployRegistry.ts, from anvil's first account, which
// is also the registry's admin and relayer. The tests get the RPC URL and registry address through
// inject(). Nothing here reaches a public network.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { MONAD_TESTNET } from "../../shared/config/chains";
import { deployRegistry } from "../../scripts/chain/deployRegistry";
import type { ChildProcess } from "node:child_process";
import type { TestProject } from "vitest/node";

// Anvil's first account: a well-known test key, never a real relayer.
const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

declare module "vitest" {
  export interface ProvidedContext {
    anvilRpcUrl: string;
    anvilRegistry: `0x${string}`;
  }
}

function anvilBinary() {
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;
  const foundry = join(homedir(), ".foundry", "bin", "anvil");
  return existsSync(foundry) ? foundry : "anvil";
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No free port.")),
      );
    });
  });
}

async function waitForRpc(rpcUrl: string, anvil: ChildProcess) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (anvil.exitCode !== null)
      throw new Error(`anvil exited with code ${anvil.exitCode}.`);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("anvil didn't start within 10 seconds.");
}

export default async function setup(project: TestProject) {
  const port = await freePort();
  // One slot per epoch keeps "finalized" two blocks behind "latest", so finality is a few mined blocks away.
  const anvil = spawn(
    anvilBinary(),
    [
      "--chain-id",
      String(MONAD_TESTNET.chainId),
      "--port",
      String(port),
      "--slots-in-an-epoch",
      "1",
      "--silent",
    ],
    {
      stdio: "ignore",
    },
  );
  const spawned = new Promise<void>((resolve, reject) => {
    anvil.once("spawn", resolve);
    anvil.once("error", (error) =>
      reject(
        new Error(
          `Couldn't start anvil (${error.message}). Install Foundry or set ANVIL_BIN.`,
        ),
      ),
    );
  });
  const stop = () => {
    if (anvil.exitCode === null) anvil.kill("SIGTERM");
  };
  try {
    await spawned;
    const rpcUrl = `http://127.0.0.1:${port}`;
    await waitForRpc(rpcUrl, anvil);
    const deployed = await deployRegistry(
      { rpcUrl, chainId: MONAD_TESTNET.chainId, name: "anvil" },
      ANVIL_KEY,
    );
    project.provide("anvilRpcUrl", rpcUrl);
    project.provide("anvilRegistry", deployed.address);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
