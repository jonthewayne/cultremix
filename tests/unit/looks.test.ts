import { describe, expect, it } from "vitest";
import { CASTING, POSES, SETTINGS, pickLook, photoPrompt } from "../../convex/lib/prompts";

describe("model photo looks", () => {
  it("picks the same look for the same seed", () => {
    expect(pickLook("work-1", [])).toEqual(pickLook("work-1", []));
  });

  it("skips castings and settings used by recent shoots", () => {
    const recent = CASTING.slice(0, 10).map((casting, i) => ({ casting, world: SETTINGS[i % 6] }));
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const look = pickLook(seed, recent);
      expect(CASTING.slice(10)).toContain(look.casting);
      expect(SETTINGS.slice(6)).toContain(look.world);
      expect(POSES).toContain(look.pose);
    }
  });

  it("spreads new photos across many castings", () => {
    const castings = new Set(Array.from({ length: 40 }, (_, i) => pickLook(`work-${i}`, []).casting));
    expect(castings.size).toBeGreaterThanOrEqual(8);
  });

  it("puts the casting, pose, and setting into the photo prompt", () => {
    const look = { casting: CASTING[7], pose: POSES[2], world: SETTINGS[3] };
    const prompt = photoPrompt("#143cc8", look);
    expect(prompt).toContain(CASTING[7]);
    expect(prompt).toContain(POSES[2]);
    expect(prompt).toContain(SETTINGS[3]);
    expect(prompt.length).toBeLessThanOrEqual(1000);
  });
});
