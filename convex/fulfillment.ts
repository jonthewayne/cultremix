import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Printful fulfillment. Filled in with step 5.
export const advance = internalMutation({
  args: { orderId: v.id("orders") },
  returns: v.null(),
  handler: async () => null,
});
