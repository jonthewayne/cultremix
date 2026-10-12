import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readEnvFile, updateEnvFile } from "../../scripts/lib/envFile";

// The private files under ~/.config/cultremix that scripts/circle-setup.ts keeps keys in.
describe("private env files", () => {
  it("updates values in place, keeps every other line, and stays readable only by its owner", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cr-env-")), "sub", "circle.env");
    updateEnvFile(path, { A: "1" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    writeFileSync(path, '# keys\nA=1\nexport B="two words"\nC=3\n', { mode: 0o644 });
    updateEnvFile(path, { A: "9", C: null, D: "4" });
    expect(readFileSync(path, "utf8")).toBe('# keys\nA=9\nexport B="two words"\nD=4\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(Object.fromEntries(readEnvFile(path))).toEqual({ A: "9", B: "two words", D: "4" });
    expect(readEnvFile(join(path, "missing")).size).toBe(0);
  });
});
