import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ECONOMIC_CONFIG_V1, ECONOMIC_CONFIG_V2, canonicalConfigJson } from "../../convex/lib/economics";
import { economicsConfigFile, economicsConfigPath, sha256Hex } from "../../convex/lib/economicsConfigs";
import { economicsConfigResponse } from "../../src/lib/economicsRoute";

describe("/economics/v1.json", () => {
  it("serves exactly the canonical config bytes as JSON", async () => {
    const response = economicsConfigResponse("v1.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.text()).toBe(canonicalConfigJson());
  });

  it("hashes the same bytes the work page shows", async () => {
    const bytes = await economicsConfigResponse("v1.json").text();
    expect(await sha256Hex(canonicalConfigJson())).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("serves v2 too, with the affiliate and brand cuts, and leaves v1's bytes as they were", async () => {
    const v2 = await economicsConfigResponse("v2.json").text();
    expect(v2).toBe(canonicalConfigJson(ECONOMIC_CONFIG_V2));
    expect(JSON.parse(v2)).toMatchObject({ version: 2, creatorPoolBps: 1500, affiliateBps: 500, brandDefaultBps: 1000 });
    expect(canonicalConfigJson(ECONOMIC_CONFIG_V1)).not.toContain("affiliate");
  });

  it.each(["v3.json", "v1", "v1.json.bak", "../v1.json", "V1.json", "v01x.json", "v01.json", "constructor.json", "vtoString.json"])(
    "returns 404 for %s",
    (file) => {
      expect(economicsConfigResponse(file).status).toBe(404);
      expect(economicsConfigFile(file)).toBeNull();
    },
  );

  it("names the path by version", () => {
    expect(economicsConfigPath(1)).toBe("/economics/v1.json");
  });
});
