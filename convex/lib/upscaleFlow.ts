import type { FalClient, Submission } from "./fal";

// "Upscale for print" as two steps with everything outside passed in, so tests can run them
// without Convex or the network (convex/upscale.ts wires the real ones).
//
// Submit: claim the attempt, POST once, save the request ID, then poll. A claim that fails means
// another run already submitted (or the attempt ended), so nothing is posted.
// Poll: GETs only. Never submits again, whatever happens.

export const POLL_FIRST_MS = 4_000;
export const POLL_MAX_MS = 20_000;
export const UPSCALE_TIMEOUT_MS = 15 * 60_000;

export function pollDelay(polls: number) {
  return Math.min(POLL_MAX_MS, Math.round(POLL_FIRST_MS * 1.5 ** Math.max(0, polls - 1)));
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message.slice(0, 200) : fallback;
}

export type SubmitDeps = {
  claim: () => Promise<boolean>;
  client: Pick<FalClient, "submit"> | null;
  imageUrl: string | undefined;
  record: (submission: Submission) => Promise<void>;
  fail: (error: string) => Promise<void>;
  schedulePoll: (delayMs: number) => Promise<void>;
};

export async function submitUpscale(deps: SubmitDeps): Promise<"skipped" | "submitted" | "failed"> {
  if (!(await deps.claim())) return "skipped";
  if (!deps.client) {
    await deps.fail("Upscaling isn't set up yet.");
    return "failed";
  }
  if (!deps.imageUrl || !/^https?:\/\//u.test(deps.imageUrl)) {
    await deps.fail("This version has no public address to upscale from.");
    return "failed";
  }
  let submission: Submission;
  try {
    submission = await deps.client.submit(deps.imageUrl);
  } catch (error) {
    await deps.fail(message(error, "The upscaler couldn't take it."));
    return "failed";
  }
  try {
    await deps.record(submission);
  } catch (error) {
    // fal has the job but we couldn't save its ID: give up on it rather than ever posting again.
    await deps.fail(message(error, "The upscale couldn't be tracked."));
    return "failed";
  }
  await deps.schedulePoll(pollDelay(1));
  return "submitted";
}

export type PollDeps = {
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
        await deps.fail("The upscale took too long.");
        return "failed";
      }
      await deps.scheduleNext(pollDelay(polls + 1));
      return "waiting";
    }
    const image = await deps.client.result(deps.responseUrl);
    const bytes = await deps.download(image.url);
    if (!deps.carriesAlpha(bytes)) {
      await deps.fail("The upscale came back without transparency, so it can't be used.");
      return "failed";
    }
    try {
      await deps.accept(bytes, elapsed);
    } catch (error) {
      await deps.fail(message(error, "The upscale couldn't be saved."));
      return "failed";
    }
    return "done";
  } catch (error) {
    // Reading failed even after retries. Keep polling (GETs only) until the time runs out.
    if (elapsed > UPSCALE_TIMEOUT_MS) {
      await deps.fail(message(error, "The upscale couldn't be read."));
      return "failed";
    }
    await deps.scheduleNext(pollDelay(polls + 1));
    return "waiting";
  }
}
