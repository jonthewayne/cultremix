import type { MutationCtx } from "../_generated/server";

export const RATE_LIMITS = {
  "auth:create_email_attempt": {
    maxAttempts: 20,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  "auth:send_email_otp": {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  "auth:verify_email_otp": {
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  "auth:send_magic_link": {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  "auth:create_phone_attempt": {
    maxAttempts: 20,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  "auth:send_phone_otp": {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  "auth:verify_phone_otp": {
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  // The early-access list (convex/waitlist.ts), per email and per signed-in member.
  "waitlist:join": {
    maxAttempts: 8,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  // Signed-out joins per work, so one page can't be flooded with made-up addresses.
  "waitlist:visitor_work": {
    maxAttempts: 60,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  // New studio uploads per member (imageGen.uploadInspiration): each is stored in the public
  // bucket and read by a vision model for its notes, so a flood would cost real money. The same
  // file again is free and doesn't count.
  "studio:upload": {
    maxAttempts: 60,
    windowMs: 60 * 60 * 1000,
    blockMs: 60 * 60 * 1000,
  },
  // Browser error reports (convex/clientErrors.ts), from everyone together: anyone can send them.
  "client:error": {
    maxAttempts: 100,
    windowMs: 10 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
  },
  // "Add a part" (remixPartsActions.describe): each one asks a model to read the description.
  "studio:describe_part": {
    maxAttempts: 30,
    windowMs: 60 * 60 * 1000,
    blockMs: 60 * 60 * 1000,
  },
} as const satisfies Record<
  string,
  { maxAttempts: number; windowMs: number; blockMs: number }
>;

export type RateLimitOperation = keyof typeof RATE_LIMITS;

export function isRateLimitOperation(
  operation: string,
): operation is RateLimitOperation {
  return Object.prototype.hasOwnProperty.call(RATE_LIMITS, operation);
}

export function rateLimitKey(
  operation: RateLimitOperation,
  identifier: string,
): string {
  return `${operation}:${identifier.trim().toLowerCase()}`;
}

export async function checkRateLimit(
  ctx: MutationCtx,
  operation: RateLimitOperation,
  identifier: string,
): Promise<void> {
  const config = RATE_LIMITS[operation];
  const now = Date.now();
  const key = rateLimitKey(operation, identifier);

  const existing = await ctx.db
    .query("authRateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  if (existing?.blockedUntilMs && existing.blockedUntilMs > now) {
    const retryInSec = Math.ceil((existing.blockedUntilMs - now) / 1000);
    throw new Error(`Too many attempts. Try again in ${retryInSec} seconds.`);
  }

  if (!existing) {
    await ctx.db.insert("authRateLimits", {
      key,
      windowStartMs: now,
      count: 1,
      updatedAtMs: now,
    });
    return;
  }

  const windowEnd = existing.windowStartMs + config.windowMs;
  if (now >= windowEnd) {
    await ctx.db.patch("authRateLimits", existing._id, {
      windowStartMs: now,
      count: 1,
      blockedUntilMs: undefined,
      updatedAtMs: now,
    });
    return;
  }

  const nextCount = existing.count + 1;
  if (nextCount > config.maxAttempts) {
    await ctx.db.patch("authRateLimits", existing._id, {
      count: nextCount,
      blockedUntilMs: now + config.blockMs,
      updatedAtMs: now,
    });
    throw new Error(
      `Too many attempts. Try again in ${Math.ceil(config.blockMs / 1000)} seconds.`,
    );
  }

  await ctx.db.patch("authRateLimits", existing._id, {
    count: nextCount,
    updatedAtMs: now,
  });
}

export async function cleanupExpiredRateLimits(ctx: MutationCtx) {
  const now = Date.now();
  const maxWindowMs = Math.max(
    ...Object.values(RATE_LIMITS).map((limit) => limit.windowMs),
  );
  const staleWindowStartMs = now - maxWindowMs;
  const candidates = await ctx.db
    .query("authRateLimits")
    .withIndex("by_windowStartMs", (q) =>
      q.lt("windowStartMs", staleWindowStartMs),
    )
    .take(500);
  const stale = candidates
    .filter(
      (record) =>
        record.blockedUntilMs === undefined || record.blockedUntilMs < now,
    )
    .slice(0, 100);

  for (const record of stale) {
    await ctx.db.delete("authRateLimits", record._id);
  }
  return stale.length;
}
