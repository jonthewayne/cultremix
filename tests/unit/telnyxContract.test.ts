import { describe, expect, it } from "vitest";
import Telnyx from "telnyx";

describe("Telnyx SDK contract", () => {
  it("constructs the v7 client and exposes messages.send without network access", () => {
    const client = new Telnyx({ apiKey: "contract-test-key" });

    expect(client.messages.send).toBeTypeOf("function");
  });
});
