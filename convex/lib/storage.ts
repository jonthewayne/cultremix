"use node";

import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { publicUrl, r2, storageMode } from "./r2";
import { uprightSize, webpCopy } from "./resize";
import { sizeKey } from "./sizes";

// Storing and reading images, for Node actions only (resizing uses sharp, a native package listed
// in convex.json). Originals and their sizes go to the environment's public R2 bucket, or to
// Convex file storage when R2 isn't configured (keys "cvx:<storageId>", served by the /img/ route).

const IMMUTABLE = "public, max-age=31536000, immutable";

// A stored image's thumbnail and medium (convex/lib/sizes.ts) and its upright size.
// (Explicit types here keep the generated API from referring to itself.)
type Sizes = { thumbKey: string; mediumKey: string; width: number; height: number };

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Stores bytes under a content-addressed key; returns the key they can be read by. In R2 it's one
// upload: the key names the content, so writing a key again writes the same file. (The R2
// component's store() adds a lookup and a separate action that records each object, which this
// app never reads; that doubled the time to save a design.)
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

// Stores a new PNG (a design or a model photo) and its thumbnail and medium at the same time, so
// they're all ready when the image first shows.
export async function storePng(ctx: ActionCtx, prefix: string, bytes: Uint8Array): Promise<{ key: string; sha256: string }> {
  const sha256 = sha256Hex(bytes);
  const [key, sizes]: [string, Sizes | null] = await Promise.all([
    storeObject(ctx, prefix + "/" + sha256 + ".png", bytes, "image/png"),
    sizesFor(ctx, sha256, bytes).catch((error: unknown) => {
      console.error("sizes failed", prefix, sha256, error);
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

// The thumbnail and medium for these bytes (convex/lib/sizes.ts): the ones already made for the
// same file, or new WebP copies, made and stored side by side.
async function sizesFor(ctx: ActionCtx, sha256: string, bytes: Uint8Array): Promise<Sizes> {
  const known: Sizes | null = await ctx.runQuery(internal.imageSizes.find, { sha256 });
  if (known) return known;
  const [thumbKey, mediumKey, size] = await Promise.all([
    webpCopy(bytes, "thumb").then((webp) => storeObject(ctx, sizeKey(sha256, "thumb"), webp, "image/webp")),
    webpCopy(bytes, "medium").then((webp) => storeObject(ctx, sizeKey(sha256, "medium"), webp, "image/webp")),
    uprightSize(bytes),
  ]);
  return { thumbKey, mediumKey, ...size };
}

// Makes and records the sizes of an image already stored (uploads, published art, and images from
// before sizes existed). Never throws: pages show the original while sizes are missing.
export async function makeSizes(ctx: ActionCtx, key: string, original?: Uint8Array): Promise<Sizes | null> {
  if (key.startsWith("fake:")) return null;
  try {
    const recorded: Sizes | null = await ctx.runQuery(internal.imageSizes.find, { key });
    if (recorded) return recorded;
    const bytes = original ?? (await fetchPublicImage(key, ctx));
    const sha256 = sha256Hex(bytes);
    const sizes = await sizesFor(ctx, sha256, bytes);
    await ctx.runMutation(internal.imageSizes.record, { key, sha256, ...sizes });
    return sizes;
  } catch (error) {
    console.error("makeSizes failed", key, error);
    return null;
  }
}
