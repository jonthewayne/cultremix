"use node";

import Telnyx from "telnyx";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { shouldUseConsoleSmsProvider } from "./lib/providerConfig";

function useConsoleSmsProvider() {
  return shouldUseConsoleSmsProvider(process.env.AUTH_SMS_PROVIDER);
}

export const sendSms = internalAction({
  args: {
    to: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, { to, body }) => {
    if (useConsoleSmsProvider()) {
      console.log("[sms.console]", { to, body });
      return null;
    }

    const apiKey = process.env.TELNYX_API_KEY;
    const from = process.env.TELNYX_PHONE_NUMBER;
    if (!apiKey) throw new Error("TELNYX_API_KEY not set");
    if (!from) throw new Error("TELNYX_PHONE_NUMBER not set");

    try {
      const telnyx = new Telnyx({ apiKey });
      await telnyx.messages.send({ from, to, text: body });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("opt-out") || message.includes("opted out")) {
        throw new Error("RECIPIENT_OPTED_OUT");
      }
      throw error;
    }

    return null;
  },
});
