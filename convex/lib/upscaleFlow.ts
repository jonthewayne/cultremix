import type { FalClient, Submission } from "./fal";
import type { Spend } from "./paidAttempts";

// "Upscale for print" as two steps with everything outside passed in, so tests can run them
// without Convex or the network (convex/upscale.ts wires the real ones).
//
// Submit: claim the attempt, POST once, save the request ID, then poll. A claim that fails means
// another run already submitted (or the attempt ended), so nothing is posted.
// Poll: GETs only. Never submits again, whatever happens.
//
// Each submit failure says what happened to the attempt's fal budget reservation: released when
// nothing reached fal (or fal refused it outright), settled when fal may have the job.

// The flow runs both fal tools; what its messages call them.
const WORDS = {
  upscale: { setUp: "Upscaling isn't set up yet.", refused: "The upscaler couldn't take it.", noAddress: "upscale from", it: "The upscale" },
  cutout: {
    setUp: "Background removal isn't set up yet.",
    refused: "Background removal couldn't take it.",
    noAddress: "remove the background from",
    it: "The cutout",
  },
} as const;
export type FalJob = keyof typeof WORDS;

export const POLL_FIRST_MS = 4_000;
export const POLL_MAX_MS = 20_000;
export const UPSCALE_TIMEOUT_MS = 15 * 60_000;

export function pollDelay(polls: number) {
  return Math.min(POLL_MAX_MS, Math.round(POLL_FIRST_MS * 1.5 ** Math.max(0, polls - 1)));
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message.slice(0, 200) : fallback;
}

// A refused post (fal answered 4xx) took no job and costs nothing. Anything else (a 5xx, a lost
// connection, a reply without a request ID) may have left a job running on fal, so it's paid for.
export function submitFailureSpend(error: unknown): Spend {
  const status = error && typeof error === "object" ? (error as { httpStatus?: unknown }).httpStatus : undefined;
  if (typeof status === "number" && status >= 400 && status < 500) return { kind: "release", reason: `refused ${status}` };
  return { kind: "settle", reason: typeof status === "number" ? `failed ${status}` : "no answer" };
}

export type SubmitDeps = {
  // Which tool this is, for its messages (an upscale unless said).
  kind?: FalJob;
  claim: () => Promise<boolean>;
  client: Pick<FalClient, "submit"> | null;
  imageUrl: string | undefined;
  record: (submission: Submission) => Promise<void>;
  fail: (error: string, spend: Spend) => Promise<void>;
  schedulePoll: (delayMs: number) => Promise<void>;
};

export async function submitUpscale(deps: SubmitDeps): Promise<"skipped" | "submitted" | "failed"> {
  const words = WORDS[deps.kind ?? "upscale"];
  if (!(await deps.claim())) return "skipped";
  if (!deps.client) {
    await deps.fail(words.setUp, { kind: "release", reason: "no key" });
    return "failed";
  }
  if (!deps.imageUrl || !/^https?:\/\//u.test(deps.imageUrl)) {
    await deps.fail(`This version has no public address to ${words.noAddress}.`, { kind: "release", reason: "no address" });
    return "failed";
  }
  let submission: Submission;
  try {
    submission = await deps.client.submit(deps.imageUrl);
  } catch (error) {
    await deps.fail(message(error, words.refused), submitFailureSpend(error));
    return "failed";
  }
  try {
    await deps.record(submission);
  } catch (error) {
    // fal has the job but we couldn't save its ID: give up on it rather than ever posting again.
    await deps.fail(message(error, `${words.it} couldn't be tracked.`), { kind: "settle", reason: "untracked" });
    return "failed";
  }
  await deps.schedulePoll(pollDelay(1));
  return "submitted";
}

export type PollDeps = {
  kind?: FalJob;
  client: Pick<FalClient, "status" | "result">;
  statusUrl: string;
  responseUrl: string;
  submittedAt: number;
  now: () => number;
  notePoll: () => Promise<number>;
  download: (url: string) => Promise<Uint8Array>;
  // PNG with an alpha channel. The pixels are checked again when stored.
  carriesAlpha: (bytes: Uint8Array) => boolean;
  accept: (bytes: Uint8Array, latencyMs: number) => Promise<void>;
  fail: (error: string) => Promise<void>;
  scheduleNext: (delayMs: number) => Promise<void>;
};

export async function pollUpscale(deps: PollDeps): Promise<"waiting" | "done" | "failed"> {
  const words = WORDS[deps.kind ?? "upscale"];
  const polls = await deps.notePoll();
  const elapsed = deps.now() - deps.submittedAt;
  try {
    const status = await deps.client.status(deps.statusUrl);
    if (status.status === "FAILED") {
      await deps.fail(status.error);
      return "failed";
    }
    if (status.status !== "COMPLETED") {
      if (elapsed > UPSCALE_TIMEOUT_MS) {
        await deps.fail(`${words.it} took too long.`);
        return "failed";
      }
      await deps.scheduleNext(pollDelay(polls + 1));
      return "waiting";
    }
    const image = await deps.client.result(deps.responseUrl);
    const bytes = await deps.download(image.url);
    if (!deps.carriesAlpha(bytes)) {
      await deps.fail(`${words.it} came back without transparency, so it can't be used.`);
      return "failed";
    }
    try {
      await deps.accept(bytes, elapsed);
    } catch (error) {
      await deps.fail(message(error, `${words.it} couldn't be saved.`));
      return "failed";
    }
    return "done";
  } catch (error) {
    // Reading failed even after retries. Keep polling (GETs only) until the time runs out.
    if (elapsed > UPSCALE_TIMEOUT_MS) {
      await deps.fail(message(error, `${words.it} couldn't be read.`));
      return "failed";
    }
    await deps.scheduleNext(pollDelay(polls + 1));
    return "waiting";
  }
}
