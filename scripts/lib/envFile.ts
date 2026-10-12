// Private KEY=value files under ~/.config/cultremix (secrets the launch scripts keep for the
// owner): read without printing, and updated in place, written to a temporary file readable only
// by the owner and renamed over the old one, so an interrupted write can't leave half a file.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u;

function unquote(value: string) {
  return value.replace(/^(["'])(.*)\1$/u, "$2");
}

export function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = LINE.exec(line);
    if (match && !values.has(match[1])) values.set(match[1], unquote(match[2]));
  }
  return values;
}

/** Sets (or, with null, removes) values, keeping every other line and comment where it was. */
export function updateEnvFile(path: string, updates: Record<string, string | null>) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").replace(/\n$/u, "").split("\n") : [];
  const pending = new Map(Object.entries(updates));
  const out: Array<string> = [];
  for (const line of lines) {
    const name = LINE.exec(line)?.[1];
    if (name === undefined || !pending.has(name)) {
      out.push(line);
      continue;
    }
    const value = pending.get(name);
    pending.delete(name);
    if (value !== null && value !== undefined) out.push(`${name}=${value}`);
  }
  for (const [name, value] of pending) if (value !== null) out.push(`${name}=${value}`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, out.length ? `${out.join("\n")}\n` : "", { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}
