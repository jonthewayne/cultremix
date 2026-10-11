import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";

// Admin, Overview's gateway credit (convex/gatewayCredit.ts).
describe("gateway credit", () => {
  it("is for admins only, and says nothing when the gateway isn't set up", async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "test|member", username: "member", usernameLower: "member" });
      await ctx.db.insert("users", { authId: "test|support", username: "support", usernameLower: "support", platformRole: "super_admin_support" });
    });
    await expect(t.action(api.gatewayCredit.balance, {})).rejects.toThrow(/Admins only/u);
    await expect(t.withIdentity({ subject: "test|member", issuer: "test" }).action(api.gatewayCredit.balance, {})).rejects.toThrow(/Admins only/u);
    const saved = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    try {
      expect(await t.withIdentity({ subject: "test|support", issuer: "test" }).action(api.gatewayCredit.balance, {})).toBeNull();
    } finally {
      if (saved !== undefined) process.env.AI_GATEWAY_API_KEY = saved;
    }
  });
});
