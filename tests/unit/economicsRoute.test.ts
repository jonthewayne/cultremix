import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ECONOMIC_CONFIG_V1, ECONOMIC_CONFIG_V2, ECONOMIC_CONFIG_V3, ECONOMIC_CONFIG_V4, ECONOMIC_CONFIG_V5, canonicalConfigJson } from "../../convex/lib/economics";
import { currentEconomicConfig, economicsConfigFile, economicsConfigPath, sha256Hex } from "../../convex/lib/economicsConfigs";
import { economicsConfigResponse } from "../../src/lib/economicsRoute";

describe("the current rules version", () => {
  it("keeps production on v4 until v5 is turned on there on purpose", () => {
    expect(currentEconomicConfig({ DEPLOYMENT_ENV: "prod" })).toBe(ECONOMIC_CONFIG_V4);
    expect(currentEconomicConfig({ DEPLOYMENT_ENV: "prod", ECONOMICS_VERSION: "5" })).toBe(ECONOMIC_CONFIG_V5);
    expect(currentEconomicConfig({ DEPLOYMENT_ENV: "dev" })).toBe(ECONOMIC_CONFIG_V5);
    expect(currentEconomicConfig({ DEPLOYMENT_ENV: "staging" })).toBe(ECONOMIC_CONFIG_V5);
  });
});

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

  it("serves v3, with the lowest creators' share a brand's agreement can set, and leaves v2's bytes as they were", async () => {
    const v3 = await economicsConfigResponse("v3.json").text();
    expect(v3).toBe(canonicalConfigJson(ECONOMIC_CONFIG_V3));
    expect(JSON.parse(v3)).toMatchObject({ version: 3, creatorPoolBps: 1500, affiliateBps: 500, brandDefaultBps: 1000, brandCreatorPoolMinBps: 500 });
    expect(canonicalConfigJson(ECONOMIC_CONFIG_V2)).not.toContain("brandCreatorPoolMinBps");
  });

  it("serves v4, with a brand deal's cap and starting split, and leaves v3's bytes as they were", async () => {
    const v4 = await economicsConfigResponse("v4.json").text();
    expect(v4).toBe(canonicalConfigJson(ECONOMIC_CONFIG_V4));
    expect(JSON.parse(v4)).toMatchObject({
      version: 4,
      creatorPoolBps: 1500,
      affiliateBps: 500,
      brandDefaultBps: 1500,
      brandCreatorDefaultBps: 1000,
      brandCreatorPoolMinBps: 500,
      brandFamilyMaxBps: 3000,
    });
    expect(canonicalConfigJson(ECONOMIC_CONFIG_V3)).not.toContain("brandFamilyMaxBps");
  });

  it("serves v5, with the outside artists' share, and leaves v4's bytes as they were", async () => {
    const v5 = await economicsConfigResponse("v5.json").text();
    expect(v5).toBe(canonicalConfigJson(ECONOMIC_CONFIG_V5));
    expect(JSON.parse(v5)).toMatchObject({ version: 5, artistShareBps: 2000, brandFamilyMaxBps: 3000 });
    expect(canonicalConfigJson(ECONOMIC_CONFIG_V4)).not.toContain("artistShareBps");
  });

  it.each(["v6.json", "v1", "v1.json.bak", "../v1.json", "V1.json", "v01x.json", "v01.json", "constructor.json", "vtoString.json"])(
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
