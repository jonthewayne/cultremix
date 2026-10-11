import { defineTable } from "convex/server";
import { v } from "convex/values";

// What a member did, for the Following feed and profiles. One event per published work
// (recordPublishActivity in convex/lib/social.ts) and one per confirmed Back (recordBackConfirmed).
export const activityVerbValidator = v.union(
  v.literal("publish_original"),
  v.literal("publish_variation"),
  v.literal("publish_fork"),
  v.literal("back"),
);

// Which profile list a published work belongs to: originals are "works"; anything made from
// another work (a variation or a fork) is a "remix".
export const shelfValidator = v.union(v.literal("works"), v.literal("remixes"));
// An event's profile list: a published work's shelf, or "backed" for a work the member Backed.
export const activityShelfValidator = v.union(v.literal("works"), v.literal("remixes"), v.literal("backed"));

// What a notification is about (convex/lib/notifications.ts). "back" is written by Backs; "sale"
// by earnings when an order is paid (notifySale).
export const notificationKindValidator = v.union(
  v.literal("remix"),
  v.literal("heart"),
  v.literal("follow"),
  v.literal("back"),
  v.literal("sale"),
  // Your design was taken down (convex/moderation.ts); note says why.
  v.literal("takedown"),
  // Your kept design is ready to print and order, for you alone (convex/shopify.ts saveSynced).
  v.literal("kept_ready"),
  // For the owner and ops: an order can't go on by itself (convex/orderAlerts.ts); note says why.
  v.literal("order_attention"),
);

export const socialTables = {
  // Offchain. One row per follower and followee; follow and unfollow are idempotent.
  follows: defineTable({
    followerId: v.id("users"),
    followeeId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_pair", ["followerId", "followeeId"])
    // The Following feed reads the latest 200 a member follows (KTD-13).
    .index("by_follower_created", ["followerId", "createdAt"])
    .index("by_followee_created", ["followeeId", "createdAt"]),

  // Offchain. One row per member and work.
  hearts: defineTable({
    userId: v.id("users"),
    workId: v.id("works"),
    createdAt: v.number(),
  })
    .index("by_pair", ["userId", "workId"])
    .index("by_work", ["workId"])
    // Trending's rebuild reads the last week of hearts (convex/trending.ts).
    .index("by_created", ["createdAt"]),

  activityEvents: defineTable({
    actorId: v.id("users"),
    verb: activityVerbValidator,
    workId: v.id("works"),
    // The work's publish time, so events written by the backfill sort where they belong.
    createdAt: v.number(),
    shelf: v.optional(activityShelfValidator),
  })
    .index("by_created", ["createdAt"])
    .index("by_actor_created", ["actorId", "createdAt"])
    .index("by_actor_shelf_created", ["actorId", "shelf", "createdAt"])
    .index("by_work", ["workId"]),

  // Counts kept in the same transaction as the rows they count, so profiles and buttons never
  // count rows on read.
  userSocialStats: defineTable({
    userId: v.id("users"),
    followers: v.number(),
    following: v.number(),
    // Works this member has Backed, counted when each Back is confirmed.
    backed: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  workSocialStats: defineTable({
    workId: v.id("works"),
    hearts: v.number(),
  }).index("by_work", ["workId"]),

  // One row per creator: when they last published. Home's "Who's making things" pages over it.
  creatorActivity: defineTable({
    userId: v.id("users"),
    lastActiveAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_lastActive", ["lastActiveAt"]),

  // Something another member did to you or your work. workId is your work for a heart or a back,
  // and the new remix for a remix; a follow has none. A sale has no actor (buyers check out on
  // Shopify): workId is the work sold, ownWorkId the recipient's own work it came through when
  // that's an earlier design in its lineage, and sale what the recipient earns from the order.
  notifications: defineTable({
    recipientId: v.id("users"),
    actorId: v.optional(v.id("users")),
    kind: notificationKindValidator,
    workId: v.optional(v.id("works")),
    ownWorkId: v.optional(v.id("works")),
    sale: v.optional(v.object({ cents: v.number(), units: v.number(), test: v.boolean(), held: v.optional(v.boolean()) })),
    // For a takedown: why the design came down. For order_attention: what's wrong.
    note: v.optional(v.string()),
    // For order_attention: the Shopify order's name ("#1001").
    orderName: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_recipient_created", ["recipientId", "createdAt"])
    // Repeated hearts and follows within a day collapse into the latest matching row.
    .index("by_repeat", ["recipientId", "actorId", "kind", "workId", "createdAt"]),

  // One row per member: unread notifications, kept with the rows they count, and when they last
  // opened the list (notifications newer than that show as new).
  notificationState: defineTable({
    userId: v.id("users"),
    unread: v.number(),
    lastReadAt: v.number(),
  }).index("by_user", ["userId"]),

  // Trending (convex/lib/trending.ts): hearts, remixes, and confirmed Backs a work got on one UTC day. Rows older
  // than the 7-day window are subtracted from the score and deleted by an hourly cron.
  workAttentionDays: defineTable({
    workId: v.id("works"),
    day: v.number(),
    hearts: v.number(),
    remixes: v.number(),
    backs: v.optional(v.number()),
  })
    .index("by_work_day", ["workId", "day"])
    .index("by_day", ["day"]),

  // A work's attention over the window: hearts + 2 × Backs + 3 × remixes. Only works with some have a row.
  trendingWorks: defineTable({
    workId: v.id("works"),
    score: v.number(),
    lastAttentionAt: v.number(),
  })
    .index("by_work", ["workId"])
    .index("by_score", ["score", "lastAttentionAt"]),
};
