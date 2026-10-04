import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The browser must never load the code that writes image notes or builds prompts; that stays in
// Convex functions. This follows every import from src/ (the code that ships to the browser) and
// checks each convex/ file it reaches against this list of files that are safe there.
const BROWSER_SAFE = new Set([
  "convex/_generated/api.js",
  "convex/lib/authz.ts",
  "convex/lib/colors.ts",
  // The published economics config (served at /economics/v1.json) and its pure share math.
  "convex/lib/economics.ts",
  "convex/lib/economicsConfigs.ts",
  // Shirt colors and the contrast check; the early-access email rules.
  "convex/lib/garments.ts",
  "convex/lib/earlyAccess.ts",
  "convex/lib/studioRules.ts",
  "convex/lib/username.ts",
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Imports and re-exports (type-only imports are erased from the bundle), and import().
const STATIC = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/gu;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

function sourceFiles(dir: string): Array<string> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

// The project file an import points to, or null for packages and non-code files.
function resolveImport(from: string, specifier: string) {
  const bare = specifier.split("?")[0];
  let base: string;
  if (bare.startsWith(".")) base = resolve(dirname(from), bare);
  else if (bare.startsWith("~/") || bare.startsWith("@/")) base = join(root, "src", bare.slice(2));
  else return null;
  for (const extension of EXTENSIONS) {
    const file = base + extension;
    if (existsSync(file) && statSync(file).isFile()) return /\.(ts|tsx|js|jsx)$/u.test(file) ? file : null;
  }
  return null;
}

// Every project file reachable from src/, each with the file that imported it.
function reachableFromSrc() {
  const importedBy = new Map<string, string>();
  const queue: Array<[string, string]> = sourceFiles(join(root, "src")).map((file) => [file, file]);
  while (queue.length > 0) {
    const [file, from] = queue.pop()!;
    if (importedBy.has(file)) continue;
    importedBy.set(file, from);
    const source = readFileSync(file, "utf8");
    for (const pattern of [STATIC, DYNAMIC]) {
      for (const match of source.matchAll(pattern)) {
        const target = resolveImport(file, match[1]);
        if (target && !importedBy.has(target)) queue.push([target, file]);
      }
    }
  }
  return new Map([...importedBy].map(([file, from]) => [relative(root, file), relative(root, from)]));
}

describe("browser code boundary", () => {
  const reached = reachableFromSrc();

  it("keeps prompts and image notes out of browser code", () => {
    const serverFiles = [...reached]
      .filter(([file]) => file.startsWith("convex/") && !BROWSER_SAFE.has(file))
      .map(([file, from]) => `${file} (imported by ${from})`);
    expect(serverFiles).toEqual([]);
  });

  it("follows imports into convex/", () => {
    // Without this, a walker that stopped following imports would pass the check above.
    expect(["src/components/publish/PublishDialog.tsx", "src/lib/designPixels.ts"]).toContain(
      reached.get("convex/lib/garments.ts"),
    );
    expect(reached.has("convex/_generated/api.js")).toBe(true);
  });
});
