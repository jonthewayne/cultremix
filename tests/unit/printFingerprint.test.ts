import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkPrintFiles, streamSha256 } from "../../convex/lib/printFingerprint";

// INV-10's check (convex/lib/printFingerprint.ts): a print file's bytes, read the way Printful will
// read them, against the fingerprint saved when it was made.

const bytes = new Uint8Array(300_000).map((_, i) => (i * 31) % 251);
const sha = createHash("sha256").update(bytes).digest("hex");

// A body that arrives in uneven chunks, as a large file does.
function chunked(data: Uint8Array, size = 65_536 + 7) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < data.length; at += size) controller.enqueue(data.slice(at, at + size));
      controller.close();
    },
  });
}

describe("checking print files against their fingerprints", () => {
  it("hashes a file read in chunks to the fingerprint of the whole file", async () => {
    expect(await streamSha256(chunked(bytes))).toBe(sha);
  });

  it("passes the approved file, reading each address once", async () => {
    const reads: Array<string> = [];
    const fetchFake = (async (url: RequestInfo | URL) => {
      reads.push(String(url));
      return new Response(chunked(bytes));
    }) as typeof fetch;
    const file = { url: "https://files.test/print.png", sha256: sha, label: "CR 101-001" };
    expect(await checkPrintFiles([file, file], fetchFake)).toEqual([]);
    expect(reads).toEqual(["https://files.test/print.png"]);
  });

  it("tells a changed file from a missing one and from one that can't be read just now", async () => {
    const answers: Record<string, () => Response> = {
      "https://files.test/changed.png": () => new Response(new Uint8Array([1, 2, 3])),
      "https://files.test/gone.png": () => new Response("Not found", { status: 404 }),
      "https://files.test/busy.png": () => new Response("busy", { status: 503 }),
    };
    const fetchFake = (async (url: RequestInfo | URL) => {
      const answer = answers[String(url)];
      if (!answer) throw new TypeError("connection reset");
      return answer();
    }) as typeof fetch;
    const names = ["changed", "gone", "busy", "down"];
    const problems = await checkPrintFiles(
      names.map((name) => ({ url: "https://files.test/" + name + ".png", sha256: sha, label: name })),
      fetchFake,
    );
    expect(problems.map((problem) => [problem.label, problem.problem, problem.detail.slice(0, 22)])).toEqual([
      ["changed", "changed", "its bytes hash to " + createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex").slice(0, 4)],
      ["gone", "missing", "HTTP 404"],
      ["busy", "unreadable", "HTTP 503"],
      ["down", "unreadable", "connection reset"],
    ]);
    expect(problems[0].detail).toContain("not the approved " + sha.slice(0, 12));
  });
});

