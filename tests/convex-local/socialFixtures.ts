import type { Id } from "../../convex/_generated/dataModel";
import type { newTest } from "./setup";

type T = ReturnType<typeof newTest>;

export async function addMember(t: T, username: string, extra: { creatorNumber?: number; email?: string } = {}) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      authId: `test|${username}`,
      username,
      usernameLower: username.toLowerCase(),
      email: extra.email ?? `${username}@example.com`,
      platformRole: "user",
      creatorNumber: extra.creatorNumber,
    }),
  );
  const as = t.withIdentity({ subject: `test|${username}`, issuer: "test" });
  return { userId, as };
}

let family = 100;

// A work row and the generation it came from. With publishedAt set, the work is published and has
// its activity event, as markPublished leaves it.
export async function addWork(
  t: T,
  creatorId: Id<"users">,
  opts: {
    publishedAt?: number;
    status?: "preparing" | "published" | "withdrawn" | "asset_failed";
    kind?: "original" | "variation" | "fork";
    parentWorkId?: Id<"works">;
    title?: string;
    withEvent?: boolean;
  } = {},
) {
  family += 1;
  const crFamily = family;
  const status = opts.status ?? "published";
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId: creatorId,
      updatedAt: 1,
      phrase: "",
      styleDirection: "",
      presets: [],
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId: creatorId,
      instruction: "",
      presets: [],
      backgroundColor: "#ffffff",
      operation: "create",
      model: "fake",
      count: 4,
    });
    const generationId = await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId: creatorId,
      index: 1,
      kind: "concept",
      status: "succeeded",
      provider: "fake",
      model: "fake",
      charged: true,
      favorite: false,
      fullKey: "fake:art",
    });
    const workId = await ctx.db.insert("works", {
      crFamily,
      crExpression: 1,
      creatorId,
      kind: opts.kind ?? "original",
      parentWorkId: opts.parentWorkId,
      generationId,
      requestId: `req-${crFamily}`,
      title: opts.title,
      backgroundColor: "#ffffff",
      status,
      publishedAt: status === "published" ? (opts.publishedAt ?? Date.now()) : undefined,
      artKey: "fake:art",
      contentHash: "abc",
    });
    if (status === "published" && opts.withEvent !== false) {
      const kind = opts.kind ?? "original";
      await ctx.db.insert("activityEvents", {
        actorId: creatorId,
        verb: kind === "variation" ? "publish_variation" : kind === "fork" ? "publish_fork" : "publish_original",
        workId,
        createdAt: opts.publishedAt ?? Date.now(),
        shelf: kind === "original" ? "works" : "remixes",
      });
    }
    return workId;
  });
}

export function page(numItems: number, cursor: string | null = null, endCursor?: string) {
  return endCursor === undefined ? { numItems, cursor } : { numItems, cursor, endCursor };
}
