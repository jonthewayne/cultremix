import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { creditBalance, getAppSettings } from "./identity";
import { adminAllows, requireAdmin } from "./lib/adminAccess";
import { memberSpendToday } from "./lib/budget";
import { isCreator, setCreatorAccess } from "./lib/creators";
import { FEATURE_FLAGS, flagDefault, flagDefinition } from "./lib/flags";
import { COMMERCE_FLAG } from "./lib/shopFlags";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const MEMBER_RESULTS = 20;

const flagRow = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
  // Present while nothing reads the switch yet.
  notWiredYet: v.optional(v.string()),
  enabled: v.boolean(),
  // False when the flag has no row yet and its default applies.
  isSet: v.boolean(),
});

const settingsValidator = v.object({
  signupGrantEnabled: v.boolean(),
  signupGrantCredits: v.number(),
  dailyBudgetCents: v.number(),
  shootsPerMemberPerDay: v.number(),
  updatedAt: v.number(),
});

const memberRow = v.object({
  userId: v.id("users"),
  email: v.optional(v.string()),
  username: v.optional(v.string()),
  creatorNumber: v.optional(v.number()),
  platformRole: v.string(),
  credits: v.number(),
  isCreator: v.boolean(),
  joinedAt: v.number(),
  // What the member's image calls hold or cost today (UTC), in cents (convex/lib/budget.ts).
  spentTodayCents: v.optional(v.number()),
});

async function readFlags(ctx: QueryCtx | MutationCtx) {
  const rows = [];
  for (const flag of FEATURE_FLAGS) {
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", flag.key))
      .unique();
    rows.push({
      key: flag.key,
      label: flag.label,
      description: flag.description,
      notWiredYet: flag.notWiredYet,
      enabled: row ? row.enabled : flag.defaultOn,
      isSet: row !== null,
    });
  }
  return rows;
}

async function toMemberRow(ctx: QueryCtx | MutationCtx, user: Doc<"users">) {
  return {
    userId: user._id,
    email: user.email,
    username: user.username,
    creatorNumber: user.creatorNumber,
    platformRole: user.platformRole ?? "user",
    credits: await creditBalance(ctx, user._id),
    isCreator: await isCreator(ctx, user),
    joinedAt: user._creationTime,
    spentTodayCents: await memberSpendToday(ctx, user._id, Date.now()),
  };
}

export const overview = query({
  args: {},
  returns: v.object({
    canManage: v.boolean(),
    isOwner: v.boolean(),
    flags: v.array(flagRow),
    settings: settingsValidator,
  }),
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx, "view");
    const settings = await getAppSettings(ctx);
    return {
      canManage: adminAllows(admin.platformRole, "manage"),
      isOwner: adminAllows(admin.platformRole, "owner"),
      flags: await readFlags(ctx),
      settings: {
        signupGrantEnabled: settings.signupGrant.enabled,
        signupGrantCredits: settings.signupGrant.credits,
        dailyBudgetCents: settings.dailyBudgetCents,
        shootsPerMemberPerDay: settings.shootsPerMemberPerDay,
        updatedAt: settings.updatedAt,
      },
    };
  },
});

export const setFlag = mutation({
  args: { key: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    if (!flagDefinition(args.key)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Unknown flag." });
    }
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const was = row ? row.enabled : flagDefault(args.key);
    if (row) await ctx.db.patch("featureFlags", row._id, { enabled: args.enabled });
    else await ctx.db.insert("featureFlags", { key: args.key, enabled: args.enabled });
    // Checkout brings the products in Shopify along: drafts while it's off, sellable while it's on.
    if (args.key === COMMERCE_FLAG && was !== args.enabled) {
      await ctx.scheduler.runAfter(0, internal.shopify.applyCheckout, { open: args.enabled, cursor: null });
    }
    return null;
  },
});

function wholeNumberIn(value: number, min: number, max: number, message: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConvexError({ code: "INVALID_INPUT", message });
  }
}

export const updateSettings = mutation({
  args: {
    signupGrantEnabled: v.boolean(),
    signupGrantCredits: v.number(),
    dailyBudgetCents: v.number(),
    shootsPerMemberPerDay: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    wholeNumberIn(args.signupGrantCredits, 0, 1000, "Signup credits must be 0 to 1,000.");
    wholeNumberIn(args.dailyBudgetCents, 0, 1_000_000, "The daily cap must be $0 to $10,000.");
    wholeNumberIn(args.shootsPerMemberPerDay, 0, 100, "Photo shoots must be 0 to 100 a day.");
    const values = {
      signupGrant: { enabled: args.signupGrantEnabled, credits: args.signupGrantCredits },
      dailyBudgetCents: args.dailyBudgetCents,
      shootsPerMemberPerDay: args.shootsPerMemberPerDay,
      updatedBy: admin._id,
      updatedAt: Date.now(),
    };
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (row) await ctx.db.patch("appSettings", row._id, values);
    else await ctx.db.insert("appSettings", { key: "main", ...values });
    return null;
  },
});

// Finds members by email, username, or creator number (all through indexes); an empty
// search lists the newest members. At most 20 rows.
export const searchMembers = query({
  args: { search: v.string() },
  returns: v.array(memberRow),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "view");
    const term = args.search.trim().toLowerCase().replace(/^@/u, "").replace(/^№\s*/u, "");
    let users: Array<Doc<"users">>;
    if (!term) {
      users = await ctx.db.query("users").order("desc").take(MEMBER_RESULTS);
    } else if (/^\d+$/u.test(term)) {
      users = await ctx.db
        .query("users")
        .withIndex("by_creatorNumber", (q) => q.eq("creatorNumber", Number(term)))
        .take(MEMBER_RESULTS);
    } else if (term.includes("@")) {
      users = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.gte("email", term).lt("email", `${term}￿`))
        .take(MEMBER_RESULTS);
    } else {
      const byUsername = await ctx.db
        .query("users")
        .withIndex("by_usernameLower", (q) =>
          q.gte("usernameLower", term).lt("usernameLower", `${term}￿`),
        )
        .take(MEMBER_RESULTS);
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.gte("email", term).lt("email", `${term}￿`))
        .take(MEMBER_RESULTS);
      const seen = new Set<Id<"users">>();
      users = [...byUsername, ...byEmail]
        .filter((user) => (seen.has(user._id) ? false : (seen.add(user._id), true)))
        .slice(0, MEMBER_RESULTS);
    }
    const rows = [];
    for (const user of users) rows.push(await toMemberRow(ctx, user));
    return rows;
  },
});

export const grantCredits = mutation({
  args: { userId: v.id("users"), amount: v.number(), note: v.optional(v.string()) },
  returns: memberRow,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    wholeNumberIn(args.amount, 1, 1000, "Grant 1 to 1,000 credits at a time.");
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "Member not found." });
    await ctx.db.insert("creditLedger", {
      userId: user._id,
      kind: "grant",
      amount: args.amount,
      reason: "admin",
      note: args.note?.trim().slice(0, 120) || undefined,
    });
    return await toMemberRow(ctx, user);
  },
});

export const setCreator = mutation({
  args: { userId: v.id("users"), active: v.boolean() },
  returns: memberRow,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "Member not found." });
    const creatorNumber = await setCreatorAccess(ctx, user, args.active, { grantedBy: admin._id });
    return await toMemberRow(ctx, { ...user, creatorNumber });
  },
});
