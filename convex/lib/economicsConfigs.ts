// Published economics configs by version (V1 plan U10, judging evidence). Each is served at
// /economics/v<version>.json as exactly canonicalConfigJson(config); its SHA-256 is what work pages
// show and the registry records.
import { ECONOMIC_CONFIG_V1, ECONOMIC_CONFIG_V2, ECONOMIC_CONFIG_V3, ECONOMIC_CONFIG_V4, ECONOMIC_CONFIG_V5, canonicalConfigJson } from "./economics";
import type { EconomicConfig } from "./economics";

export const ECONOMIC_CONFIGS: Readonly<Record<number, EconomicConfig>> = {
  1: ECONOMIC_CONFIG_V1,
  2: ECONOMIC_CONFIG_V2,
  3: ECONOMIC_CONFIG_V3,
  4: ECONOMIC_CONFIG_V4,
  5: ECONOMIC_CONFIG_V5,
};

// New orders follow the current rules; each order line keeps the version it was sold under.
// v5 adds artist credits. docs/decisions.md keeps it off production until costs-first sharing
// joins it, so production (DEPLOYMENT_ENV=prod) stays on v4 unless ECONOMICS_VERSION=5 is set
// there on purpose: lines keep their version, so a rules version that reached production by
// accident couldn't be taken back. Every other deployment runs v5.
export function currentEconomicConfig(env: Record<string, string | undefined> = process.env): EconomicConfig {
  const production = env.DEPLOYMENT_ENV?.trim().toLowerCase() === "prod";
  return production && env.ECONOMICS_VERSION?.trim() !== "5" ? ECONOMIC_CONFIG_V4 : ECONOMIC_CONFIG_V5;
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
