"use node";

import { createHash } from "node:crypto";
import { CopyObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { publicUrl, r2, storageMode } from "./r2";
import { uprightSize, webpCopy } from "./resize";
import { sizeKey } from "./sizes";

// Storing and reading images, for Node actions only (resizing uses sharp, a native package listed
// in convex.json). Images go to the environment's public R2 bucket in one folder per image
// (convex/lib/sizes.ts), or to Convex file storage when R2 isn't configured (keys "cvx:<storageId>",
// served by the /img/ route).

const IMMUTABLE = "public, max-age=31536000, immutable";

// A stored image's thumbnail and medium and its upright size.
// (Explicit types here keep the generated API from referring to itself.)
type Sizes = { thumbKey: string; mediumKey: string; width: number; height: number };

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Stores bytes under a key and returns the key they can be read by. In R2 it's one upload: keys
// name their content, so writing a key again writes the same file. (The R2 component's store()
// adds a lookup and a separate action that records each object, which this app never reads; that
// doubled the time to save a design.)
export async function storeObject(ctx: ActionCtx, key: string, bytes: Uint8Array, type: string) {
  if (storageMode() === "convex") {
    const id = await ctx.storage.store(new Blob([new Uint8Array(bytes)], { type }));
    return "cvx:" + id;
  }
  await r2.client.send(
    new PutObjectCommand({ Bucket: r2.config.bucket, Key: key, Body: bytes, ContentType: type, CacheControl: IMMUTABLE }),
  );
  return key;
}

// Copies an object within the bucket, keeping its type and cache settings.
export async function copyObject(from: string, to: string) {
  await r2.client.send(
    new CopyObjectCommand({ Bucket: r2.config.bucket, CopySource: r2.config.bucket + "/" + from, Key: to, MetadataDirective: "COPY" }),
  );
}

// Every key under a prefix.
export async function listKeys(prefix: string) {
  const keys: Array<string> = [];
  let token: string | undefined;
  do {
    const page = await r2.client.send(
      new ListObjectsV2Command({ Bucket: r2.config.bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function deleteKeys(keys: Array<string>) {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2.client.send(
      new DeleteObjectsCommand({
        Bucket: r2.config.bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

// Stores a new image and makes its thumbnail and medium at the same time, so all three are ready
// when it first shows. keyFor names the original from its SHA-256 (convex/lib/sizes.ts).
export async function storeNew(
  ctx: ActionCtx,
  bytes: Uint8Array,
  type: string,
  keyFor: (sha256: string) => string,
): Promise<{ key: string; sha256: string }> {
  const sha256 = sha256Hex(bytes);
  const planned = keyFor(sha256);
  const [key, sizes]: [string, Sizes | null] = await Promise.all([
    storeObject(ctx, planned, bytes, type),
    makeCopies(ctx, planned, sha256, bytes).catch((error: unknown) => {
      console.error("sizes failed", planned, error);
      return null;
    }),
  ]);
  if (sizes) await ctx.runMutation(internal.imageSizes.record, { key, sha256, ...sizes });
  return { key, sha256 };
}

export async function fetchPublicImage(key: string, ctx?: ActionCtx) {
  if (key.startsWith("cvx:") && ctx) {
    const blob = await ctx.storage.get(key.slice(4) as Id<"_storage">);
    if (!blob) throw new Error("Image unavailable.");
    return new Uint8Array(await blob.arrayBuffer());
  }
  const url = publicUrl(key);
  if (!url || url.startsWith("fake:")) throw new Error("Image unavailable.");
  const response = await fetch(url);
  if (!response.ok) throw new Error("Image fetch failed (" + response.status + ").");
  return new Uint8Array(await response.arrayBuffer());
}

// An original's thumbnail and medium (convex/lib/sizes.ts), made and stored beside it side by side.
async function makeCopies(ctx: ActionCtx, originalKey: string, sha256: string, bytes: Uint8Array): Promise<Sizes> {
  const [thumbKey, mediumKey, size] = await Promise.all([
    webpCopy(bytes, "thumb").then((webp) => storeObject(ctx, sizeKey(originalKey, sha256, "thumb"), webp, "image/webp")),
    webpCopy(bytes, "medium").then((webp) => storeObject(ctx, sizeKey(originalKey, sha256, "medium"), webp, "image/webp")),
    uprightSize(bytes),
  ]);
  return { thumbKey, mediumKey, ...size };
}

// Makes and records the copies of an image already stored (uploads, and images from before copies
// existed). Never throws: pages show the original while copies are missing.
export async function makeSizes(ctx: ActionCtx, key: string, original?: Uint8Array): Promise<Sizes | null> {
  if (key.startsWith("fake:")) return null;
  try {
    const recorded: Sizes | null = await ctx.runQuery(internal.imageSizes.find, { key });
    if (recorded) return recorded;
    const bytes = original ?? (await fetchPublicImage(key, ctx));
    const sha256 = sha256Hex(bytes);
    const sizes = await makeCopies(ctx, key, sha256, bytes);
    await ctx.runMutation(internal.imageSizes.record, { key, sha256, ...sizes });
    return sizes;
  } catch (error) {
    console.error("makeSizes failed", key, error);
    return null;
  }
}
