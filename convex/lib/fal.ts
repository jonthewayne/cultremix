// A small client for fal's queue API, used for "Upscale for print" (Topaz Transparent, 4x) and
// "Remove background" (BiRefNet v2). The
// fetch it uses can be replaced, so tests never reach the network.
//
//   POST https://queue.fal.run/<endpoint>            { image_url } -> { request_id, status_url, response_url }
//   GET  <status_url>                                -> { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
//   GET  <response_url>                              -> { image: { url, content_type, file_size } }
//
// Submitting is one POST with no retries: a retried POST could start (and bill) a second job. The
// GETs only read, so they may be retried. The key goes only to queue.fal.run.

export const TOPAZ_TRANSPARENT = "fal-ai/topaz/upscale/image/transparent";
// "Remove background" in the Print Studio: BiRefNet v2, which cuts the art out as it is (a PNG with
// transparency) instead of drawing it again. Its dynamic general model: on graphic T-shirt art (a
// spray-paint raccoon over paper, navy, and white, October 11) it kept the black ink, splatter, and
// drips whole with no fringe on dark or light cloth, while the heavy model dropped every black area
// and Bria and rembg left a beige fringe of the old background.
export const BIREFNET_V2 = "fal-ai/birefnet/v2";
export const CUTOUT_INPUT = {
  model: "General Use (Dynamic)",
  operating_resolution: "2048x2048",
  output_format: "png",
  refine_foreground: true,
} as const;
export const FAL_QUEUE = "https://queue.fal.run";
const QUEUE_HOST = "queue.fal.run";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Submission = { requestId: string; statusUrl: string; responseUrl: string };
export type QueueStatus =
  | { status: "IN_QUEUE" | "IN_PROGRESS"; position?: number }
  | { status: "COMPLETED"; error?: string }
  | { status: "FAILED"; error: string };
export type FalImage = { url: string; contentType?: string; fileSize?: number };

export class FalError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "FalError";
  }
}

// The app part of an endpoint ("fal-ai/topaz"): queue status and result URLs use it, not the
// full path, so the URLs fal returns are kept and these are only a fallback.
function appId(endpoint: string) {
  return endpoint.split("/").slice(0, 2).join("/");
}

// A URL from a fal response that the key may be sent to: https on queue.fal.run only.
export function isQueueUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === QUEUE_HOST;
  } catch {
    return false;
  }
}

async function detail(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const message = body.detail ?? body.error;
    if (typeof message === "string") return message.slice(0, 200);
    if (message) return JSON.stringify(message).slice(0, 200);
  } catch {
    // Not JSON.
  }
  return text.slice(0, 200) || `HTTP ${response.status}`;
}

// input: the endpoint's own settings, sent with the image (BiRefNet's model and resolution).
export function falClient(options: {
  key: string;
  fetch?: FetchLike;
  endpoint?: string;
  input?: Record<string, unknown>;
  retries?: number;
  retryDelayMs?: number;
}) {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = options.endpoint ?? TOPAZ_TRANSPARENT;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const auth = { Authorization: `Key ${options.key}` };

  // A GET to the queue, tried again after network errors and 5xx answers.
  async function read(url: string) {
    if (!isQueueUrl(url)) throw new FalError("Refusing to send the key outside fal's queue.");
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      try {
        const response = await doFetch(url, { method: "GET", headers: auth });
        if (response.status >= 500) {
          last = new FalError(await detail(response), response.status);
          continue;
        }
        return response;
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new FalError("fal couldn't be reached.");
  }

  return {
    // One POST. Never retried.
    async submit(imageUrl: string): Promise<Submission> {
      const response = await doFetch(`${FAL_QUEUE}/${endpoint}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ ...options.input, image_url: imageUrl }),
      });
      if (!response.ok) throw new FalError(await detail(response), response.status);
      const body = (await response.json()) as { request_id?: unknown; status_url?: unknown; response_url?: unknown };
      if (typeof body.request_id !== "string" || !body.request_id) throw new FalError("fal didn't return a request ID.");
      const requestId = body.request_id;
      const base = `${FAL_QUEUE}/${appId(endpoint)}/requests/${encodeURIComponent(requestId)}`;
      return {
        requestId,
        statusUrl: isQueueUrl(body.status_url) ? body.status_url : `${base}/status`,
        responseUrl: isQueueUrl(body.response_url) ? body.response_url : base,
      };
    },

    async status(statusUrl: string): Promise<QueueStatus> {
      const response = await read(statusUrl);
      if (!response.ok) throw new FalError(await detail(response), response.status);
      const body = (await response.json()) as { status?: unknown; queue_position?: unknown; error?: unknown };
      if (typeof body.error === "string" && body.error) return { status: "FAILED", error: body.error.slice(0, 200) };
      if (body.status === "IN_QUEUE" || body.status === "IN_PROGRESS") {
        return { status: body.status, position: typeof body.queue_position === "number" ? body.queue_position : undefined };
      }
      if (body.status === "COMPLETED") return { status: "COMPLETED" };
      return { status: "FAILED", error: `Unknown status ${String(body.status).slice(0, 40)}` };
    },

    async result(responseUrl: string): Promise<FalImage> {
      const response = await read(responseUrl);
      if (!response.ok) throw new FalError(await detail(response), response.status);
      const body = (await response.json()) as { image?: { url?: unknown; content_type?: unknown; file_size?: unknown } };
      const url = body.image?.url;
      if (typeof url !== "string" || !/^https:\/\//u.test(url)) throw new FalError("fal returned no image.");
      return {
        url,
        contentType: typeof body.image?.content_type === "string" ? body.image.content_type : undefined,
        fileSize: typeof body.image?.file_size === "number" ? body.image.file_size : undefined,
      };
    },
  };
}

export type FalClient = ReturnType<typeof falClient>;
