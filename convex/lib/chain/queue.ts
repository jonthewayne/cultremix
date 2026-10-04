// Queueing chain writes from mutations: one write per subject (work, Back, amendment, config
// version), the readiness gates in front of it (the member's wallet, the parent's registration),
// and promotion once a gate opens. The relayer engine that signs and sends lives in convex/chain.ts.
import type { Hex } from "viem";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { KIND_CODES, ZERO_BYTES32, registerWorkMessage, workIdFor, type WorkKind } from "./ids";
import { serializePayload } from "./writes";

export const CHAIN_WRITES_FLAG = "chain.writes";

// Fallback for the work page URL hashed into a registration (convex/lib/chain/ids.ts).
const DEFAULT_SITE_URL = "https://cultremix.com";

type WriteDoc = Doc<"chainWrites">;
type WaitingStatus = "waiting_wallet" | "waiting_parent" | "pending";

/**
 * The chain.writes flag turns new chain writes off. Unlike other flags it fails closed: with no
 * row, nothing is sent (bootstrap.ensureDefaults seeds it on in dev only).
 */
export async function chainWritesEnabled(ctx: QueryCtx) {
  const flag = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", CHAIN_WRITES_FLAG))
    .unique();
  return flag?.enabled === true;
}

export async function writeBySubject(ctx: QueryCtx, subjectKey: string) {
  return await ctx.db
    .query("chainWrites")
    .withIndex("by_subjectKey", (q) => q.eq("subjectKey", subjectKey))
    .unique();
}

function siteOrigin() {
  return (process.env.SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/$/u, "");
}

async function kickTick(ctx: MutationCtx) {
  await ctx.scheduler.runAfter(0, internal.chain.tick, {});
}

/** The registerWork record, fixed when the write first becomes ready (later re-signs keep it). */
async function registerWorkPayload(ctx: MutationCtx, write: WriteDoc, creator: Doc<"users">) {
  const work = write.workId ? await ctx.db.get("works", write.workId) : null;
  if (!work?.contentHash || !creator.walletAddress) return null;
  const { message } = registerWorkMessage({
    work: {
      convexWorkId: work._id,
      crFamily: work.crFamily,
      crExpression: work.crExpression,
      kind: work.kind,
      parentConvexWorkId: work.parentWorkId,
      contentHash: work.contentHash,
    },
    creator: creator.walletAddress as Hex,
    siteOrigin: siteOrigin(),
    deadline: 0n,
  });
  const { deadline: _deadline, ...record } = message;
  return serializePayload(record);
}

/** Where a waiting write stands now: its member's wallet first, then the write it depends on. */
async function readiness(ctx: MutationCtx, write: WriteDoc): Promise<WaitingStatus> {
  if (write.userId) {
    const user = await ctx.db.get("users", write.userId);
    if (!user || user.walletStatus !== "ready" || !user.walletAddress) return "waiting_wallet";
  }
  if (write.dependsOnWriteId) {
    const parent = await ctx.db.get("chainWrites", write.dependsOnWriteId);
    if (!parent || parent.status !== "confirmed") return "waiting_parent";
  }
  return "pending";
}

/**
 * Re-checks a waiting write and moves it on. Returns true when it became pending (sendable).
 * A registerWork payload is built here, the first time it is ready.
 */
export async function promoteWrite(ctx: MutationCtx, write: WriteDoc): Promise<boolean> {
  if (write.status !== "waiting_wallet" && write.status !== "waiting_parent") return false;
  const status = await readiness(ctx, write);
  if (status === write.status) return false;
  const now = Date.now();
  if (status === "pending" && write.kind === "registerWork" && !write.payload) {
    const creator = await ctx.db.get("users", write.userId!);
    const payload = creator ? await registerWorkPayload(ctx, write, creator) : null;
    if (!payload) {
      await ctx.db.patch("chainWrites", write._id, { status: "failed", error: "The work or its creator's wallet is missing.", updatedAt: now });
      if (write.workId) await ctx.db.patch("works", write.workId, { provenanceStatus: "failed" });
      return false;
    }
    await ctx.db.patch("chainWrites", write._id, { status, payload, updatedAt: now });
    return true;
  }
  await ctx.db.patch("chainWrites", write._id, { status, updatedAt: now });
  return status === "pending";
}

/** A member's wallet is ready: their registrations and Backs waiting on it move on. */
export async function promoteForWallet(ctx: MutationCtx, userId: Id<"users">) {
  const waiting = await ctx.db
    .query("chainWrites")
    .withIndex("by_user_and_status", (q) => q.eq("userId", userId).eq("status", "waiting_wallet"))
    .take(100);
  let promoted = 0;
  for (const write of waiting) if (await promoteWrite(ctx, write)) promoted += 1;
  if (promoted > 0) await kickTick(ctx);
  return promoted;
}

/** A write confirmed: the writes that depend on it (remix registrations, Backs, amendments) move on. */
export async function promoteDependents(ctx: MutationCtx, writeId: Id<"chainWrites">) {
  const waiting = await ctx.db
    .query("chainWrites")
    .withIndex("by_dependsOn_and_status", (q) => q.eq("dependsOnWriteId", writeId).eq("status", "waiting_parent"))
    .take(100);
  let promoted = 0;
  for (const write of waiting) if (await promoteWrite(ctx, write)) promoted += 1;
  return promoted;
}

async function insertWrite(
  ctx: MutationCtx,
  fields: Pick<WriteDoc, "kind" | "subjectKey"> & Partial<Pick<WriteDoc, "workId" | "userId" | "backId" | "dependsOnWriteId" | "payload">>,
) {
  const now = Date.now();
  const writeId = await ctx.db.insert("chainWrites", {
    ...fields,
    status: "waiting_wallet",
    txs: [],
    replacements: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  // A fresh write starts at the first gate and moves through whichever are already open.
  if (await promoteWrite(ctx, (await ctx.db.get("chainWrites", writeId))!)) await kickTick(ctx);
  return writeId;
}

/**
 * Queues the registration of a published work, signed by its creator's wallet. Idempotent per
 * work. A remix's parent is queued first when it has no write yet (this also backfills works
 * published before chain writes existed), and the remix waits for it to confirm.
 */
export async function enqueueRegisterWork(ctx: MutationCtx, workId: Id<"works">): Promise<Id<"chainWrites"> | null> {
  const work = await ctx.db.get("works", workId);
  // Only a work that was published has a content hash; a withdrawn parent can still anchor a remix.
  // A hash that isn't SHA-256 hex can't be registered, and queueing must never fail a publish.
  if (!work?.contentHash || !/^(0x)?[0-9a-f]{64}$/iu.test(work.contentHash)) return null;
  const subjectKey = `work:${work._id}`;
  const existing = await writeBySubject(ctx, subjectKey);
  if (existing) {
    if (work.chainWriteId !== existing._id) await ctx.db.patch("works", work._id, { chainWriteId: existing._id });
    return existing._id;
  }
  let dependsOnWriteId: Id<"chainWrites"> | undefined;
  if (work.kind !== "original") {
    if (!work.parentWorkId) return null;
    const parentWriteId = await enqueueRegisterWork(ctx, work.parentWorkId);
    if (!parentWriteId) return null;
    dependsOnWriteId = parentWriteId;
  }
  await ctx.db.patch("works", work._id, { provenanceStatus: "pending" });
  const writeId = await insertWrite(ctx, { kind: "registerWork", subjectKey, workId: work._id, userId: work.creatorId, dependsOnWriteId });
  await ctx.db.patch("works", work._id, { chainWriteId: writeId });
  return writeId;
}

/** Queues a Back (convex/backs.ts has already admitted it). The work's registration confirms first. */
export async function enqueueBack(
  ctx: MutationCtx,
  args: { backId: Id<"backs">; work: Doc<"works">; backer: Doc<"users"> },
): Promise<Id<"chainWrites">> {
  const subjectKey = `back:${args.work._id}:${args.backer._id}`;
  const existing = await writeBySubject(ctx, subjectKey);
  if (existing) return existing._id;
  if (!args.backer.walletAddress) throw new Error("The backer's wallet is not ready.");
  const payload = serializePayload({ workId: workIdFor(args.work._id), backer: args.backer.walletAddress as Hex });
  return await insertWrite(ctx, {
    kind: "back",
    subjectKey,
    workId: args.work._id,
    userId: args.backer._id,
    backId: args.backId,
    dependsOnWriteId: args.work.chainWriteId,
    payload,
  });
}

/**
 * Queues a lineage correction, sent by the relayer as the registry admin. Sequence n waits for
 * amendment n − 1 (or the work's registration) to confirm.
 */
export async function enqueueAmendment(
  ctx: MutationCtx,
  args: { work: Doc<"works">; newParent: Doc<"works"> | null; newKind: WorkKind; reasonHash: Hex; sequence: number },
): Promise<Id<"chainWrites">> {
  const subjectKey = `amend:${args.work._id}:${args.sequence}`;
  const existing = await writeBySubject(ctx, subjectKey);
  if (existing) return existing._id;
  const previous = args.sequence > 1 ? await writeBySubject(ctx, `amend:${args.work._id}:${args.sequence - 1}`) : null;
  const dependsOnWriteId = previous?._id ?? args.work.chainWriteId;
  const payload = serializePayload({
    workId: workIdFor(args.work._id),
    newParentId: args.newParent ? workIdFor(args.newParent._id) : ZERO_BYTES32,
    newKind: KIND_CODES[args.newKind],
    reasonHash: args.reasonHash,
    sequence: BigInt(args.sequence),
  });
  return await insertWrite(ctx, { kind: "amendLineage", subjectKey, workId: args.work._id, dependsOnWriteId, payload });
}

/** Queues an economic config hash, sent by the relayer as the registry admin. Idempotent per version. */
export async function enqueueConfig(ctx: MutationCtx, version: number, configHash: Hex): Promise<Id<"chainWrites">> {
  const subjectKey = `config:${version}`;
  const existing = await writeBySubject(ctx, subjectKey);
  if (existing) return existing._id;
  const previous = version > 1 ? await writeBySubject(ctx, `config:${version - 1}`) : null;
  const payload = serializePayload({ version: BigInt(version), configHash });
  return await insertWrite(ctx, { kind: "registerEconomicConfig", subjectKey, dependsOnWriteId: previous?._id, payload });
}
