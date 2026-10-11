import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { falClient } from "../../convex/lib/fal";
import type { FetchLike } from "../../convex/lib/fal";
import { pngCarriesAlpha } from "../../convex/lib/printImage";
import { UPSCALE_TIMEOUT_MS, pollDelay, pollUpscale, submitFailureSpend, submitUpscale } from "../../convex/lib/upscaleFlow";
import type { PollDeps, SubmitDeps } from "../../convex/lib/upscaleFlow";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A fake fal: counts POSTs, answers status with a script.
function fakeFal(statuses: Array<string | Error> = []) {
  const posts: Array<string> = [];
  const fetch: FetchLike = async (url, init) => {
    if (init?.method === "POST") {
      posts.push(url);
      return json({ request_id: `req-${posts.length}` }, 202);
    }
    if (url.endsWith("/status")) {
      const next = statuses.shift() ?? "IN_PROGRESS";
      if (next instanceof Error) throw next;
      return json({ status: next });
    }
    return json({ image: { url: "https://v3.fal.media/files/out.png", content_type: "image/png", file_size: 10 } });
  };
  return { client: falClient({ key: "k", fetch, retries: 0, retryDelayMs: 0 }), posts };
}

function submitDeps(overrides: Partial<SubmitDeps> & { claimed?: { value: boolean } } = {}) {
  const log: Array<string> = [];
  const claimed = overrides.claimed ?? { value: false };
  const deps: SubmitDeps = {
    // True once, like the claimSubmission mutation.
    claim: async () => {
      if (claimed.value) return false;
      claimed.value = true;
      return true;
    },
    client: fakeFal().client,
    imageUrl: "https://images.example/v2.png",
    record: async (submission) => {
      log.push(`record ${submission.requestId}`);
    },
    // The budget reservation's fate rides along: released when nothing reached fal.
    fail: async (error, spend) => {
      log.push(`fail ${error} (${spend.kind})`);
    },
    schedulePoll: async (delayMs) => {
      log.push(`poll in ${delayMs}`);
    },
    ...overrides,
  };
  return { deps, log };
}

async function transparentPng() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10" fill="red"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function opaquePng() {
  return new Uint8Array(await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).png().toBuffer());
}

function pollDeps(statuses: Array<string | Error>, bytes: Uint8Array, overrides: Partial<PollDeps> = {}) {
  const fal = fakeFal(statuses);
  const log: Array<string> = [];
  let polls = 0;
  const deps: PollDeps = {
    client: fal.client,
    statusUrl: "https://queue.fal.run/fal-ai/topaz/requests/req-1/status",
    responseUrl: "https://queue.fal.run/fal-ai/topaz/requests/req-1",
    submittedAt: 0,
    now: () => 30_000,
    notePoll: async () => ++polls,
    download: async () => bytes,
    carriesAlpha: pngCarriesAlpha,
    accept: async (_bytes, latencyMs) => {
      log.push(`accept ${latencyMs}`);
    },
    fail: async (error) => {
      log.push(`fail ${error}`);
    },
    scheduleNext: async (delayMs) => {
      log.push(`next ${delayMs}`);
    },
    ...overrides,
  };
  return { deps, log, posts: fal.posts };
}

describe("upscale submission", () => {
  it("posts exactly once, records the request ID, then polls", async () => {
    const fal = fakeFal();
    const claimed = { value: false };
    const { deps, log } = submitDeps({ client: fal.client, claimed });
    expect(await submitUpscale(deps)).toBe("submitted");
    // The same attempt run again (a retried action) posts nothing.
    expect(await submitUpscale(deps)).toBe("skipped");
    expect(fal.posts).toHaveLength(1);
    expect(log).toEqual(["record req-1", `poll in ${pollDelay(1)}`]);
  });

  it("fails (and never retries) when the post fails", async () => {
    let posts = 0;
    const fetch: FetchLike = async () => {
      posts++;
      return json({ detail: "Too busy" }, 503);
    };
    const { deps, log } = submitDeps({ client: falClient({ key: "k", fetch }) });
    expect(await submitUpscale(deps)).toBe("failed");
    expect(posts).toBe(1);
    // fal may have the job after a 5xx, so its budget hold is paid for.
    expect(log).toEqual(["fail Too busy (settle)"]);
  });

  it("releases the budget hold when fal refuses the post outright", async () => {
    const fetch: FetchLike = async () => json({ detail: "Bad image" }, 422);
    const { deps, log } = submitDeps({ client: falClient({ key: "k", fetch }) });
    expect(await submitUpscale(deps)).toBe("failed");
    expect(log).toEqual(["fail Bad image (release)"]);
    expect(submitFailureSpend(new Error("socket hang up"))).toEqual({ kind: "settle", reason: "no answer" });
  });

  it("fails without a key or a public address, posting nothing", async () => {
    const noKey = submitDeps({ client: null });
    expect(await submitUpscale(noKey.deps)).toBe("failed");
    const fal = fakeFal();
    const noAddress = submitDeps({ client: fal.client, imageUrl: "fake:art.png" });
    expect(await submitUpscale(noAddress.deps)).toBe("failed");
    expect(fal.posts).toHaveLength(0);
    expect([...noKey.log, ...noAddress.log].every((line) => line.endsWith("(release)"))).toBe(true);
  });

  it("gives up rather than posting again when the request ID can't be saved", async () => {
    const fal = fakeFal();
    const { deps, log } = submitDeps({
      client: fal.client,
      record: async () => {
        throw new Error("Submission recorded twice.");
      },
    });
    expect(await submitUpscale(deps)).toBe("failed");
    expect(fal.posts).toHaveLength(1);
    expect(log).toEqual(["fail Submission recorded twice. (settle)"]);
  });
});

describe("background removal through the same flow", () => {
  it("speaks of background removal and the cutout in its messages", async () => {
    const { deps, log } = submitDeps({ kind: "cutout", client: null });
    expect(await submitUpscale(deps)).toBe("failed");
    expect(log).toEqual(["fail Background removal isn't set up yet. (release)"]);
    const poll = pollDeps(["COMPLETED"], await opaquePng(), { kind: "cutout" });
    expect(await pollUpscale(poll.deps)).toBe("failed");
    expect(poll.log).toEqual(["fail The cutout came back without transparency, so it can't be used."]);
  });
});

describe("upscale polling", () => {
  it("waits while fal works, backing off, and never posts", async () => {
    const { deps, log, posts } = pollDeps(["IN_QUEUE"], await transparentPng());
    expect(await pollUpscale(deps)).toBe("waiting");
    expect(log).toEqual([`next ${pollDelay(2)}`]);
    expect(posts).toHaveLength(0);
    expect(pollDelay(1)).toBeLessThan(pollDelay(3));
    expect(pollDelay(50)).toBe(20_000);
  });

  it("keeps a transparent result, with its latency", async () => {
    const { deps, log, posts } = pollDeps(["COMPLETED"], await transparentPng());
    expect(await pollUpscale(deps)).toBe("done");
    expect(log).toEqual(["accept 30000"]);
    expect(posts).toHaveLength(0);
  });

  it("refuses a result without transparency", async () => {
    const { deps, log } = pollDeps(["COMPLETED"], await opaquePng());
    expect(await pollUpscale(deps)).toBe("failed");
    expect(log[0]).toMatch(/without transparency/u);
  });

  it("fails a result whose pixels turn out solid when stored", async () => {
    const { deps, log } = pollDeps(["COMPLETED"], await transparentPng(), {
      accept: async () => {
        throw new Error("The upscale came back without transparency, so it can't be used.");
      },
    });
    expect(await pollUpscale(deps)).toBe("failed");
    expect(log).toHaveLength(1);
  });

  it("keeps reading through network errors, and stops when time runs out", async () => {
    const early = pollDeps([new Error("reset")], await transparentPng());
    expect(await pollUpscale(early.deps)).toBe("waiting");
    const late = pollDeps(["IN_PROGRESS"], await transparentPng(), { now: () => UPSCALE_TIMEOUT_MS + 1 });
    expect(await pollUpscale(late.deps)).toBe("failed");
    expect(late.log).toEqual(["fail The upscale took too long."]);
    expect(late.posts).toHaveLength(0);
  });
});
