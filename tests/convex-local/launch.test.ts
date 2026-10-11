import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { PAGE_SIZE } from "../../convex/metrics";
import { FEATURE_FLAGS } from "../../convex/lib/flags";
import { flagEnabled } from "../../convex/studio";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// The first call into convex/judges.ts loads Better Auth, which can pass the 5 s default on a
// busy machine.
vi.setConfig({ testTimeout: 30_000 });

type Role = "user" | "super_admin_support" | "super_admin_ops" | "super_admin_owner";
type T = ReturnType<typeof newTest>;

async function addUser(t: T, name: string, role: Role = "user", extra: Record<string, unknown> = {}) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { authId: `test|${name}`, email: `${name}@example.com`, platformRole: role, ...extra }),
  );
  return { userId, as: t.withIdentity({ subject: `test|${name}`, issuer: "test" }) };
}

const SETTINGS = {
  signupGrantEnabled: true,
  signupGrantCredits: 30,
  dailyBudgetCents: 8000,
  shootsPerMemberPerDay: 4,
};

describe("admin access", () => {
  it("lets only ops and the owner change flags, settings, credits, and creator access", async () => {
    const t = newTest();
    const member = await addUser(t, "alice");
    const support = await addUser(t, "sam", "super_admin_support");
    const ops = await addUser(t, "olive", "super_admin_ops");
    const owner = await addUser(t, "jon", "super_admin_owner");

    for (const caller of [member.as, support.as, t]) {
      await expect(caller.mutation(api.admin.setFlag, { key: "publishing", enabled: false })).rejects.toThrow();
      await expect(caller.mutation(api.admin.updateSettings, SETTINGS)).rejects.toThrow();
      await expect(caller.mutation(api.admin.grantCredits, { userId: member.userId, amount: 5 })).rejects.toThrow();
      await expect(caller.mutation(api.admin.setCreator, { userId: member.userId, active: true })).rejects.toThrow();
    }

    await ops.as.mutation(api.admin.setFlag, { key: "publishing", enabled: false });
    await owner.as.mutation(api.admin.updateSettings, SETTINGS);
    const granted = await ops.as.mutation(api.admin.grantCredits, { userId: member.userId, amount: 5, note: "thanks" });
    expect(granted.credits).toBe(5);
    const creator = await owner.as.mutation(api.admin.setCreator, { userId: member.userId, active: true });
    expect(creator).toMatchObject({ isCreator: true, creatorNumber: 2 });

    const overview = await support.as.query(api.admin.overview, {});
    expect(overview.canManage).toBe(false);
    expect(overview.flags.find((flag) => flag.key === "publishing")).toMatchObject({ enabled: false, isSet: true });
    expect(overview.flags.find((flag) => flag.key === "commerce.checkout")).toMatchObject({ enabled: false, isSet: false });
    expect(overview.flags).toHaveLength(7);
    // Sale emails start off; an admin turns them on.
    expect(overview.flags.find((flag) => flag.key === "email.sales")).toMatchObject({ enabled: false });
    expect(overview.settings).toMatchObject({ signupGrantCredits: 30, dailyBudgetCents: 8000, shootsPerMemberPerDay: 4 });
  });

  it("keeps members and signed-out visitors out of admin reads", async () => {
    const t = newTest();
    const member = await addUser(t, "alice");
    for (const caller of [member.as, t]) {
      await expect(caller.query(api.admin.overview, {})).rejects.toThrow();
      await expect(caller.query(api.admin.searchMembers, { search: "" })).rejects.toThrow();
      await expect(caller.query(api.metrics.summary, { days: 7 })).rejects.toThrow();
    }
  });

  it("refuses unknown flags and out-of-range settings and grants", async () => {
    const t = newTest();
    const owner = await addUser(t, "jon", "super_admin_owner");
    await expect(owner.as.mutation(api.admin.setFlag, { key: "made.up", enabled: true })).rejects.toThrow(/Unknown flag/);
    await expect(owner.as.mutation(api.admin.updateSettings, { ...SETTINGS, signupGrantCredits: -1 })).rejects.toThrow();
    await expect(owner.as.mutation(api.admin.updateSettings, { ...SETTINGS, shootsPerMemberPerDay: 2.5 })).rejects.toThrow();
    await expect(owner.as.mutation(api.admin.grantCredits, { userId: owner.userId, amount: 5000 })).rejects.toThrow();
  });

  it("finds members by username, email, and creator number", async () => {
    const t = newTest();
    const owner = await addUser(t, "jon", "super_admin_owner", { creatorNumber: 1 });
    await addUser(t, "alice", "user", { username: "Alice", usernameLower: "alice" });
    await addUser(t, "bob", "user", { username: "bobby", usernameLower: "bobby", creatorNumber: 7 });
    expect((await owner.as.query(api.admin.searchMembers, { search: "@ali" })).map((row) => row.username)).toEqual(["Alice"]);
    expect((await owner.as.query(api.admin.searchMembers, { search: "bob@example" }))[0].username).toBe("bobby");
    expect((await owner.as.query(api.admin.searchMembers, { search: "№ 7" }))[0].username).toBe("bobby");
    expect(await owner.as.query(api.admin.searchMembers, { search: "" })).toHaveLength(3);
  });
});

describe("switches", () => {
  it("mark none as unwired once their features read them", async () => {
    const t = newTest();
    const owner = await addUser(t, "jon", "super_admin_owner");
    const overview = await owner.as.query(api.admin.overview, {});
    const notWired = overview.flags.filter((flag) => flag.notWiredYet).map((flag) => flag.key);
    expect(notWired).toEqual([]);
  });

  it("act on their default until an admin sets them, as the admin page shows", async () => {
    const t = newTest();
    for (const flag of FEATURE_FLAGS) {
      expect(await t.run((ctx) => flagEnabled(ctx, flag.key))).toBe(flag.defaultOn);
    }
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: "gen.upscale", enabled: true }));
    expect(await t.run((ctx) => flagEnabled(ctx, "gen.upscale"))).toBe(true);
  });
});

describe("judge accounts", () => {
  it("only the owner may provision, and the check runs before any account is made", async () => {
    const t = newTest();
    const member = await addUser(t, "alice");
    const ops = await addUser(t, "olive", "super_admin_ops");
    const args = { email: "judge@example.com", username: "judge_one" };
    await expect(t.action(api.judges.provision, args)).rejects.toThrow(/Sign in/);
    await expect(member.as.action(api.judges.provision, args)).rejects.toThrow(/access/);
    await expect(ops.as.action(api.judges.provision, args)).rejects.toThrow(/access/);
  });

  it("gives a judge a username, creator access, and 40 credits once", async () => {
    const t = newTest();
    await t.mutation(internal.seed.environment, {});
    const args = { authId: "auth-judge-1", email: "judge@example.com", username: "judge_one" };
    const first = await t.mutation(internal.judges.grantJudgeAccess, args);
    expect(first).toEqual({ username: "judge_one", creatorNumber: 2, credits: 40 });
    const again = await t.mutation(internal.judges.grantJudgeAccess, args);
    expect(again).toEqual(first);

    const second = await t.mutation(internal.judges.grantJudgeAccess, {
      authId: "auth-judge-2",
      email: "judge2@example.com",
      username: "judge_two",
    });
    expect(second.creatorNumber).toBe(3);

    const judge = await t.run((ctx) =>
      ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "auth-judge-1")).unique(),
    );
    expect(judge).toMatchObject({ username: "judge_one", emailVerified: true });
    expect(judge?.signupGrantAt).toBeTypeOf("number");
    expect(await t.query(internal.judges.isJudgeAccount, { authId: "auth-judge-1" })).toBe(true);

    // Onboarding sees the username and grants nothing more.
    const asJudge = t.withIdentity({ subject: "auth-judge-1", issuer: "test" });
    const viewer = await asJudge.mutation(api.identity.completeOnboarding, { username: "other" });
    expect(viewer).toMatchObject({ username: "judge_one", credits: 40, needsUsername: false });
  });

  it("refuses a username someone else has", async () => {
    const t = newTest();
    await addUser(t, "alice", "user", { username: "taken", usernameLower: "taken" });
    await expect(
      t.mutation(internal.judges.grantJudgeAccess, { authId: "auth-j", email: "j@example.com", username: "Taken" }),
    ).rejects.toThrow(/taken/);
  });
});

describe("seed and labels", () => {
  it("seeds every flag, setting, and counter once and never changes them", async () => {
    const t = newTest();
    const first = await t.mutation(internal.seed.environment, {});
    expect(first.created).toEqual(
      expect.arrayContaining(["appSettings.main", "featureFlags.gen.vercel", "featureFlags.commerce.checkout", "counters.creatorNumber"]),
    );
    const owner = await addUser(t, "jon", "super_admin_owner");
    await owner.as.mutation(api.admin.setFlag, { key: "commerce.checkout", enabled: true });
    const second = await t.mutation(internal.seed.environment, {});
    expect(second.created).toEqual([]);
    const flags = await owner.as.query(api.admin.overview, {});
    expect(flags.flags.find((flag) => flag.key === "commerce.checkout")?.enabled).toBe(true);
    expect(flags.flags.find((flag) => flag.key === "gen.vercel")?.enabled).toBe(true);
    expect(flags.flags.find((flag) => flag.key === "chain.writes")?.enabled).toBe(false);
  });

  it("says Testnet off production and Early access on production until checkout opens", async () => {
    const t = newTest();
    const before = process.env.DEPLOYMENT_ENV;
    try {
      process.env.DEPLOYMENT_ENV = "staging";
      expect(await t.query(api.deployment.get, {})).toEqual({ deploymentEnv: "staging", label: "testnet" });
      process.env.DEPLOYMENT_ENV = "prod";
      expect(await t.query(api.deployment.get, {})).toEqual({ deploymentEnv: "prod", label: "early_access" });
      await t.run((ctx) => ctx.db.insert("featureFlags", { key: "commerce.checkout", enabled: true }));
      expect(await t.query(api.deployment.get, {})).toEqual({ deploymentEnv: "prod", label: null });
    } finally {
      process.env.DEPLOYMENT_ENV = before;
    }
  });
});

describe("launch metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seedActivity(t: T, ownerId: Id<"users">, batches: number) {
    await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("creativeSessions", {
        ownerId,
        updatedAt: Date.now(),
        phrase: "",
        styleDirection: "",
        presets: [],
      });
      for (let index = 0; index < batches; index++) {
        const batchId = await ctx.db.insert("batches", {
          sessionId,
          ownerId,
          instruction: "",
          presets: [],
          backgroundColor: "#ffffff",
          operation: "create",
          model: "m",
          count: 1,
        });
        await ctx.db.insert("generations", {
          sessionId,
          batchId,
          ownerId,
          index: 0,
          kind: "concept",
          status: index % 2 === 0 ? "succeeded" : "failed",
          provider: "gateway",
          model: "m",
          charged: true,
          favorite: false,
        });
        await ctx.db.insert("creditLedger", { userId: ownerId, kind: "settle", amount: -2, batchId });
      }
    });
  }

  it("reads only the daily rows, never the tables, when the page loads", async () => {
    const t = newTest();
    const owner = await addUser(t, "jon", "super_admin_owner");
    await seedActivity(t, owner.userId, 450);
    const summary = await owner.as.query(api.metrics.summary, { days: 7 });
    // Nothing counted yet, even though 450 batches exist: the page doesn't scan tables.
    expect(summary.totals.batches).toBe(0);
    expect(summary.days).toHaveLength(7);
    expect(summary.days[0].day).toBe("2026-10-10");
    expect((await owner.as.query(api.metrics.summary, { days: 5000 })).days).toHaveLength(90);
  });

  it("counts a day in bounded pages and totals across days", async () => {
    const t = newTest();
    const owner = await addUser(t, "jon", "super_admin_owner");
    await seedActivity(t, owner.userId, 450);
    vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
    const other = await addUser(t, "alice");
    await seedActivity(t, other.userId, 3);

    await owner.as.mutation(api.metrics.recount, { days: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const steps = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    // 450 rows a table on day one need several pages, each its own step.
    expect(steps.length).toBeGreaterThan(Math.ceil(450 / PAGE_SIZE) * 3);

    const summary = await owner.as.query(api.metrics.summary, { days: 2 });
    const [today, yesterday] = summary.days;
    expect(yesterday).toMatchObject({
      day: "2026-10-10",
      complete: true,
      members: 1,
      generators: 1,
      batches: 450,
      designs: 225,
      creditsUsed: 900,
    });
    expect(today).toMatchObject({ day: "2026-10-11", members: 1, generators: 1, batches: 3, designs: 2, creditsUsed: 6 });
    expect(summary.totals).toMatchObject({ members: 2, generators: 2, batches: 453, creditsUsed: 906 });

    // Recounting gives the same numbers rather than adding to them.
    await t.mutation(internal.metrics.rollupDays, { days: ["2026-10-10"] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const again = await owner.as.query(api.metrics.summary, { days: 2 });
    expect(again.totals).toEqual(summary.totals);

    // Two recounts at once: the later one takes over and the earlier stops, so nothing doubles.
    await t.mutation(internal.metrics.rollupDays, { days: ["2026-10-10"] });
    await t.mutation(internal.metrics.rollupDays, { days: ["2026-10-10"] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const overlapped = await owner.as.query(api.metrics.summary, { days: 2 });
    expect(overlapped.totals).toEqual(summary.totals);
  });

  it("refuses recounts from non-admins and of too many days", async () => {
    const t = newTest();
    const member = await addUser(t, "alice");
    const owner = await addUser(t, "jon", "super_admin_owner");
    await expect(member.as.mutation(api.metrics.recount, { days: 1 })).rejects.toThrow();
    await expect(owner.as.mutation(api.metrics.recount, { days: 91 })).rejects.toThrow();
  });
});
