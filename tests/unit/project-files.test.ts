import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldExcludeProjectEntry } from "../../scripts/lib/project-files";

describe("project copy exclusions", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    ".env.production.local",
    ".dev.vars",
    ".dev.vars.production",
    ".convex",
    ".mega",
    "node_modules",
    ".wrangler",
    "worker-configuration.d.ts",
  ])("excludes local or generated entry %s", (entry) => {
    expect(shouldExcludeProjectEntry(`/starter/${entry}`)).toBe(true);
  });

  it.each([
    ".env.example",
    ".env.development.example",
    ".env.production.example",
    ".dev.vars.example",
    ".dev.vars.preview.example",
    "wrangler.jsonc.template",
  ])("keeps safe environment template %s", (entry) => {
    expect(shouldExcludeProjectEntry(`/starter/${entry}`)).toBe(false);
  });

  it("keeps the Wrangler generator template free of deployment-specific state", () => {
    const template = JSON.parse(
      readFileSync(
        new URL("../../wrangler.jsonc.template", import.meta.url),
        "utf8",
      ),
    );

    expect(template.account_id).toBeUndefined();
    expect(template.env.production.routes[0].pattern).toBe("example.com");
    expect(template.env.development.routes[0].pattern).toBe("dev.example.com");
  });
});
