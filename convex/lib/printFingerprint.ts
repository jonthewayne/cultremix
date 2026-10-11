import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// INV-10 (Checkpoint 0 amendment A3): Printful receives bytes whose SHA-256 equals the fingerprint
// saved when the print file was made (shopProducts.printFile.sha256, or works.printSha256 for files
// from before products could be chosen). Before an order goes to Printful, each print file it names
// is read from the public address Printful will fetch and hashed a chunk at a time, so a print file
// (8 to 14 MB on dev, larger for busy art) never sits in memory whole. Pure JS, so it runs in
// Convex's default runtime and in the in-memory tests.

export type FileCheck = { url: string; sha256: string; label: string };

// changed: the bytes hash to something else. missing: the address answers 404 or 410. unreadable:
// it couldn't be read just now (network, 5xx, a broken stream), which is worth trying again.
export type FileProblem = { url: string; label: string; problem: "changed" | "missing" | "unreadable"; detail: string };

const READ_TIMEOUT_MS = 2 * 60 * 1000;

function message(error: unknown) {
  return error instanceof Error && error.message ? error.message.slice(0, 200) : String(error).slice(0, 200);
}

export async function streamSha256(body: ReadableStream<Uint8Array>): Promise<string> {
  const hash = sha256.create();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return bytesToHex(hash.digest());
}

async function readHash(url: string, fetchImpl: typeof fetch): Promise<{ sha256: string } | { status: number } | { error: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("Reading it took over two minutes.")), READ_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: abort.signal });
    if (!response.ok || !response.body) return { status: response.status };
    return { sha256: await streamSha256(response.body) };
  } catch (error) {
    return { error: message(error) };
  } finally {
    clearTimeout(timer);
  }
}

// Reads each distinct file once and returns what's wrong with any of them (an empty list means
// every file is the approved one).
export async function checkPrintFiles(files: Array<FileCheck>, fetchImpl: typeof fetch = fetch): Promise<Array<FileProblem>> {
  const problems: Array<FileProblem> = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    const read = await readHash(file.url, fetchImpl);
    const base = { url: file.url, label: file.label };
    if ("error" in read) problems.push({ ...base, problem: "unreadable", detail: read.error });
    else if ("status" in read) {
      const gone = read.status === 404 || read.status === 410;
      problems.push({ ...base, problem: gone ? "missing" : "unreadable", detail: "HTTP " + read.status });
    } else if (read.sha256 !== file.sha256.toLowerCase()) {
      problems.push({
        ...base,
        problem: "changed",
        detail: "its bytes hash to " + read.sha256.slice(0, 12) + "…, not the approved " + file.sha256.slice(0, 12) + "…",
      });
    }
  }
  return problems;
}

