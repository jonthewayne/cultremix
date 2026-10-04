import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { setChainDepsForTests } from "../../convex/lib/chain/deps";
import { reasonHashFor, workIdFor, ZERO_BYTES32 } from "../../convex/lib/chain/ids";
import { enqueueRegisterWork, writeBySubject } from "../../convex/lib/chain/queue";
import { formatCr } from "../../convex/lib/r2";
import { RELAYER, insertMember, insertOwner, insertWork, setChainWrites, useChainEnv } from "./chainFixtures";
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

async function registered(t: T, chain: FakeChain, options: Parameters<typeof insertWork>[2] = {}) {
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

// Lineage corrections requested on the admin page (convex/lineage.ts) go through
// queueLineageAmendment from the chain kick, and the write's outcome decides the correction.
describe("lineage corrections from the admin page", () => {
  // Families the admin page can address by CR number (three digits or more).
  let family = 800;
  const addressable = (options: Parameters<typeof insertWork>[2] = {}) => ({ ...options, fields: { crFamily: (family += 1), ...options.fields } });
  const crOf = async (t: T, workId: Id<"works">) => {
    const work = (await t.run((ctx) => ctx.db.get("works", workId)))!;
    return formatCr(work.crFamily, work.crExpression);
  };
  const correction = (t: T, amendmentId: Id<"lineageAmendments">) => t.run(async (ctx) => (await ctx.db.get("lineageAmendments", amendmentId))!);
  const amendWrite = (t: T, workId: Id<"works">, sequence: number) => t.run((ctx) => writeBySubject(asCtx(ctx), `amend:${workId}:${sequence}`));
  const REASON_TEXT = "It was remixed from the harbor piece.";

  async function request(t: T, owner: ReturnType<T["withIdentity"]>, workId: Id<"works">, newKind: Kind, newParentWorkId?: Id<"works">) {
    return await owner.mutation(api.lineage.requestAmendment, {
      cr: await crOf(t, workId),
      newKind,
      newParentCr: newParentWorkId ? await crOf(t, newParentWorkId) : undefined,
      reason: REASON_TEXT,
    });
  }

  it("sends a requested correction and confirms it offchain when the registry records it", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const owner = await insertOwner(t);
    const harbor = await registered(t, chain, addressable());
    const work = await registered(t, chain, addressable());
    const amendmentId = await request(t, owner, work, "fork", harbor);

    expect(await t.mutation(internal.chain.kick, {})).toBe(true);
    const write = (await amendWrite(t, work, 1))!;
    expect(write).toMatchObject({ kind: "amendLineage", status: "pending", amendmentId, newParentWorkId: harbor });
    expect(write.payload).toContain(REASON);
    expect(await correction(t, amendmentId)).toMatchObject({ status: "submitted", chainWriteId: write._id });
    // Kicking again sends nothing new.
    await t.mutation(internal.chain.kick, {});
    expect(await t.run((ctx) => ctx.db.query("chainWrites").collect())).toHaveLength(3);

    await settle(t, chain);
    expect((await writeOf(t, write._id)).status).toBe("confirmed");
    expect(chain.work(workIdFor(work))).toMatchObject({ kind: 2, parentId: workIdFor(harbor) });
    const confirmed = await correction(t, amendmentId);
    expect(confirmed).toMatchObject({ status: "confirmed" });
    expect(confirmed.offchainOnly).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get("works", work)))!).toMatchObject({
      kind: "original",
      effectiveKind: "fork",
      effectiveParentWorkId: harbor,
      lineageAmendedAt: confirmed.effectiveFrom,
    });
  });

  it("waits while chain writes are off or the work is still registering", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const owner = await insertOwner(t);
    const harbor = await registered(t, chain, addressable());
    const creator = await insertMember(t);
    const work = await insertWork(t, creator.userId, addressable());
    const amendmentId = await request(t, owner, work, "fork", harbor);

    await setChainWrites(t, false);
    await t.mutation(internal.chain.kick, {});
    expect((await correction(t, amendmentId)).status).toBe("requested");

    await setChainWrites(t, true);
    await t.mutation(internal.chain.kick, {});
    expect((await correction(t, amendmentId)).status).toBe("requested");
    expect(await amendWrite(t, work, 1)).toBeNull();

    await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), work));
    await settle(t, chain, 2);
    await t.mutation(internal.chain.kick, {});
    expect((await correction(t, amendmentId)).status).toBe("submitted");
    await settle(t, chain);
    expect((await correction(t, amendmentId)).status).toBe("confirmed");
  });

  it("rejects a correction the registry's lineage can't take", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const harbor = await registered(t, chain, addressable());
    const work = await registered(t, chain, addressable());
    // An original can't become a variation onchain. The admin page refuses this too; the row is
    // written directly to stand for any correction the registry's lineage disagrees with.
    const adminId = (await insertMember(t)).userId;
    const amendmentId = await t.run((ctx) =>
      ctx.db.insert("lineageAmendments", {
        workId: work,
        sequence: 1,
        chainSequence: 1,
        fromKind: "original",
        newKind: "variation",
        newParentId: harbor,
        reason: REASON_TEXT,
        adminId,
        status: "requested",
        requestedAt: Date.now(),
      }),
    );

    await t.mutation(internal.chain.kick, {});
    expect(await correction(t, amendmentId)).toMatchObject({ status: "rejected", rejectReason: "A work's kind changes only between original and fork." });
    expect(await amendWrite(t, work, 1)).toBeNull();
  });

  it("rejects the correction when the registry refuses the write, and sends it again when requested again", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const owner = await insertOwner(t);
    const harbor = await registered(t, chain, addressable());
    const work = await registered(t, chain, addressable());
    const first = await request(t, owner, work, "fork", harbor);
    await t.mutation(internal.chain.kick, {});
    const writeId = (await amendWrite(t, work, 1))!._id;

    // Onchain, the harbor piece moved into the work's family since: a fork's parent can't be there.
    const onchainHarbor = chain.work(workIdFor(harbor))!;
    const harborFamily = onchainHarbor.family;
    onchainHarbor.family = chain.work(workIdFor(work))!.family;
    // The engine acts on a revert only once finalized state gives the same reason.
    await chain.mine(chain.finalityLag + 1);
    await settle(t, chain);
    const refused = await writeOf(t, writeId);
    expect(refused).toMatchObject({ status: "rejected", revertReason: "FamilyMismatch" });
    expect(await correction(t, first)).toMatchObject({ status: "rejected", rejectReason: refused.error });
    expect((await t.run((ctx) => ctx.db.get("works", work)))!.effectiveKind).toBeUndefined();

    // Not from /admin/chain: the correction is already rejected.
    await t.run((ctx) => ctx.db.patch("chainWrites", writeId, { status: "failed" }));
    const row = (await owner.query(api.chainAdmin.overview, {})).recent.find((write) => write._id === writeId);
    expect(row).toMatchObject({ retryable: false });
    await expect(owner.mutation(api.chainAdmin.retryWrite, { writeId })).rejects.toMatchObject({ data: { code: "CORRECTION" } });

    chain.work(workIdFor(harbor))!.family = harborFamily;
    await chain.mine(chain.finalityLag + 1);
    const second = await request(t, owner, work, "fork", harbor);
    await t.mutation(internal.chain.kick, {});
    expect(await writeOf(t, writeId)).toMatchObject({ status: "pending", amendmentId: second });
    expect(await correction(t, second)).toMatchObject({ status: "submitted", chainWriteId: writeId });
    await settle(t, chain);
    expect(await correction(t, second)).toMatchObject({ status: "confirmed" });
    expect(await correction(t, first)).toMatchObject({ status: "rejected" });
    expect((await t.run((ctx) => ctx.db.get("works", work)))!).toMatchObject({ effectiveKind: "fork", effectiveParentWorkId: harbor });
  });

  it("shows the Economics panel's shares as recorded once the work is registered", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const work = await insertWork(t, creator.userId, addressable());
    const cr = await crOf(t, work);
    expect((await t.query(api.workEconomics.panel, { cr }))!.provenance).toBe("pending");
    await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), work));
    await settle(t, chain, 2);
    expect((await t.query(api.workEconomics.panel, { cr }))!.provenance).toBe("confirmed");
  });
});
