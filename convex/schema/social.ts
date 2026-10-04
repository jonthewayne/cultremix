import { defineTable } from "convex/server";
import { v } from "convex/values";

// What a member did, for the Following feed and profiles. One event per published work
// (recordPublishActivity in convex/lib/social.ts); Backs join later with their own verb.
export const activityVerbValidator = v.union(
  v.literal("publish_original"),
  v.literal("publish_variation"),
  v.literal("publish_fork"),
);

// Which profile list a published work belongs to: originals are "works"; anything made from
// another work (a variation or a fork) is a "remix".
export const shelfValidator = v.union(v.literal("works"), v.literal("remixes"));

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
    .index("by_work", ["workId"]),

  activityEvents: defineTable({
    actorId: v.id("users"),
    verb: activityVerbValidator,
    workId: v.id("works"),
    // The work's publish time, so events written by the backfill sort where they belong.
    createdAt: v.number(),
    shelf: v.optional(shelfValidator),
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
};
