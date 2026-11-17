import { defineTable } from "convex/server";
import { v } from "convex/values";

// Outside artists a design credits (docs/decisions.md, "Credit and a reserved share for outside
// artists"; convex/artists.ts). An artist is a name and links, unclaimed until the person proves
// they're the artist. Their share of each sale is paid to a hidden payee account (users.artistPayee)
// and held there until a claim is approved, when it moves to the claimant's own account.
export const artistsTables = {
  artists: defineTable({
    name: v.string(),
    nameLower: v.string(),
    // The public page: /artist/<slug>.
    slug: v.string(),
    // Where their work lives (a portfolio, Instagram), as given; at least one.
    links: v.array(v.string()),
    // Each link as matched: host and path, lowercase, without www, a trailing slash, or the query.
    linkKeys: v.array(v.string()),
    // unclaimed: shares are held for them. claimed: they proved they're the artist and are paid.
    // declined: a claimed artist turned the credit down; no share from new sales, and pages don't show it.
    status: v.union(v.literal("unclaimed"), v.literal("claimed"), v.literal("declined")),
    // Staff hid it (a misleading name, a credit that shouldn't stand): no page, no credit shown,
    // no share from new sales. Apart from status, which the artist controls.
    hidden: v.optional(v.boolean()),
    // The hidden account their shares are paid to while unclaimed.
    payeeId: v.id("users"),
    // The member who claimed it.
    claimedBy: v.optional(v.id("users")),
    claimedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_nameLower", ["nameLower"])
    .index("by_claimedBy", ["claimedBy"])
    .index("by_payee", ["payeeId"])
    .index("by_createdBy", ["createdBy", "createdAt"]),

  // Each artist link's match key, so the same link always finds the same artist, whatever name
  // a creator typed or the artist renamed their page to (convex/artists.ts artistFor).
  artistLinks: defineTable({
    key: v.string(),
    artistId: v.id("artists"),
  }).index("by_key", ["key"]),

  // A work's credit to an artist. Remixes inherit it through the lineage (convex/artists.ts
  // saleCredits); it's stored once, on the work whose creator added it.
  artistCredits: defineTable({
    workId: v.id("works"),
    artistId: v.id("artists"),
    // Who added it: the work's creator while publishing, or staff afterward.
    source: v.union(v.literal("creator"), v.literal("staff")),
    addedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_work", ["workId"])
    .index("by_artist", ["artistId"]),

  // Someone asking to be recognized as an artist. They post the code where their work lives (or
  // email from its domain), say where, and an admin approves or rejects it.
  artistClaims: defineTable({
    artistId: v.id("artists"),
    userId: v.id("users"),
    code: v.string(),
    proofUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(v.literal("started"), v.literal("submitted"), v.literal("approved"), v.literal("rejected")),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    submittedAt: v.optional(v.number()),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("users")),
  })
    .index("by_artist", ["artistId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status", "submittedAt"]),
};
