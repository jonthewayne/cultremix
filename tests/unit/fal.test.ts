import { describe, expect, it } from "vitest";
import { BIREFNET_V2, CUTOUT_INPUT, FAL_QUEUE, TOPAZ_TRANSPARENT, falClient, isQueueUrl } from "../../convex/lib/fal";
import type { FetchLike } from "../../convex/lib/fal";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

// A fake fetch that answers from a list and records every call.
function fakeFetch(answers: Array<Response | Error>) {
  const calls: Array<Call> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const next = answers.shift();
    if (!next) throw new Error("No more answers.");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SUBMITTED = {
  request_id: "req-123",
  status_url: "https://queue.fal.run/fal-ai/topaz/requests/req-123/status",
  response_url: "https://queue.fal.run/fal-ai/topaz/requests/req-123",
};

describe("fal queue client", () => {
  it("submits once with the key and the image URL, keeping fal's own URLs", async () => {
    const { fetch, calls } = fakeFetch([json(SUBMITTED, 202)]);
    const client = falClient({ key: "test-key", fetch });
    const submission = await client.submit("https://images.example/design.png");
    expect(submission).toEqual({ requestId: "req-123", statusUrl: SUBMITTED.status_url, responseUrl: SUBMITTED.response_url });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FAL_QUEUE}/${TOPAZ_TRANSPARENT}`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Key test-key");
    expect(JSON.parse(calls[0].body!)).toEqual({ image_url: "https://images.example/design.png" });
  });

  it("sends an endpoint's own settings with the image (BiRefNet for Remove background)", async () => {
    const { fetch, calls } = fakeFetch([json(SUBMITTED, 202)]);
    const client = falClient({ key: "k", fetch, endpoint: BIREFNET_V2, input: CUTOUT_INPUT });
    await client.submit("https://images.example/design.png");
    expect(calls[0].url).toBe(`${FAL_QUEUE}/fal-ai/birefnet/v2`);
    expect(JSON.parse(calls[0].body!)).toEqual({
      model: "General Use (Dynamic)",
      operating_resolution: "2048x2048",
      output_format: "png",
      refine_foreground: true,
      image_url: "https://images.example/design.png",
    });
  });

  it("never retries a failed submit", async () => {
    const { fetch, calls } = fakeFetch([json({ detail: "busy" }, 503), json(SUBMITTED, 202)]);
    const client = falClient({ key: "k", fetch, retryDelayMs: 0 });
    await expect(client.submit("https://x/y.png")).rejects.toThrow("busy");
    expect(calls).toHaveLength(1);
  });

  it("never retries a submit that threw on the network", async () => {
    const { fetch, calls } = fakeFetch([new Error("socket hang up"), json(SUBMITTED, 202)]);
    const client = falClient({ key: "k", fetch, retryDelayMs: 0 });
    await expect(client.submit("https://x/y.png")).rejects.toThrow("socket hang up");
    expect(calls).toHaveLength(1);
  });

  it("falls back to the app's queue URLs when fal's are missing or elsewhere", async () => {
    const { fetch } = fakeFetch([json({ request_id: "abc", status_url: "https://evil.example/steal" }, 202)]);
    const submission = await falClient({ key: "k", fetch }).submit("https://x/y.png");
    expect(submission.statusUrl).toBe("https://queue.fal.run/fal-ai/topaz/requests/abc/status");
    expect(submission.responseUrl).toBe("https://queue.fal.run/fal-ai/topaz/requests/abc");
  });

  it("reads status with GETs, retrying network errors and 5xx", async () => {
    const { fetch, calls } = fakeFetch([
      new Error("reset"),
      json({}, 502),
      json({ status: "IN_PROGRESS" }),
    ]);
    const client = falClient({ key: "k", fetch, retryDelayMs: 0 });
    expect(await client.status(SUBMITTED.status_url)).toEqual({ status: "IN_PROGRESS", position: undefined });
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "GET"]);
    expect(calls.every((c) => c.headers.Authorization === "Key k")).toBe(true);
  });

  it("reports a failed request", async () => {
    const { fetch } = fakeFetch([json({ status: "COMPLETED", error: "Image too large" })]);
    expect(await falClient({ key: "k", fetch }).status(SUBMITTED.status_url)).toEqual({ status: "FAILED", error: "Image too large" });
  });

  it("reads the result image", async () => {
    const { fetch } = fakeFetch([
      json({ image: { url: "https://v3.fal.media/files/out.png", content_type: "image/png", file_size: 1234 } }),
    ]);
    expect(await falClient({ key: "k", fetch }).result(SUBMITTED.response_url)).toEqual({
      url: "https://v3.fal.media/files/out.png",
      contentType: "image/png",
      fileSize: 1234,
    });
  });

  it("refuses to send the key anywhere but fal's queue", async () => {
    const { fetch, calls } = fakeFetch([json({ status: "COMPLETED" })]);
    const client = falClient({ key: "k", fetch });
    await expect(client.status("https://evil.example/status")).rejects.toThrow("outside");
    await expect(client.result("http://queue.fal.run/x")).rejects.toThrow("outside");
    expect(calls).toHaveLength(0);
    expect(isQueueUrl("https://queue.fal.run/a")).toBe(true);
    expect(isQueueUrl("https://queue.fal.run.evil.example/a")).toBe(false);
  });
});
