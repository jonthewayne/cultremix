import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { DAILY_LIMIT, DAILY_LIMIT_MESSAGE } from "../../convex/lib/photoShoots";
import { formatCr } from "../../convex/lib/r2";
import { newTest } from "./setup";
import { addMember, addWork } from "./socialFixtures";
import type { Id } from "../../convex/_generated/dataModel";

vi.setConfig({ testTimeout: 30_000 });

type T = ReturnType<typeof newTest>;

const DAY_ONE = Date.parse("2026-10-04T15:00:00Z");
const DAY_TWO = Date.parse("2026-10-05T00:30:00Z");

async function setShootsPerDay(t: T, shoots: number) {
  await t.run((ctx) =>
    ctx.db.insert("appSettings", {
      key: "main",
      signupGrant: { enabled: true, credits: 30 },
      dailyBudgetCents: 5000,
      shootsPerMemberPerDay: shoots,
      updatedAt: 0,
    }),
  );
}

async function publish(t: T, creatorId: Id<"users">) {
  const workId = await addWork(t, creatorId, { status: "preparing" });
  const shoot = await t.mutation(internal.publish.markPublished, { workId, artKey: "fake:art", contentHash: "abc" });
  const work = await t.run((ctx) => ctx.db.get("works", workId));
  const cr = formatCr(work!.crFamily, work!.crExpression);
  return { workId, cr, shoot, work: work! };
}

async function photoOf(t: T, workId: Id<"works">) {
  return await t.run((ctx) =>
    ctx.db
      .query("shootPhotos")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .unique(),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DAY_ONE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("photo shoots per member a day", () => {
  it("publishes past the limit with the photo waiting, and says so calmly", async () => {
    const t = newTest();
    await setShootsPerDay(t, 2);
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");

    const first = await publish(t, alice.userId);
    const second = await publish(t, alice.userId);
    const third = await publish(t, alice.userId);
    expect(first.shoot).not.toBeNull();
    expect(second.shoot).not.toBeNull();
    expect(third.shoot).toBeNull();
    expect(third.work.status).toBe("published");
    expect(await photoOf(t, third.workId)).toMatchObject({ state: "failed", reason: DAILY_LIMIT });

    // Everyone sees a calm "waiting"; only the creator learns why and can retry.
    const page = await t.query(api.feed.byCr, { cr: third.cr });
    expect(page?.item.photoState).toBe("waiting");
    expect(await alice.as.query(api.photos.mine, { cr: third.cr })).toEqual({
      canRetry: true,
      waiting: true,
      shootsLeft: 0,
    });
    expect(await bob.as.query(api.photos.mine, { cr: third.cr })).toBeNull();
    expect(await t.query(api.photos.mine, { cr: third.cr })).toBeNull();
    await expect(bob.as.mutation(api.photos.retry, { cr: third.cr })).rejects.toThrow();

    // Another member's day is their own.
    expect((await publish(t, bob.userId)).shoot).not.toBeNull();

    const refused = await alice.as.mutation(api.photos.retry, { cr: third.cr });
    expect(refused).toEqual({ started: false, message: DAILY_LIMIT_MESSAGE });
    expect(await photoOf(t, third.workId)).toMatchObject({ state: "failed" });
  });

  it("lets the waiting photo be retried the next day", async () => {
    const t = newTest();
    await setShootsPerDay(t, 1);
    const alice = await addMember(t, "alice");
    await publish(t, alice.userId);
    const waiting = await publish(t, alice.userId);
    expect(waiting.shoot).toBeNull();

    vi.setSystemTime(DAY_TWO);
    expect(await alice.as.query(api.photos.mine, { cr: waiting.cr })).toMatchObject({ waiting: true, shootsLeft: 1 });
    const started = await alice.as.mutation(api.photos.retry, { cr: waiting.cr });
    expect(started).toEqual({ started: true });
    expect(await photoOf(t, waiting.workId)).toMatchObject({ state: "pending" });
    expect((await t.query(api.feed.byCr, { cr: waiting.cr }))?.item.photoState).toBe("pending");
    // A photo on its way isn't retried again.
    expect(await alice.as.query(api.photos.mine, { cr: waiting.cr })).toMatchObject({ canRetry: false, shootsLeft: 0 });
    expect(await alice.as.mutation(api.photos.retry, { cr: waiting.cr })).toEqual({ started: false });
  });

  it("never limits the owner", async () => {
    const t = newTest();
    await setShootsPerDay(t, 0);
    const ownerId = await t.run((ctx) =>
      ctx.db.insert("users", {
        authId: "test|jon",
        username: "jon",
        usernameLower: "jon",
        platformRole: "super_admin_owner",
      }),
    );
    for (let i = 0; i < 3; i++) {
      expect((await publish(t, ownerId)).shoot).not.toBeNull();
    }
    const alice = await addMember(t, "alice");
    expect((await publish(t, alice.userId)).shoot).toBeNull();
  });

  it("counts reshoots, keeps the photo that's up when refused, and lets the operator's run through", async () => {
    const t = newTest();
    await setShootsPerDay(t, 1);
    const alice = await addMember(t, "alice");
    const done = await publish(t, alice.userId);
    await t.mutation(internal.publish.recordPhoto, { shootId: done.shoot!.shootId, publicKey: "fake:photo-1" });

    expect(await t.mutation(internal.publish.beginReshoot, { cr: done.cr })).toBeNull();
    expect(await photoOf(t, done.workId)).toMatchObject({ state: "succeeded", publicKey: "fake:photo-1" });

    const job = await t.mutation(internal.publish.beginReshoot, { cr: done.cr, skipLimit: true });
    expect(job).toMatchObject({ photoKey: "fake:photo-1" });
    // A failed reshoot leaves that photo up too.
    await t.mutation(internal.publish.recordPhotoFailed, { shootId: job!.shootId, reason: "nope" });
    expect(await photoOf(t, done.workId)).toMatchObject({ state: "succeeded", publicKey: "fake:photo-1" });

    // Without a photo yet, a refused reshoot marks it waiting.
    const bare = await addWork(t, alice.userId);
    const bareWork = await t.run((ctx) => ctx.db.get("works", bare));
    const bareCr = formatCr(bareWork!.crFamily, bareWork!.crExpression);
    expect(await t.mutation(internal.publish.beginReshoot, { cr: bareCr })).toBeNull();
    expect(await photoOf(t, bare)).toMatchObject({ state: "failed", reason: DAILY_LIMIT });
  });

  it("starts a failed photo again for its creator, within the day's shoots", async () => {
    const t = newTest();
    await setShootsPerDay(t, 2);
    const alice = await addMember(t, "alice");
    const work = await publish(t, alice.userId);
    await t.mutation(internal.publish.recordPhotoFailed, { shootId: work.shoot!.shootId, reason: "provider down" });
    expect((await t.query(api.feed.byCr, { cr: work.cr }))?.item.photoState).toBe("failed");
    expect(await alice.as.query(api.photos.mine, { cr: work.cr })).toEqual({ canRetry: true, waiting: false, shootsLeft: 1 });
    expect(await alice.as.mutation(api.photos.retry, { cr: work.cr })).toEqual({ started: true });
    expect(await photoOf(t, work.workId)).toMatchObject({ state: "pending" });
  });
});
