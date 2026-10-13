// The whole onchain path against a real CultRemixRegistry on a local anvil node (globalSetup.ts):
// registrations signed by members' dev wallets, a remix waiting on its parent, Backs with their
// ordinals from the Backed event, lineage amendments, a revert the registry refuses, and economic
// configs, all through the chain-write engine and the real viem RPC client. Only setTimeout
// is faked, so the engine's own follow-up ticks don't fire; the test drives each tick and mines
// the blocks that make it final.
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createPublicClient, http, toHex } from "viem";
import { api, internal } from "../../convex/_generated/api";
import { privateKeyToAccount } from "viem/accounts";
import { registryAbi } from "../../convex/lib/chain/abi";
import { managedWalletPrivateKey } from "../../convex/lib/chain/custody";
import { readMonadRecord } from "../../src/lib/monadRecord";
import {
  ZERO_BYTES32,
  configHashFor,
  reasonHashFor,
  workIdFor,
} from "../../convex/lib/chain/ids";
import {
  enqueueAmendment,
  enqueueRegisterWork,
} from "../../convex/lib/chain/queue";
import { ECONOMIC_CONFIG_V2, canonicalConfigJson } from "../../convex/lib/economics";
import { registerConfig } from "../../scripts/chain/deployRegistry";
import { MONAD_TESTNET } from "../../shared/config/chains";
import {
  RELAYER,
  RELAYER_KEY,
  insertMember,
  insertOwner,
  insertWork,
  setChainWrites,
  setFlag,
  useChainEnv,
} from "../convex-local/chainFixtures";
import { newTest } from "../convex-local/setup";
import type { Member } from "../convex-local/chainFixtures";
import type { Abi, Address } from "viem";
import type { MutationCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

const rpcUrl = inject("anvilRpcUrl");
const registry = inject("anvilRegistry");
const reader = createPublicClient({ transport: http(rpcUrl) });

const asCtx = (ctx: unknown) => ctx as MutationCtx;
// convex-test schedules with setTimeout; the clock itself stays real, in step with anvil's blocks.
const SCHEDULER_ONLY: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
};
const REASON = reasonHashFor("The harbor piece came first.");

async function anvil(method: string, params: Array<unknown> = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

// "finalized" trails "latest" by two blocks on this node (one slot per epoch).
const FINALITY_BLOCKS = 3;

/** Ticks and mines until done() holds, or fails with the queue's state. */
async function settle(t: T, done: () => Promise<boolean>, rounds = 10) {
  const summaries: Array<unknown> = [];
  for (let round = 0; round < rounds; round += 1) {
    summaries.push(await t.action(internal.chain.tick, {}));
    await anvil("anvil_mine", [toHex(FINALITY_BLOCKS)]);
    if (await done()) return summaries;
  }
  const writes = await t.run((ctx) => ctx.db.query("chainWrites").collect());
  const queue = writes.map(
    (write) =>
      `${write.subjectKey} ${write.status} ${write.revertReason ?? write.error ?? write.lastBroadcastError ?? ""}`,
  );
  throw new Error(
    `Not settled after ${rounds} rounds.\nLast tick: ${JSON.stringify(summaries.at(-1))}\n${queue.join("\n")}`,
  );
}

const writeOf = (t: T, writeId: Id<"chainWrites">) =>
  t.run(async (ctx) => (await ctx.db.get("chainWrites", writeId))!);
const workOf = (t: T, workId: Id<"works">) =>
  t.run(async (ctx) => (await ctx.db.get("works", workId))!);
type View =
  | "getWork"
  | "amendmentCount"
  | "backerCount"
  | "backOrdinal"
  | "economicConfigHash"
  | "latestEconomicConfigVersion";
// Widened so a view name chosen at runtime type-checks; results are compared as unknown.
const looseAbi: Abi = registryAbi;
const read = (functionName: View, args: Array<unknown> = []) =>
  reader.readContract({ address: registry, abi: looseAbi, functionName, args });

describe("chain writes on a local Monad node", () => {
  let t: T;
  let creator: Member;
  let remixer: Member;
  let alice: Member;
  let bob: Member;
  let harbor: Id<"works">;
  let river: Id<"works">;
  let remix: Id<"works">;

  beforeAll(async () => {
    vi.useFakeTimers(SCHEDULER_ONLY);
    useChainEnv({ MONAD_RPC_URL: rpcUrl, CHAIN_REGISTRY_ADDRESS: registry });
    t = newTest();
    await setChainWrites(t, true);
    await setFlag(t, "social.backs", true);
    [creator, remixer, alice, bob] = [
      await insertMember(t),
      await insertMember(t),
      await insertMember(t),
      await insertMember(t),
    ];
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("registers works signed by their creators, a remix after its parent", async () => {
    harbor = await insertWork(t, creator.userId);
    river = await insertWork(t, creator.userId);
    remix = await insertWork(t, remixer.userId, {
      kind: "fork",
      parentWorkId: harbor,
    });
    // The remix is queued first and waits for its parent's registration to be final.
    const remixWrite = (await t.run((ctx) =>
      enqueueRegisterWork(asCtx(ctx), remix),
    ))!;
    expect((await writeOf(t, remixWrite)).status).toBe("waiting_parent");
    for (const workId of [harbor, river])
      await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId));

    await settle(t, async () =>
      (
        await Promise.all([harbor, river, remix].map((id) => workOf(t, id)))
      ).every((work) => work.provenanceStatus === "confirmed"),
    );

    const onchain = (await read("getWork", [workIdFor(remix)])) as {
      creator: Address;
      kind: number;
      parentId: string;
    };
    expect(onchain).toMatchObject({
      creator: remixer.address,
      kind: 2,
      parentId: workIdFor(harbor),
    });
    expect(
      ((await read("getWork", [workIdFor(harbor)])) as { creator: Address })
        .creator,
    ).toBe(creator.address);
    const write = await writeOf(t, remixWrite);
    expect(write).toMatchObject({
      status: "confirmed",
      chainId: 10143,
      registryAddress: registry,
    });
    const receipt = await reader.getTransactionReceipt({
      hash: write.txHash as `0x${string}`,
    });
    expect(receipt.status).toBe("success");
    expect(receipt.from.toLowerCase()).toBe(RELAYER.toLowerCase());

    // /onchain's in-browser check reads the same record with plain JSON-RPC calls.
    const remixWork = await workOf(t, remix);
    const record = await readMonadRecord({ rpcUrl, registry, family: remixWork.crFamily, expression: remixWork.crExpression });
    expect(record).toMatchObject({ workId: workIdFor(remix), creator: remixer.address.toLowerCase(), kind: 2, contentHash: remixWork.contentHash });
  });

  it("records Backs with each backer's place in line", async () => {
    const as = (member: Member) =>
      t.withIdentity({ subject: member.authId, issuer: "test" });
    const { backId: aliceBack } = await as(alice).mutation(api.backs.back, {
      workId: harbor,
    });
    const { backId: bobBack } = await as(bob).mutation(api.backs.back, {
      workId: harbor,
    });
    const backs = () =>
      t.run(async (ctx) => [
        (await ctx.db.get("backs", aliceBack))!,
        (await ctx.db.get("backs", bobBack))!,
      ]);

    await settle(t, async () =>
      (await backs()).every((back) => back.status === "confirmed"),
    );

    const [first, second] = await backs();
    expect(new Set([first.ordinal, second.ordinal])).toEqual(new Set([1, 2]));
    expect(await read("backOrdinal", [workIdFor(harbor), alice.address])).toBe(
      BigInt(first.ordinal!),
    );
    expect(await read("backOrdinal", [workIdFor(harbor), bob.address])).toBe(
      BigInt(second.ordinal!),
    );
    expect(await read("backerCount", [workIdFor(harbor)])).toBe(2n);
    const view = await as(alice).query(api.backs.forWork, { workId: harbor });
    expect(view).toMatchObject({
      count: 2,
      viewer: { status: "confirmed", ordinal: first.ordinal },
    });
  });

  it("amends lineage in sequence, keeping the original record offchain", async () => {
    const first = await t.mutation(internal.amendments.queueLineageAmendment, {
      workId: river,
      newParentWorkId: harbor,
      newKind: "fork",
      reasonHash: REASON,
      sequence: 1,
    });
    await settle(
      t,
      async () => (await writeOf(t, first)).status === "confirmed",
    );
    expect(await read("getWork", [workIdFor(river)])).toMatchObject({
      kind: 2,
      parentId: workIdFor(harbor),
    });

    const second = await t.mutation(internal.amendments.queueLineageAmendment, {
      workId: river,
      newParentWorkId: null,
      newKind: "original",
      reasonHash: REASON,
      sequence: 2,
    });
    await settle(
      t,
      async () => (await writeOf(t, second)).status === "confirmed",
    );
    expect(await read("getWork", [workIdFor(river)])).toMatchObject({
      kind: 0,
      parentId: ZERO_BYTES32,
    });
    expect(await read("amendmentCount", [workIdFor(river)])).toBe(2n);
    expect(await workOf(t, river)).toMatchObject({ kind: "original" });
  });

  it("marks a write the registry refuses as rejected, with the registry's reason", async () => {
    // queueLineageAmendment would refuse this; enqueue it directly to reach the contract's own rule.
    const writeId = await t.run(async (ctx) => {
      const [work, parent] = [
        (await ctx.db.get("works", remix))!,
        (await ctx.db.get("works", harbor))!,
      ];
      return await enqueueAmendment(asCtx(ctx), {
        work,
        newParent: parent,
        newKind: "variation",
        reasonHash: REASON,
        sequence: 1,
      });
    });
    await settle(
      t,
      async () => (await writeOf(t, writeId)).status === "rejected",
    );
    expect((await writeOf(t, writeId)).revertReason).toBe(
      "KindChangeNotAllowed",
    );
    expect(await read("amendmentCount", [workIdFor(remix)])).toBe(0n);
  });

  it("confirms economic config v1 registered by the deploy script, and sends v2 itself", async () => {
    // scripts/chain/deploy-testnet.ts registers v1 right after deploying, with the relayer's key.
    const v1 = configHashFor(canonicalConfigJson());
    // viem polls for the receipt with real timers.
    vi.useRealTimers();
    await registerConfig(
      { rpcUrl, chainId: MONAD_TESTNET.chainId, name: "anvil" },
      RELAYER_KEY,
      registry,
      1,
      v1,
    );
    vi.useFakeTimers(SCHEDULER_ONLY);
    // Final before the queue sees it, as after a real deploy. (Until then the engine defers: the
    // revert has to hold at the finalized block, and the retry backs off on the real clock.)
    await anvil("anvil_mine", [toHex(FINALITY_BLOCKS)]);
    const owner = await insertOwner(t);
    // Registering queues v1 (already onchain) and then the current rules, v2.
    const v2 = configHashFor(canonicalConfigJson(ECONOMIC_CONFIG_V2));
    expect(
      (await owner.mutation(api.chainAdmin.registerEconomicConfig, {}))
        .configHash,
    ).toBe(v2);
    const configWrite = async (version: number) =>
      (await t.run((ctx) =>
        ctx.db
          .query("chainWrites")
          .withIndex("by_subjectKey", (q) =>
            q.eq("subjectKey", `config:${version}`),
          )
          .unique(),
      ))!;
    await settle(t, async () => (await configWrite(1)).status === "confirmed");
    // Found onchain, so nothing was sent.
    expect((await configWrite(1)).txs).toEqual([]);

    await settle(t, async () => (await configWrite(2)).status === "confirmed");
    expect((await configWrite(2)).txHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(await read("economicConfigHash", [1n])).toBe(v1);
    expect(await read("economicConfigHash", [2n])).toBe(v2);
    expect(await read("latestEconomicConfigVersion")).toBe(2n);
  });

  it("registers a work signed by a managed wallet (the stopgap until Circle)", async () => {
    const secret = "m".repeat(32);
    vi.stubEnv("MANAGED_WALLET_SECRET", secret);
    const member = await insertMember(t, { walletReady: false });
    const address = privateKeyToAccount(await managedWalletPrivateKey(secret, member.userId)).address;
    await t.run((ctx) => ctx.db.patch("users", member.userId, { walletStatus: "ready", walletCustody: "managed", walletAddress: address }));
    const workId = await insertWork(t, member.userId);
    await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId));
    await settle(t, async () => (await workOf(t, workId)).provenanceStatus === "confirmed");
    expect(((await read("getWork", [workIdFor(workId)])) as { creator: Address }).creator).toBe(address);
  });

  it("leaves the relayer's nonce in step with the chain and nothing stalled", async () => {
    const state = (await t.run((ctx) =>
      ctx.db.query("relayerState").unique(),
    ))!;
    expect(state.stalled).toBeUndefined();
    expect(state.nextNonce).toBe(
      await reader.getTransactionCount({ address: RELAYER }),
    );
    const unsettled = await t.run((ctx) =>
      ctx.db.query("chainWrites").collect(),
    );
    expect(
      unsettled.filter(
        (write) => write.status !== "confirmed" && write.status !== "rejected",
      ),
    ).toEqual([]);
  });
});
