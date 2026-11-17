// Published economics configs by version (V1 plan U10, judging evidence). Each is served at
// /economics/v<version>.json as exactly canonicalConfigJson(config); its SHA-256 is what work pages
// show and the registry records.
import { ECONOMIC_CONFIG_V1, ECONOMIC_CONFIG_V2, ECONOMIC_CONFIG_V3, ECONOMIC_CONFIG_V4, ECONOMIC_CONFIG_V5, ECONOMIC_CONFIG_V6, canonicalConfigJson } from "./economics";
import type { EconomicConfig } from "./economics";

export const ECONOMIC_CONFIGS: Readonly<Record<number, EconomicConfig>> = {
  1: ECONOMIC_CONFIG_V1,
  2: ECONOMIC_CONFIG_V2,
  3: ECONOMIC_CONFIG_V3,
  4: ECONOMIC_CONFIG_V4,
  5: ECONOMIC_CONFIG_V5,
  6: ECONOMIC_CONFIG_V6,
};

// New orders follow the current rules; each order line keeps the version it was sold under. The
// current rules are v6, costs-first sharing with artist credits (docs/decisions.md), everywhere.
// ECONOMICS_VERSION can name another published version for a deployment (the in-memory tests run
// v5's math unless a test asks for v6); an unknown value is ignored. v5 only ever ran on dev and is
// kept for the lines sold under it.
export function currentEconomicConfig(env: Record<string, string | undefined> = process.env): EconomicConfig {
  const named = Number(env.ECONOMICS_VERSION?.trim());
  if (Number.isInteger(named) && Object.prototype.hasOwnProperty.call(ECONOMIC_CONFIGS, named)) return ECONOMIC_CONFIGS[named];
  return ECONOMIC_CONFIG_V6;
}

// Whether new sales pay credited artists, which is what the publish sheet's credit question and
// the artist pages promise; they're hidden where it's off.
export function artistSharesOn(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(currentEconomicConfig(env).artistShareBps);
}

export function economicsConfigPath(version: number) {
  return `/economics/v${version}.json`;
}

// "v1.json" -> the config's canonical bytes; anything else -> null.
export function economicsConfigFile(file: string): { version: number; json: string } | null {
  const match = /^v([1-9]\d{0,5})\.json$/u.exec(file);
  if (!match) return null;
  const version = Number(match[1]);
  const config = Object.prototype.hasOwnProperty.call(ECONOMIC_CONFIGS, version) ? ECONOMIC_CONFIGS[version] : undefined;
  if (!config) return null;
  return { version, json: canonicalConfigJson(config) };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
