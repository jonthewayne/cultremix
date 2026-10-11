import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";

// The gateway credit watch's decisions (convex/opsAlerts.ts recordGatewayCredit).
describe("the gateway credit alert", () => {
  it("tells the owner and ops once when the credit drops below $10, again when it runs out, and again after it recovers and drops", async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "owner", email: "owner@example.com", username: "owner", usernameLower: "owner", platformRole: "super_admin_owner" });
      await ctx.db.insert("users", { authId: "ops", username: "ops", usernameLower: "ops", platformRole: "super_admin_ops" });
      await ctx.db.insert("users", { authId: "member", username: "member", usernameLower: "member" });
    });
    const alerts = async (subject: string) =>
      (await t.withIdentity({ subject }).query(api.notifications.list, { paginationOpts: { numItems: 20, cursor: null } })).page
        .filter((item) => item.kind === "ops_alert")
        .map((item) => item.alert);
    const emails = async () =>
      (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes("sendCreditEmail")).length;
    const record = (balanceCents: number) => t.mutation(internal.opsAlerts.recordGatewayCredit, { balanceCents });

    expect(await record(1383)).toBe("ok");
    expect(await alerts("owner")).toEqual([]);
    expect(await record(820)).toBe("low");
    expect(await record(700)).toBe("low");
    expect(await alerts("owner")).toEqual([expect.stringMatching(/^The image credit is low: \$8\.20 left, about 63 batches\./u)]);
    expect(await alerts("ops")).toHaveLength(1);
    expect(await alerts("member")).toEqual([]);
    expect(await emails()).toBe(1);

    expect(await record(-58)).toBe("out");
    expect((await alerts("owner"))[0]).toMatch(/^The image credit has run out/u);
    expect(await emails()).toBe(2);

    // Credit added, then low again: told again.
    expect(await record(5000)).toBe("ok");
    expect(await record(900)).toBe("low");
    expect(await alerts("owner")).toHaveLength(3);
  });
});
