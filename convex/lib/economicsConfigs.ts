// Published economics configs by version (V1 plan U10, judging evidence). Each is served at
// /economics/v<version>.json as exactly canonicalConfigJson(config); its SHA-256 is what work pages
// show and the registry records.
import { ECONOMIC_CONFIG_V1, canonicalConfigJson } from "./economics";
import type { EconomicConfig } from "./economics";

export const ECONOMIC_CONFIGS: Readonly<Record<number, EconomicConfig>> = { 1: ECONOMIC_CONFIG_V1 };

export const CURRENT_ECONOMIC_CONFIG = ECONOMIC_CONFIG_V1;

export function economicsConfigPath(version: number) {
  return `/economics/v${version}.json`;
}

// "v1.json" -> the config's canonical bytes; anything else -> null.
export function economicsConfigFile(file: string): { version: number; json: string } | null {
  const match = /^v([1-9]\d{0,5})\.json$/u.exec(file);
  if (!match) return null;
  const version = Number(match[1]);
  const config = Object.hasOwn(ECONOMIC_CONFIGS, version) ? ECONOMIC_CONFIGS[version] : undefined;
  if (!config) return null;
  return { version, json: canonicalConfigJson(config) };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
