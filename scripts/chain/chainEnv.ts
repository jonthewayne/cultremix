// Reads one value from ~/.config/cultremix/chain.env, where the chain scripts keep their keys.
// Never prints or logs a value.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CHAIN_ENV_FILE = join(homedir(), ".config", "cultremix", "chain.env");

export function chainEnvValue(name: string, file = CHAIN_ENV_FILE): string | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(line);
    if (match && match[1] === name) return match[2].replace(/^(["'])(.*)\1$/u, "$2") || null;
  }
  return null;
}
