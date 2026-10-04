import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { setChainDepsForTests } from "../../convex/lib/chain/deps";
import { reasonHashFor, workIdFor, ZERO_BYTES32 } from "../../convex/lib/chain/ids";
import { enqueueRegisterWork } from "../../convex/lib/chain/queue";
import { RELAYER, insertMember, insertWork, setChainWrites, useChainEnv } from "./chainFixtures";
import { FakeChain } from "./fakeChain";
import { newTest } from "./setup";

type T = ReturnType<typeof newTest>;
type Kind = "original" | "variation" | "fork";

function setup() {
  useChainEnv();
  const t = newTest();
  const chain = new FakeChain({ relayer: RELAYER });
  setChainDepsForTests({ rpc: () => chain });
  return { t, chain };
}

const asCtx = (ctx: unknown) => ctx as MutationCtx;
const REASON = reasonHashFor("It was remixed from the harbor piece.");

async function settle(t: T, chain: FakeChain, rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await t.action(internal.chain.tick, {});
    await chain.mine(chain.finalityLag + 1);
  }
  await t.action(internal.chain.tick, {});
}

async function registered(t: T, chain: FakeChain, options: { kind?: Kind; parentWorkId?: Id<"works"> } = {}) {
  const creator = await insertMember(t);
  const workId = await insertWork(t, creator.userId, options);
  await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId));
  await settle(t, chain, 2);
  expect((await t.run((ctx) => ctx.db.get("works", workId)))!.provenanceStatus).toBe("confirmed");
  return workId;
}

function amend(t: T, workId: Id<"works">, newParentWorkId: Id<"works"> | null, newKind: Kind, sequence: number, reasonHash: string = REASON) {
  return t.mutation(internal.amendments.queueLineageAmendment, { workId, newParentWorkId, newKind, reasonHash, sequence });
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code ?? String(error);
  }
  return "queued";
}

const writeOf = (t: T, writeId: Id<"chainWrites">) => t.run(async (ctx) => (await ctx.db.get("chainWrites", writeId))!);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});

afterEach(() => {
  setChainDepsForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("lineage amendments", () => {
  it("records corrections in sequence, original → fork and back", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const harbor = await registered(t, chain);
    const work = await registered(t, chain);

    const first = await amend(t, work, harbor, "fork", 1);
    await settle(t, chain);
    expect(await writeOf(t, first)).toMatchObject({ kind: "amendLineage", status: "confirmed", newParentWorkId: harbor });
    expect(chain.work(workIdFor(work))).toMatchObject({ kind: 2, parentId: workIdFor(harbor) });

    expect(await refusal(amend(t, work, null, "original", 1))).toBe("BAD_SEQUENCE");
    const second = await amend(t, work, null, "original", 2);
    await settle(t, chain);
    expect((await writeOf(t, second)).status).toBe("confirmed");
    expect(chain.work(workIdFor(work))).toMatchObject({ kind: 0, parentId: ZERO_BYTES32 });
    expect(chain.state.amendmentCount.get(workIdFor(work).toLowerCase())).toBe(2n);
    // The original record never changes offchain.
    expect((await t.run((ctx) => ctx.db.get("works", work)))!).toMatchObject({ kind: "original" });
  });

  it("refuses what the registry would revert", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const root = await registered(t, chain);
    const variation = await registered(t, chain, { kind: "variation", parentWorkId: root });
    const other = await registered(t, chain);
    const creator = await insertMember(t);
    const unregistered = await insertWork(t, creator.userId);

    expect(await refusal(amend(t, other, root, "fork", 1, "0x1234"))).toBe("BAD_REASON_HASH");
    expect(await refusal(amend(t, unregistered, root, "fork", 1))).toBe("NOT_REGISTERED");
    expect(await refusal(amend(t, other, root, "fork", 2))).toBe("BAD_SEQUENCE");
    expect(await refusal(amend(t, other, unregistered, "fork", 1))).toBe("PARENT_NOT_REGISTERED");
    expect(await refusal(amend(t, variation, other, "fork", 1))).toBe("KIND_CHANGE_NOT_ALLOWED");
    expect(await refusal(amend(t, other, root, "variation", 1))).toBe("KIND_CHANGE_NOT_ALLOWED");
    expect(await refusal(amend(t, other, root, "original", 1))).toBe("PARENT_NOT_ALLOWED");
    expect(await refusal(amend(t, other, null, "fork", 1))).toBe("PARENT_REQUIRED");
    expect(await refusal(amend(t, other, other, "fork", 1))).toBe("LINEAGE_CYCLE");
    expect(await refusal(amend(t, variation, other, "variation", 1))).toBe("FAMILY_MISMATCH");
    expect(await refusal(amend(t, variation, root, "variation", 1))).toBe("queued");
    expect(await t.run((ctx) => ctx.db.query("chainWrites").collect())).toHaveLength(4);
  });

  it("refuses a parent that descends from the work, over effective lineage", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const a = await registered(t, chain);
    const b = await registered(t, chain, { kind: "fork", parentWorkId: a });
    const c = await registered(t, chain);
    // c becomes a fork of b, so a → b → c; then a can't become a fork of c.
    await amend(t, c, b, "fork", 1);
    await settle(t, chain);
    expect(await refusal(amend(t, a, c, "fork", 1))).toBe("LINEAGE_CYCLE");
    expect(await refusal(amend(t, a, b, "fork", 1))).toBe("LINEAGE_CYCLE");
  });

  it("returns the same write while one is recorded, and reuses a rejected one", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const harbor = await registered(t, chain);
    const other = await registered(t, chain);
    const work = await registered(t, chain);

    const writeId = await amend(t, work, harbor, "fork", 1);
    expect(await amend(t, work, harbor, "fork", 1)).toBe(writeId);
    expect(await refusal(amend(t, work, other, "fork", 1))).toBe("IN_FLIGHT");
    expect(await refusal(amend(t, work, null, "original", 2))).toBe("IN_FLIGHT");

    await t.run((ctx) => ctx.db.patch("chainWrites", writeId, { status: "rejected", revertReason: "FamilyMismatch" }));
    expect(await amend(t, work, other, "fork", 1)).toBe(writeId);
    expect(await writeOf(t, writeId)).toMatchObject({ status: "pending", newParentWorkId: other });
    await settle(t, chain);
    expect((await writeOf(t, writeId)).status).toBe("confirmed");
    expect(chain.work(workIdFor(work))).toMatchObject({ kind: 2, parentId: workIdFor(other) });
  });
});
