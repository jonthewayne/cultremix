import { defineTable } from "convex/server";
import { v } from "convex/values";
import { provenanceStatusValidator } from "./chain";
import { relativePlacementValidator } from "./merch";

// A remixable piece of a published design (convex/lib/remixFields.ts). kind is "text" today;
// other kinds (people, counts) can join the union later without a migration.
export const remixField = v.object({
  id: v.string(),
  kind: v.literal("text"),
  label: v.string(),
  text: v.string(),
  maxLength: v.number(),
  on: v.boolean(),
});

export const wordChange = v.object({ fieldId: v.string(), label: v.string(), from: v.string(), to: v.string() });

// A remixable character, person, or group of a design (convex/lib/remixParts.ts).
export const remixPart = v.object({
  id: v.string(),
  kind: v.union(v.literal("character"), v.literal("person"), v.literal("group")),
  label: v.string(),
  text: v.string(),
  on: v.boolean(),
  empty: v.optional(v.union(v.literal("keep"), v.literal("omit"), v.literal("require"))),
  count: v.optional(v.number()),
  max: v.optional(v.number()),
  note: v.optional(v.string()),
});

// What a remix asked of one part, as the server checked it.
export const partChange = v.object({
  partId: v.string(),
  kind: v.union(v.literal("character"), v.literal("person"), v.literal("group")),
  label: v.string(),
  from: v.string(),
  to: v.optional(v.string()),
  photos: v.array(v.object({ imageId: v.id("userImages"), key: v.string() })),
  omit: v.optional(v.boolean()),
});

// A design's remixable words and parts as its creator sets them up in the studio, before
// publishing; publishing carries them to the work.
export const remixSetup = v.object({
  status: v.union(v.literal("reading"), v.literal("ready"), v.literal("failed")),
  imageId: v.optional(v.id("userImages")),
  fields: v.optional(v.array(remixField)),
  parts: v.optional(v.array(remixPart)),
  error: v.optional(v.string()),
  updatedAt: v.number(),
});

// CultRemix tables for the 2026-09-29 sprint. Names follow the Checkpoint 0
// plan's "Settled validators"; fields not needed today are optional, and
// today's additions are noted in docs/hackathon/log.md.
export const cultremixTables = {
  appSettings: defineTable({
    key: v.string(),
    signupGrant: v.object({ enabled: v.boolean(), credits: v.number() }),
    dailyBudgetCents: v.number(),
    shootsPerMemberPerDay: v.number(),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  creditLedger: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("grant"),
      v.literal("settle"),
      v.literal("refund_credit"),
    ),
    amount: v.number(),
    reason: v.optional(
      v.union(v.literal("signup"), v.literal("admin"), v.literal("subscription")),
    ),
    note: v.optional(v.string()),
    generationId: v.optional(v.id("generations")),
    // A grid batch is charged and refunded as a whole (convex/lib/studioRules.ts).
    batchId: v.optional(v.id("batches")),
  }).index("by_user", ["userId"]),

  featureFlags: defineTable({
    key: v.string(),
    enabled: v.boolean(),
  }).index("by_key", ["key"]),

  counters: defineTable({
    name: v.string(),
    next: v.number(),
  }).index("by_name", ["name"]),

  crFamilies: defineTable({
    family: v.number(),
    nextExpression: v.number(),
    rootWorkId: v.optional(v.id("works")),
  }).index("by_family", ["family"]),

  creativeSessions: defineTable({
    ownerId: v.id("users"),
    updatedAt: v.number(),
    phrase: v.string(),
    styleDirection: v.string(),
    presets: v.array(v.string()),
    remixOfWorkId: v.optional(v.id("works")),
    remixMode: v.optional(v.union(v.literal("variation"), v.literal("fork"))),
    purpose: v.optional(v.union(v.literal("studio"), v.literal("shoot"))),
    // A name the member gave the session; without one the studio uses its first request.
    title: v.optional(v.string()),
    // How many batches the session has; the next batch takes the next number (batch-01, ...).
    batchCount: v.optional(v.number()),
  }).index("by_owner_updated", ["ownerId", "updatedAt"]),

  // Today's additions: instruction, inspirationKey, backgroundColor, operation, model.
  // images: the studio's numbered images (what to work on); styles: the style mix, each with a
  // 0-100 slider value. inspirationKey repeats the first image for older readers.
  batches: defineTable({
    sessionId: v.id("creativeSessions"),
    ownerId: v.id("users"),
    instruction: v.string(),
    presets: v.array(v.string()),
    inspirationKey: v.optional(v.string()),
    images: v.optional(v.array(v.object({ imageId: v.id("userImages"), key: v.string() }))),
    styles: v.optional(
      v.array(v.object({ imageId: v.id("userImages"), key: v.string(), weight: v.number() })),
    ),
    backgroundColor: v.string(),
    operation: v.union(v.literal("create"), v.literal("edit"), v.literal("remix")),
    model: v.string(),
    count: v.number(),
    // "grid": one 2x2 call cut into four designs, charged per batch; older batches made four
    // separate calls, charged per design.
    layout: v.optional(v.union(v.literal("single"), v.literal("grid"))),
    charged: v.optional(v.number()),
    refunded: v.optional(v.number()),
    // The whole grid image the designs were cut from.
    gridKey: v.optional(v.string()),
    // What the request wanted from each numbered image (convex/lib/roleReader.ts).
    roles: v.optional(v.array(v.union(v.literal("content"), v.literal("style"), v.literal("both")))),
    // The batch's number within its session, starting at 1; its files live in batch-01/ and so on.
    number: v.optional(v.number()),
    // A remix's changed words (convex/remixFields.ts): the parent's field, its text as the server
    // read it from the parent, and the new text.
    wordChanges: v.optional(v.array(wordChange)),
    // A remix's changed parts (convex/remixParts.ts), with the photos it gave them.
    partChanges: v.optional(v.array(partChange)),
    // A creator trying their own design's remixable parts before publishing ("Try it as a remix").
    tryDesign: v.optional(v.id("generations")),
    // The batch "Try again" made from this one, so a second tap can't run (and charge) it twice.
    retriedAs: v.optional(v.id("batches")),
    // The image model an admin picked (convex/lib/studioRules.ts ENGINES); absent means GPT Image 2.5.
    engine: v.optional(v.union(v.literal("gpt"), v.literal("nano-banana"), v.literal("recraft"), v.literal("mix"))),
    // What each style of a mix did (convex/lib/prompts.ts styleJobs), by the style image's key: the
    // studio's batch line says "33% lettering". Absent on batches with one style or none.
    styleJobs: v.optional(
      v.array(
        v.object({
          key: v.string(),
          job: v.union(v.literal("lead"), v.literal("subject"), v.literal("around"), v.literal("lettering"), v.literal("accents")),
        }),
      ),
    ),
  }).index("by_session", ["sessionId"]),

  // Every image a member brings into the studio: uploads, their own designs, and remix sources.
  // A vision model writes its notes once (what's in it and how it looks); the studio reuses them.
  userImages: defineTable({
    ownerId: v.id("users"),
    key: v.string(),
    sha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    analysis: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    summary: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("photo"), v.literal("art"))),
    notes: v.optional(v.string()),
    analysisModel: v.optional(v.string()),
    analysisError: v.optional(v.string()),
    usedAt: v.number(),
    // Set when the image was added to a style mix; the style picker lists these first.
    styleAt: v.optional(v.number()),
  })
    .index("by_owner_used", ["ownerId", "usedAt"])
    .index("by_owner_style", ["ownerId", "styleAt"])
    .index("by_owner_key", ["ownerId", "key"])
    .index("by_owner_sha", ["ownerId", "sha256"]),

  // Smaller copies of a stored image (convex/lib/sizes.ts): a WebP thumbnail and medium, made
  // when the image is stored and kept beside the original in its folder. key is the original's
  // key as other tables store it.
  imageSizes: defineTable({
    key: v.string(),
    sha256: v.string(),
    width: v.number(),
    height: v.number(),
    thumbKey: v.string(),
    mediumKey: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_sha", ["sha256"]),

  // Images moved into their folders (convex/storageMoves.ts): the old key (Convex storage, or R2
  // from before folders) and the key every table now uses.
  storageMoves: defineTable({
    from: v.string(),
    to: v.string(),
    // The moved file's SHA-256 when moving changed its bytes (the image model's metadata removed).
    sha256: v.optional(v.string()),
  }).index("by_from", ["from"]),

  generations: defineTable({
    sessionId: v.id("creativeSessions"),
    batchId: v.id("batches"),
    ownerId: v.id("users"),
    index: v.number(),
    kind: v.union(
      v.literal("concept"),
      v.literal("branch"),
      v.literal("edit"),
      v.literal("remix"),
      v.literal("tool"),
      v.literal("shoot"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("dispatched"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("needs_provider_choice"),
      v.literal("unknown_outcome"),
      v.literal("refused"),
      v.literal("expired"),
    ),
    provider: v.string(),
    model: v.string(),
    charged: v.boolean(),
    dispatchedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    favorite: v.boolean(),
    favoritedAt: v.optional(v.number()),
    rejected: v.optional(v.boolean()),
    fullKey: v.optional(v.string()),
    sha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    hasAlpha: v.optional(v.boolean()),
    error: v.optional(v.string()),
    // Its batch's asked-for words read back from it (convex/spelling.ts): the ones it drew a letter or
    // two off. Absent until read, and on designs whose batch asked for no words.
    spelling: v.optional(
      v.object({
        status: v.union(v.literal("checked"), v.literal("failed")),
        misses: v.array(v.object({ asked: v.string(), read: v.string() })),
        // What the reader saw, to explain a warning.
        read: v.optional(v.array(v.string())),
        error: v.optional(v.string()),
        checkedAt: v.number(),
      }),
    ),
    // Its remixable words and parts, set up in the studio before publishing.
    remixSetup: v.optional(remixSetup),
    // For a remix design: how far it moved from the design it remixes, judged when its creator
    // opens the publish dialog (convex/remixCheck.ts). A fork needs verdict "fork".
    remixCheck: v.optional(
      v.object({
        status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
        requestedAt: v.number(),
        attempts: v.number(),
        finishedAt: v.optional(v.number()),
        verdict: v.optional(v.union(v.literal("variation"), v.literal("fork"))),
        reason: v.optional(v.string()),
        subject: v.optional(v.union(v.literal("same"), v.literal("changed"))),
        layout: v.optional(v.union(v.literal("same"), v.literal("changed"))),
        style: v.optional(v.union(v.literal("same"), v.literal("changed"))),
        model: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
  })
    .index("by_batch", ["batchId"])
    .index("by_session_favorite", ["sessionId", "favorite", "favoritedAt"])
    // A batch image that is one of the member's designs: the design it started from.
    .index("by_owner_fullKey", ["ownerId", "fullKey"]),

  works: defineTable({
    crFamily: v.number(),
    crExpression: v.number(),
    creatorId: v.id("users"),
    kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
    parentWorkId: v.optional(v.id("works")),
    familyRootId: v.optional(v.id("works")),
    // Effective lineage (convex/lib/lineage.ts). effectiveParentWorkId is set at publish and when a
    // lineage amendment confirms; effectiveKind only when an amendment confirms (so a set value
    // means "amended", and an amended original has no effective parent).
    effectiveParentWorkId: v.optional(v.id("works")),
    effectiveKind: v.optional(
      v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
    ),
    lineageAmendedAt: v.optional(v.number()),
    generationId: v.id("generations"),
    requestId: v.string(),
    title: v.optional(v.string()),
    // A short note from the creator for the shop page.
    description: v.optional(v.string()),
    // Shirt color keys (convex/lib/garments.ts), lead color first. Absent on works published
    // before colors were chosen; their one color is backgroundColor.
    offeredColors: v.optional(v.array(v.string())),
    backgroundColor: v.string(),
    // "private": kept just for its creator (publish dialog "Keep it just for you"). Every public
    // query reads only "published", so a private work stays out of feeds, families, and shops.
    status: v.union(
      v.literal("preparing"),
      v.literal("published"),
      v.literal("withdrawn"),
      v.literal("asset_failed"),
      v.literal("private"),
    ),
    // Chosen in the publish dialog: kept just for the creator. Set while preparing, so the art
    // finishes as "private" instead of "published".
    keep: v.optional(v.literal("private")),
    // Taken down by an admin (convex/moderation.ts): when, by whom, and why; its creator is told why.
    withdrawnAt: v.optional(v.number()),
    withdrawnBy: v.optional(v.id("users")),
    withdrawReason: v.optional(v.string()),
    // A kept design's creator asked to have it printed (keeps.requestPrint); an admin approves it
    // for its creator alone in Admin, For sale.
    printRequestedAt: v.optional(v.number()),
    assetError: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    artKey: v.optional(v.string()),
    // The art at 2400 px for its page, a WebP made from its print upscale (convex/print.ts
    // startArtUpscale). The published file at artKey never changes: its SHA-256 is the fingerprint.
    artLargeKey: v.optional(v.string()),
    // Notes on the art, written once when it's published (convex/imageNotes.ts), so a remix
    // starts from them: what it shows, every piece of text, and how it looks.
    notes: v.optional(v.string()),
    notesSummary: v.optional(v.string()),
    notesKind: v.optional(v.union(v.literal("photo"), v.literal("art"))),
    notesModel: v.optional(v.string()),
    // What a remix may change (convex/remixFields.ts), proposed from the notes' words or carried
    // over from the parent, then adjusted by the creator. Empty: the design has no words.
    remixFields: v.optional(v.array(remixField)),
    // Its remixable characters, people, and groups (convex/remixParts.ts), set up in the studio,
    // carried over from the parent, or proposed from the notes. Empty: nothing to swap.
    remixParts: v.optional(v.array(remixPart)),
    // Onchain provenance (convex/chain.ts): the registerWork write and its confirmed transaction.
    provenanceStatus: v.optional(provenanceStatusValidator),
    chainWriteId: v.optional(v.id("chainWrites")),
    chainTxHash: v.optional(v.string()),
    provenanceConfirmedAt: v.optional(v.number()),
    // Where the design sits on the garments it sells on, chosen when publishing
    // (src/lib/print/shirtPlacement.ts). The model photo, the print files, and orders follow it.
    // Absent: the default placement.
    printPlacement: v.optional(relativePlacementValidator),
    // The products it sells on (Printful catalog ids, from the products on offer), each with its own
    // placement when its creator adjusted that one. Absent: the default product.
    printProducts: v.optional(
      v.array(v.object({ productId: v.number(), placement: v.optional(relativePlacementValidator) })),
    ),
    // The work's print file (Print Studio sets these once; the shop sends printKey to Printful).
    printKey: v.optional(v.string()),
    printSha256: v.optional(v.string()),
  })
    .index("by_status_publishedAt", ["status", "publishedAt"])
    // Published designs with no Monad record queued yet (Admin, Monad: the count and its Queue button).
    .index("by_status_chainWrite", ["status", "chainWriteId"])
    .index("by_family_expression", ["crFamily", "crExpression"])
    .index("by_parent", ["parentWorkId"])
    .index("by_effectiveParent_status", ["effectiveParentWorkId", "status", "publishedAt"])
    .index("by_requestId", ["requestId"])
    .index("by_creator", ["creatorId"])
    // A member's kept designs (status "private").
    .index("by_creator_status", ["creatorId", "status"])
    .index("by_artKey", ["artKey"])
    // The studio marks a design as published (its CR number) one design at a time.
    .index("by_generation", ["generationId"])
    // /onchain's check: which published design has this fingerprint (provenance.byFingerprint).
    .index("by_contentHash", ["contentHash"]),

  shoots: defineTable({
    workId: v.id("works"),
    status: v.union(
      v.literal("not_started"),
      v.literal("running"),
      v.literal("done"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    reason: v.optional(v.string()),
    requestedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    castingNote: v.optional(v.string()),
    pose: v.optional(v.string()),
    world: v.optional(v.string()),
  }).index("by_work", ["workId"]),

  shootPhotos: defineTable({
    shootId: v.id("shoots"),
    workId: v.id("works"),
    index: v.number(),
    state: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
    reason: v.optional(v.string()),
    publicKey: v.optional(v.string()),
  })
    .index("by_shoot_index", ["shootId", "index"])
    .index("by_work", ["workId"]),
};
