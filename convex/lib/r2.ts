import { R2 } from "@convex-dev/r2";
import { components } from "../_generated/api";

// One public bucket per environment (R2_BUCKET), served from its r2.dev URL
// (R2_PUBLIC_URL). Keys are content-addressed: inspo/, gen/, art/, photo/.
export const r2 = new R2(components.r2);

export function r2Configured() {
  return Boolean(
    process.env.R2_BUCKET &&
      process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

export function isDevDeployment() {
  return process.env.DEPLOYMENT_ENV === "dev";
}

// Keys starting with "fake:" come from the dev stand-in before keys exist;
// the client draws a placeholder for them.
export function publicUrl(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.startsWith("fake:")) return key;
  const base = process.env.R2_PUBLIC_URL?.replace(/\/$/u, "");
  return base ? `${base}/${key}` : undefined;
}

export function formatCr(family: number, expression: number) {
  return `${family}-${String(expression).padStart(3, "0")}`;
}

export function parseCr(cr: string): { family: number; expression: number } | null {
  const match = /^(?:CR\s*)?(\d{3,})-(\d{3,})$/iu.exec(cr.trim());
  if (!match) return null;
  return { family: Number(match[1]), expression: Number(match[2]) };
}
