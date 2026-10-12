// Shared setup for chain tests: env for a dev deployment on a local RPC, members with dev
// wallets, and published works (a session, batch, and generation behind each).
import { vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { devWalletPrivateKey } from "../../convex/lib/chain/custody";
import { CHAIN_WRITES_FLAG } from "../../convex/lib/chain/queue";
import { FAKE_REGISTRY } from "./fakeChain";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { Address } from "viem";
import type { newTest } from "./setup";

type T = ReturnType<typeof newTest>;

// Anvil's first account: a well-known test key, never a real relayer.
export const RELAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const RELAYER = privateKeyToAccount(RELAYER_KEY).address;
export const RELAYER_LEASE_KEY = `10143:${RELAYER.toLowerCase()}`;
export const DEV_SECRET = "dev-only-secret";

export function useChainEnv(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {
    DEPLOYMENT_ENV: "dev",
    MONAD_RPC_URL: "http://127.0.0.1:8545",
    CHAIN_REGISTRY_ADDRESS: FAKE_REGISTRY,
    MONAD_RELAYER_PRIVATE_KEY: RELAYER_KEY,
    DEV_WALLET_SECRET: DEV_SECRET,
    CIRCLE_API_KEY: "",
    CIRCLE_ENTITY_SECRET: "",
    CIRCLE_WALLET_SET_ID: "",
    SITE_URL: "https://cultremix.test",
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

export async function setFlag(t: T, key: string, enabled: boolean) {
  await t.run(async (ctx) => {
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (flag) await ctx.db.patch("featureFlags", flag._id, { enabled });
    else await ctx.db.insert("featureFlags", { key, enabled });
  });
}

export async function setChainWrites(t: T, enabled: boolean) {
  await setFlag(t, CHAIN_WRITES_FLAG, enabled);
}

export type Member = { userId: Id<"users">; address: Address; authId: string };

/** A signed-up member with a username, a verified email and, unless walletReady is false, a ready dev wallet. */
export async function insertMember(t: T, options: { walletReady?: boolean; fields?: Partial<Doc<"users">> } = {}): Promise<Member> {
  const authId = `auth-${crypto.randomUUID()}`;
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: `${authId}@example.com`, authId, name: "Member", username: `m${authId.slice(-8)}`, emailVerified: true, ...options.fields }),
  );
  const address = privateKeyToAccount(await devWalletPrivateKey(DEV_SECRET, userId)).address;
  await t.run((ctx) =>
    ctx.db.patch(
      "users",
      userId,
      options.walletReady === false
        ? { walletStatus: "pending" }
        : { walletStatus: "ready", walletCustody: "local", walletAddress: address },
    ),
  );
  return { userId, address, authId };
}

export async function makeWalletReady(t: T, member: Member) {
  await t.run((ctx) => ctx.db.patch("users", member.userId, { walletStatus: "ready", walletCustody: "local", walletAddress: member.address }));
}

let nextFamily = 1;

/**
 * A published work. An original or fork starts a new family; a variation joins its parent's
 * family as the next expression.
 */
export async function insertWork(
  t: T,
  creatorId: Id<"users">,
  options: { kind?: "original" | "variation" | "fork"; parentWorkId?: Id<"works">; fields?: Partial<Doc<"works">> } = {},
): Promise<Id<"works">> {
  const kind = options.kind ?? "original";
  return await t.run(async (ctx) => {
    let crFamily = nextFamily;
    let crExpression = 1;
    if (kind === "variation") {
      const parent = (await ctx.db.get("works", options.parentWorkId!))!;
      const family = await ctx.db
        .query("works")
        .filter((q) => q.eq(q.field("crFamily"), parent.crFamily))
        .collect();
      crFamily = parent.crFamily;
      crExpression = Math.max(...family.map((work) => work.crExpression)) + 1;
    } else {
      nextFamily += 1;
    }
    const now = Date.now();
    const sessionId = await ctx.db.insert("creativeSessions", { ownerId: creatorId, updatedAt: now, phrase: "a quiet harbor", styleDirection: "", presets: [] });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId: creatorId,
      instruction: "",
      presets: [],
      backgroundColor: "#101010",
      operation: "create",
      model: "test",
      count: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId: creatorId,
      index: 0,
      kind: "concept",
      status: "succeeded",
      provider: "test",
      model: "test",
      charged: false,
      favorite: false,
    });
    const contentHash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
    return await ctx.db.insert("works", {
      crFamily,
      crExpression,
      creatorId,
      kind,
      parentWorkId: options.parentWorkId,
      generationId,
      requestId: crypto.randomUUID(),
      backgroundColor: "#101010",
      status: "published",
      publishedAt: now,
      contentHash,
      ...options.fields,
    });
  });
}

/** A super admin owner, for the admin actions. */
export async function insertOwner(t: T) {
  const authId = `auth-${crypto.randomUUID()}`;
  await t.run((ctx) => ctx.db.insert("users", { email: `${authId}@example.com`, authId, name: "Owner", platformRole: "super_admin_owner", emailVerified: true }));
  return t.withIdentity({ subject: authId, issuer: "test", name: "Owner" });
}
