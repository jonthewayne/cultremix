import { describe, expect, it } from "vitest";
import { isBlockedError } from "../../convex/lib/imageErrors";

describe("content filter errors", () => {
  it("recognizes the provider's refusals", () => {
    // Through the AI Gateway (production), as seen on a real tile.
    expect(
      isBlockedError(
        "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID req_fc4f8ed37e2a4dd0aa383294e3e41703.",
      ),
    ).toBe(true);
    // The ChatGPT backend's failed event, and a reply in words with no image.
    expect(isBlockedError('The image service refused: {"code":"moderation_blocked","message":"Your request was rejected."}')).toBe(true);
    expect(isBlockedError("The image service answered without an image: I can’t help create that image.")).toBe(true);
  });

  it("leaves other failures alone", () => {
    for (const error of [
      "Timed out.",
      "The image service returned no image.",
      "Image service error 429. Rate limit reached for requests.",
      "Image fetch failed (502).",
      "Image service error 400. The model cannot generate images at this size.",
      "The image service answered without an image: Here is your design.",
      undefined,
    ]) {
      expect(isBlockedError(error)).toBe(false);
    }
  });
});
