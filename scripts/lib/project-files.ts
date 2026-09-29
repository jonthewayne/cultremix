import { basename } from "node:path";

const excludedNames = new Set([
  ".git",
  ".output",
  ".convex",
  ".mega",
  ".starter",
  ".tmp",
  ".wrangler",
  "dist",
  "node_modules",
  "worker-configuration.d.ts",
]);

function isEnvironmentTemplate(name: string) {
  return name === ".env.example" || /^\.env\..+\.example$/u.test(name);
}

function isDevVarsTemplate(name: string) {
  return name === ".dev.vars.example" || /^\.dev\.vars\..+\.example$/u.test(name);
}

export function shouldExcludeProjectEntry(path: string) {
  const name = basename(path);
  if (excludedNames.has(name)) return true;
  if (isEnvironmentTemplate(name)) return false;
  if (isDevVarsTemplate(name)) return false;
  if (name === ".dev.vars" || name.startsWith(".dev.vars.")) return true;
  return name === ".env" || name.startsWith(".env.");
}
