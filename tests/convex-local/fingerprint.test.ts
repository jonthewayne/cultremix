import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { makeUser, makeWork } from "./shopFixtures";

const HASH = "95654137b44de7a7928d721802c83f37ae141ac19747406d80663c7f31a88677";

describe("provenance.byFingerprint", () => {
  it("finds the published design whose original file has this SHA-256, with or without 0x", async () => {
    const t = newTest();
    const creator = await makeUser(t, { name: "Sam" });
    await t.run((ctx) => ctx.db.patch("users", creator, { username: "samdraws", usernameLower: "samdraws" }));
    const workId = await makeWork(t, { creatorId: creator, family: 108, expression: 1, title: "Far Out" });
    await t.run((ctx) => ctx.db.patch("works", workId, { contentHash: HASH }));

    const found = await t.query(api.provenance.byFingerprint, { contentHash: HASH });
    expect(found).toMatchObject({ workId, cr: "108-001", title: "Far Out", creator: "samdraws", kind: "original" });
    expect(await t.query(api.provenance.byFingerprint, { contentHash: "0x" + HASH.toUpperCase() })).toMatchObject({ cr: "108-001" });
  });

  it("never finds a kept design, and refuses anything that isn't a fingerprint", async () => {
    const t = newTest();
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 108, expression: 1 });
    await t.run((ctx) => ctx.db.patch("works", workId, { contentHash: HASH, status: "private", keep: "private" }));
    expect(await t.query(api.provenance.byFingerprint, { contentHash: HASH })).toBeNull();
    expect(await t.query(api.provenance.byFingerprint, { contentHash: "abc" })).toBeNull();
    expect(await t.query(api.provenance.byFingerprint, { contentHash: "z".repeat(64) })).toBeNull();
  });
});

