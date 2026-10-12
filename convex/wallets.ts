import { v } from "convex/values";
import { DeploymentConfigError, assertDeploymentConsistency } from "../shared/config/chains";
import { getViewerUser } from "./identity";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { createMemberWallet } from "./lib/chain/custody";
import { chainDeps } from "./lib/chain/deps";
import { promoteForWallet } from "./lib/chain/queue";
import { walletStatusValidator } from "./schema";
import type { Id } from "./_generated/dataModel";

// Member wallets: pending → provisioning → ready | failed. Provisioning starts when the user is
// created and from the reconciliation cron (convex/crons.ts), which also backfills users made
// before wallets existed. A claim holds the user for WALLET_LEASE_MS, so a provisioning action
// that dies is retried; Circle's idempotency key (stored before the first call) returns the same
// wallet on every retry.

export const WALLET_LEASE_MS = 2 * 60_000;
const RECONCILE_BATCH = 25;

/** 1, 2, 4, … minutes after each failure, at most an hour. */
export function walletBackoffMs(attempts: number) {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
}

function deploymentOrNull(where: string) {
  try {
    return assertDeploymentConsistency(process.env);
  } catch (error) {
    if (error instanceof DeploymentConfigError) {
      console.warn(`${where}: ${error.message}`);
      return null;
    }
    throw error;
  }
}

export const claimProvisioning = internalMutation({
  args: { userId: v.id("users"), idempotencyKey: v.string() },
  returns: v.union(v.null(), v.object({ idempotencyKey: v.string() })),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.walletStatus === "ready") return null;
    const now = Date.now();
    if (user.walletStatus !== undefined && user.walletStatus !== "pending" && (user.walletNextAttemptAt ?? 0) > now) {
      return null;
    }
    // The first key is kept for good: every retry must send Circle the same one.
    const idempotencyKey = user.walletIdempotencyKey ?? args.idempotencyKey;
    await ctx.db.patch("users", user._id, {
      walletStatus: "provisioning",
      walletIdempotencyKey: idempotencyKey,
      walletNextAttemptAt: now + WALLET_LEASE_MS,
    });
    return { idempotencyKey };
  },
});

export const recordWallet = internalMutation({
  args: {
    userId: v.id("users"),
    custody: v.union(v.literal("circle"), v.literal("local")),
    address: v.string(),
    circleWalletId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user) return null;
    if (user.walletAddress && user.walletAddress.toLowerCase() !== args.address.toLowerCase()) {
      // A member keeps one wallet; a different address means custody changed underneath us.
      await ctx.db.patch("users", user._id, {
        walletStatus: "failed",
        walletError: "Provisioning returned a different wallet than the one on file.",
        walletNextAttemptAt: Date.now() + walletBackoffMs(user.walletAttempts ?? 1),
      });
      return null;
    }
    await ctx.db.patch("users", user._id, {
      walletStatus: "ready",
      walletAddress: args.address,
      circleWalletId: args.circleWalletId,
      walletCustody: args.custody,
      walletNextAttemptAt: undefined,
      walletError: undefined,
    });
    // Registrations and Backs that were waiting on this wallet can go now.
    await promoteForWallet(ctx, user._id);
    return null;
  },
});

export const recordFailure = internalMutation({
  args: { userId: v.id("users"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.walletStatus === "ready") return null;
    const attempts = (user.walletAttempts ?? 0) + 1;
    await ctx.db.patch("users", user._id, {
      walletStatus: "failed",
      walletAttempts: attempts,
      walletNextAttemptAt: Date.now() + walletBackoffMs(attempts),
      walletError: args.error.slice(0, 300),
    });
    return null;
  },
});

export const provisionWallet = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deployment = deploymentOrNull("wallets.provisionWallet");
    // Without custody the user stays pending; the cron picks them up once keys are set.
    if (!deployment || deployment.custody.mode === "unavailable") return null;
    const claim = await ctx.runMutation(internal.wallets.claimProvisioning, {
      userId: args.userId,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!claim) return null;
    try {
      const wallet = await createMemberWallet(
        deployment,
        process.env,
        { userId: args.userId, idempotencyKey: claim.idempotencyKey },
        chainDeps().fetch,
      );
      await ctx.runMutation(internal.wallets.recordWallet, {
        userId: args.userId,
        custody: wallet.custody,
        address: wallet.address,
        circleWalletId: wallet.circleWalletId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet provisioning failed.";
      await ctx.runMutation(internal.wallets.recordFailure, { userId: args.userId, error: message });
    }
    return null;
  },
});

// Every 5 minutes: users without a status (created before wallets), pending users, provisioning
// claims whose lease ran out, and failed users whose backoff has passed.
export const reconcileWallets = internalMutation({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx) => {
    const deployment = deploymentOrNull("wallets.reconcileWallets");
    if (!deployment || deployment.custody.mode === "unavailable") return { scheduled: 0 };
    const now = Date.now();
    const due = new Set<Id<"users">>();

    const legacy = await ctx.db
      .query("users")
      .withIndex("by_walletStatus_and_nextAttempt", (q) => q.eq("walletStatus", undefined))
      .take(RECONCILE_BATCH);
    for (const user of legacy) {
      await ctx.db.patch("users", user._id, { walletStatus: "pending" });
      due.add(user._id);
    }
    // An unset walletNextAttemptAt sorts first, so lte(now) includes it (the users just backfilled too).
    for (const status of ["pending", "provisioning", "failed"] as const) {
      const rows = await ctx.db
        .query("users")
        .withIndex("by_walletStatus_and_nextAttempt", (q) => q.eq("walletStatus", status).lte("walletNextAttemptAt", now))
        .take(RECONCILE_BATCH);
      for (const user of rows) due.add(user._id);
    }
    for (const userId of due) {
      await ctx.scheduler.runAfter(0, internal.wallets.provisionWallet, { userId });
    }
    return { scheduled: due.size };
  },
});

/** The signed-in member's wallet, for the Back button and profile. */
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ status: walletStatusValidator, address: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx) => {
    const user = await getViewerUser(ctx);
    if (!user) return null;
    return { status: user.walletStatus ?? "pending", address: user.walletAddress ?? null };
  },
});
