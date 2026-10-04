import { describe, expect, it } from "vitest";
import {
  CHAIN_ENVIRONMENTS,
  DeploymentConfigError,
  MONAD_MAINNET,
  MONAD_TESTNET,
  assertDeploymentConsistency,
  assertRelayerAddress,
  assertRpcChainId,
  explorerAddressUrl,
  explorerTxUrl,
} from "../../shared/config/chains";

const TEST_CIRCLE = {
  CIRCLE_API_KEY: "TEST_API_KEY:abc:def",
  CIRCLE_ENTITY_SECRET: "entity",
  CIRCLE_WALLET_SET_ID: "set-1",
};

describe("assertDeploymentConsistency (KTD-14)", () => {
  it("puts dev and staging on testnet and prod on mainnet", () => {
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev" }).network.chainId).toBe(10143);
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging" }).network.chainId).toBe(10143);
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "prod" }).network.chainId).toBe(143);
    expect(CHAIN_ENVIRONMENTS.dev.network.circleBlockchain).toBe("MONAD-TESTNET");
    expect(CHAIN_ENVIRONMENTS.prod.network.circleBlockchain).toBe("MONAD");
  });

  it("refuses an unknown or missing environment", () => {
    expect(() => assertDeploymentConsistency({})).toThrow(DeploymentConfigError);
    expect(() => assertDeploymentConsistency({ DEPLOYMENT_ENV: "production" })).toThrow(/dev, staging, or prod/);
  });

  it("refuses prod pointed at the testnet RPC, and testnet environments at the mainnet RPC", () => {
    expect(() =>
      assertDeploymentConsistency({ DEPLOYMENT_ENV: "prod", MONAD_RPC_URL: MONAD_TESTNET.rpcUrl }),
    ).toThrow(/Monad Testnet endpoint/);
    expect(() =>
      assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging", MONAD_RPC_URL: `${MONAD_MAINNET.rpcUrl}/` }),
    ).toThrow(/Monad endpoint/);
  });

  it("allows a localhost node only in dev", () => {
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", MONAD_RPC_URL: "http://127.0.0.1:8545" }).rpcUrl).toBe(
      "http://127.0.0.1:8545",
    );
    expect(() =>
      assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging", MONAD_RPC_URL: "http://127.0.0.1:8545" }),
    ).toThrow(/https/);
    expect(() => assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", MONAD_RPC_URL: "http://example.com" })).toThrow(
      /https/,
    );
  });

  it("lets dev override the registry address but not staging or prod", () => {
    const address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", CHAIN_REGISTRY_ADDRESS: address }).registryAddress).toBe(
      address,
    );
    expect(() => assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging", CHAIN_REGISTRY_ADDRESS: address })).toThrow(
      /committed staging registry/,
    );
    expect(() => assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", CHAIN_REGISTRY_ADDRESS: "0x123" })).toThrow(
      /not an address/,
    );
  });

  it("needs a Circle key from the environment's Circle mode", () => {
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging", ...TEST_CIRCLE }).custody).toEqual({
      mode: "circle",
      walletSetId: "set-1",
    });
    expect(() => assertDeploymentConsistency({ DEPLOYMENT_ENV: "prod", ...TEST_CIRCLE })).toThrow(/LIVE API key/);
    expect(() =>
      assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", ...TEST_CIRCLE, CIRCLE_API_KEY: "LIVE_API_KEY:x:y" }),
    ).toThrow(/TEST API key/);
  });

  it("refuses a partial Circle configuration", () => {
    expect(() =>
      assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", CIRCLE_API_KEY: TEST_CIRCLE.CIRCLE_API_KEY }),
    ).toThrow(/or none/);
  });

  it("allows the local signer only in dev without Circle keys", () => {
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", DEV_WALLET_SECRET: "s" }).custody).toEqual({
      mode: "local",
    });
    expect(() => assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging", DEV_WALLET_SECRET: "s" })).toThrow(
      /only in dev/,
    );
    expect(() => assertDeploymentConsistency({ DEPLOYMENT_ENV: "prod", DEV_WALLET_SECRET: "s" })).toThrow(/only in dev/);
    // Circle wins when both are present in dev.
    expect(
      assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev", DEV_WALLET_SECRET: "s", ...TEST_CIRCLE }).custody.mode,
    ).toBe("circle");
    expect(assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging" }).custody.mode).toBe("unavailable");
  });

  it("refuses another environment's relayer key", () => {
    const dev = assertDeploymentConsistency({ DEPLOYMENT_ENV: "dev" });
    const prod = assertDeploymentConsistency({ DEPLOYMENT_ENV: "prod" });
    const devRelayer = CHAIN_ENVIRONMENTS.dev.relayerAddress!;
    expect(() => assertRelayerAddress(dev, devRelayer.toLowerCase())).not.toThrow();
    expect(() => assertRelayerAddress(dev, "0x0000000000000000000000000000000000000001")).toThrow(/not the dev relayer/);
    expect(() => assertRelayerAddress(prod, devRelayer)).toThrow(/belongs to the dev relayer/);
  });

  it("checks the chain ID the RPC reports", () => {
    const prod = assertDeploymentConsistency({ DEPLOYMENT_ENV: "prod" });
    expect(() => assertRpcChainId(prod, 143)).not.toThrow();
    expect(() => assertRpcChainId(prod, 10143)).toThrow(/reports chain 10143/);
  });

  it("links to Monadscan", () => {
    expect(explorerTxUrl(MONAD_TESTNET, "0xabc")).toBe("https://testnet.monadscan.com/tx/0xabc");
    expect(explorerAddressUrl(MONAD_MAINNET, "0xdef")).toBe("https://monadscan.com/address/0xdef");
  });
});
