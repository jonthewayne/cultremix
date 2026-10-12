// One more try for an image call the provider rate-limited. A 429 means nothing was made or billed,
// so trying again after a pause is safe, and it's what several people generating at once would hit.
// Every other failure goes back as it was: the image calls never retry otherwise (maxRetries: 0),
// since a timeout or a 5xx may already have been billed. A 429 about quota or credit isn't a rate
// limit (OpenAI answers an exhausted quota with 429), so it isn't tried again either.
import { isOutOfCreditError } from "./imageErrors";
import { statusOf } from "./paidAttempts";

export const RATE_LIMIT_WAIT_MS = 8_000;
const MIN_WAIT_MS = 2_000;
const MAX_WAIT_MS = 20_000;

// The provider's Retry-After, in milliseconds, when it sent one in seconds.
function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const headers = (error as { responseHeaders?: Record<string, string> }).responseHeaders;
  const value = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const seconds = value === undefined ? NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export function isRateLimited(error: unknown) {
  if (statusOf(error) !== 429) return false;
  const message = error instanceof Error ? error.message : "";
  return !isOutOfCreditError(message) && !/quota/iu.test(message);
}

export async function onceMoreIfRateLimited<T>(
  call: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!isRateLimited(error)) throw error;
    await wait(Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, retryAfterMs(error) ?? RATE_LIMIT_WAIT_MS)));
    return await call();
  }
}
