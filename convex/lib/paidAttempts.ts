// Rules for one paid call ("Paid attempt lifecycle" in the v1 plan). Pure TypeScript, so the Node
// actions, the mutations, and the tests share them.
import { isBlockedError } from "./imageErrors";

// The budget day a reservation counts against: the UTC date it was admitted, "2026-10-03".
export function dayUtc(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

// The sweeper's limits: an attempt still queued after 10 minutes never started, and one dispatched
// more than 15 minutes ago belongs to an action that died (an action runs at most 10 minutes).
export const QUEUED_EXPIRE_MS = 10 * 60_000;
export const DISPATCHED_EXPIRE_MS = 15 * 60_000;
export const EXPIRED_MESSAGE = "Timed out before starting.";
export const UNKNOWN_MESSAGE = "We lost track of this one.";

// What a reservation becomes once the call has run (or didn't):
// - release: no money was spent (never sent, or a definitive refusal);
// - settle: money may have been spent; actualCents is what the gateway reported, if anything usable.
export type Spend =
  | { kind: "release"; reason?: string }
  | { kind: "settle"; actualCents?: number; reason?: string };

// How a failed call ends. A definitive answer (a 4xx status, or the content filter) means nothing
// was billed, so the reservation is released. Everything else (a timeout, a lost connection, a
// 5xx) is ambiguous: the provider may have billed, so the reservation settles and the design's
// outcome is unknown.
export function callFailure(error: unknown): { spend: Spend; ambiguous: boolean } {
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if ((status !== undefined && status >= 400 && status < 500) || isBlockedError(message)) {
    return { spend: { kind: "release", reason: status ? `refused ${status}` : "content filter" }, ambiguous: false };
  }
  const name = error instanceof Error ? error.name : "";
  // The call answered, but without an image: billed, and the design is plainly missing.
  if (name.includes("NoImageGenerated")) return { spend: { kind: "settle", reason: "no image" }, ambiguous: false };
  return {
    spend: { kind: "settle", reason: status ? `failed ${status}` : name === "TimeoutError" || name === "AbortError" ? "timed out" : "no answer" },
    ambiguous: true,
  };
}

// The HTTP status on an AI SDK APICallError (or the gateway's own errors), found by shape so this
// file needs no SDK import.
function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["statusCode", "status"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return record.cause ? statusOf(record.cause) : undefined;
}
