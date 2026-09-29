import { describe, expect, it } from "vitest";
import {
  appUrlDefaults,
  authEmailFromDefault,
  authTrustedOriginsForDev,
  defaultConfig,
  generateSecret,
  inferRootDomain,
  isMissing,
  normalizeDomain,
  parseEnvFile,
  serializeEnvFile,
  slugifyProjectName,
} from "../../scripts/lib/config";

describe("setup config helpers", () => {
  it("defaults to console email, with phone auth and Telnyx credentials disabled", () => {
    expect(defaultConfig.emailProvider).toBe("console");
    expect(defaultConfig.enablePhone).toBe(false);
    expect(defaultConfig.smsProvider).toBe("console");
    expect(defaultConfig.telnyxApiKey).toBe("");
    expect(defaultConfig.telnyxPhoneNumber).toBe("");
  });

  it("slugifies project names", () => {
    expect(slugifyProjectName("My Great App!")).toBe("my-great-app");
  });

  it("parses and serializes env files", () => {
    const parsed = parseEnvFile('A=1\nB="two words"\n# comment\n');
    expect(parsed).toEqual({ A: "1", B: "two words" });
    expect(serializeEnvFile(parsed)).toContain('B="two words"');
  });

  it("detects placeholders", () => {
    expect(isMissing("REPLACE_ME")).toBe(true);
    expect(isMissing("dev:REPLACE_ME")).toBe(true);
    expect(isMissing("real-value")).toBe(false);
  });

  it("generates strong secrets", () => {
    expect(generateSecret()).toHaveLength(43);
  });

  it("derives project URL defaults from one root domain", () => {
    expect(normalizeDomain("https://www.example.test/path")).toBe("example.test");
    expect(appUrlDefaults("example.test")).toEqual({
      canonicalDevUrl: "https://dev.example.test",
      devUrl: "https://dev.example.test",
      prodUrl: "https://example.test",
      previewBaseDomain: "preview.example.test",
    });
    expect(authEmailFromDefault("Demo", "example.test")).toBe(
      "Demo <hello@example.test>",
    );
  });

  it("trusts both branch preview and canonical dev app origins", () => {
    expect(authTrustedOriginsForDev("https://dev.example.test", "example.test")).toBe(
      "https://*.dev.example.test,https://*.preview.example.test,http://localhost:3000,http://localhost:5173",
    );
  });

  it("infers root domains from existing app URLs", () => {
    expect(inferRootDomain("https://dev.example.test")).toBe("example.test");
    expect(inferRootDomain("https://www.example.test")).toBe("example.test");
  });
});
