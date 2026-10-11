import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { makeOnSale, makeUser, makeWork, setFlag } from "./shopFixtures";

// The early-access list's one email (convex/waitlist.ts emailOpen; V1 amendment A6).

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("emailing the early-access list", () => {
  it("emails each person once, naming every design they asked about that can be bought, when an admin presses Email them", async () => {
    const t = newTest();
    const creator = await makeUser(t, { authId: "auth-creator" });
    await makeUser(t, { authId: "owner", platformRole: "super_admin_owner" });
    await makeUser(t, { authId: "member" });
    const growSlow = await makeWork(t, { creatorId: creator, family: 101, expression: 1, title: "Grow Slow" });
    const offline = await makeWork(t, { creatorId: creator, family: 102, expression: 1, title: "Offline" });
    const notYet = await makeWork(t, { creatorId: creator, family: 103, expression: 1, title: "Trash Royalty" });
    await makeOnSale(t, growSlow, "101-001");
    await makeOnSale(t, offline, "102-001", 2000);
    for (const [email, workId] of [
      ["ann@example.com", growSlow],
      ["ann@example.com", offline],
      ["bo@example.com", growSlow],
      ["cy@example.com", notYet],
    ] as const) {
      await t.mutation(api.waitlist.join, { workId, email });
    }
    const owner = t.withIdentity({ subject: "owner" });

    // While Checkout is off it says who will hear, and sends nothing.
    expect(await owner.query(api.waitlist.emailSummary, {})).toEqual({
      checkoutOpen: false,
      readyPeople: 2,
      readyDesigns: 2,
      waiting: 1,
      notified: 0,
    });
    await expect(owner.mutation(api.waitlist.emailOpen, {})).rejects.toThrow(/Checkout on first/u);
    await expect(t.withIdentity({ subject: "member" }).mutation(api.waitlist.emailOpen, {})).rejects.toThrow();

    // Open: one email each, Ann's naming both designs; Cy waits for a design not on sale.
    await setFlag(t, "commerce.checkout", true);
    expect(await owner.mutation(api.waitlist.emailOpen, {})).toEqual({ sent: 2, more: false });
    const notes = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()))
      .filter((job) => job.name.includes("sendNote"))
      .map((job) => job.args[0] as { to: string; designs: Array<{ cr: string }> });
    expect(notes.map((note) => [note.to, note.designs.map((d) => d.cr).sort()]).sort()).toEqual([
      ["ann@example.com", ["101-001", "102-001"]],
      ["bo@example.com", ["101-001"]],
    ]);

    // Pressing again sends nothing more.
    expect(await owner.mutation(api.waitlist.emailOpen, {})).toEqual({ sent: 0, more: false });
    expect(await owner.query(api.waitlist.emailSummary, {})).toMatchObject({ readyPeople: 0, waiting: 1, notified: 3 });
  });
});
