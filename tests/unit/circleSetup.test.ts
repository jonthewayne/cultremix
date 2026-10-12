import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CircleSetupError, runCircleSetup } from "../../scripts/lib/circleSetup";
import { readEnvFile } from "../../scripts/lib/envFile";
import type { FetchLike } from "../../convex/lib/circle";

// bun run circle:setup's work (scripts/lib/circleSetup.ts) against a fake Circle. Registering an
// entity secret is close to one-shot per Circle key environment, so the order matters: the secret
// is on disk before Circle sees it, and nothing is registered twice.

const MAIN = "https://api.circle.com";
const SANDBOX = "https://api-sandbox.circle.com";
const TEST_KEY = "TEST_API_KEY:key-id:key-secret";
const SECRET = "ab".repeat(32);
const REQUEST = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const NOW = new Date("2026-10-12T07:00:00Z");

async function publicKeyPem() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----\n`;
}

type Call = { host: string; path: string; body: Record<string, unknown> | null };

// Which hosts take the key, and how registration and wallet sets answer (by default: fine).
function fakeCircle(pem: string, opts: { hosts: Array<string>; register?: () => Response; walletSet?: () => Response }) {
  const calls: Array<Call> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ host: url.origin, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (!opts.hosts.includes(url.origin)) return Response.json({ code: 401, message: "Invalid credentials." }, { status: 401 });
    if (url.pathname === "/v1/w3s/config/entity/publicKey") return Response.json({ data: { publicKey: pem } });
    if (url.pathname === "/v1/w3s/config/entity/entitySecret") {
      return opts.register ? opts.register() : Response.json({ data: { recoveryFile: "RECOVERY" } });
    }
    if (url.pathname === "/v1/w3s/developer/walletSets") {
      return opts.walletSet ? opts.walletSet() : Response.json({ data: { walletSet: { id: "set-1" } } }, { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, fetchImpl };
}

function folder(lines: Array<string>) {
  const dir = mkdtempSync(join(tmpdir(), "cr-circle-setup-"));
  const file = join(dir, "circle.env");
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  return { dir, file };
}

const fixed = { randomHex: () => SECRET, uuid: () => REQUEST, now: () => NOW };

describe("bun run circle:setup", () => {
  it("registers a new secret saved before Circle sees it, then makes the wallet set, at the host that takes the key", async () => {
    const pem = await publicKeyPem();
    const { dir, file } = folder(["# keys", `CIRCLE_API_KEY_TEST=${TEST_KEY}`]);
    let onDiskAtRegister: string | undefined;
    const { calls, fetchImpl } = fakeCircle(pem, {
      hosts: [SANDBOX],
      register: () => {
        onDiskAtRegister = readEnvFile(file).get("CIRCLE_ENTITY_SECRET_TEST");
        return Response.json({ data: { recoveryFile: "RECOVERY" } });
      },
    });
    const result = await runCircleSetup({ env: "dev", file, dir, fetch: fetchImpl, ...fixed });

    expect(result).toMatchObject({ kind: "TEST", base: SANDBOX, walletSetId: "set-1", secret: SECRET });
    expect(onDiskAtRegister).toBe(SECRET);
    // api.circle.com was tried first and refused the key.
    expect(calls[0]).toMatchObject({ host: MAIN, path: "/v1/w3s/config/entity/publicKey" });
    const set = calls.find((call) => call.path === "/v1/w3s/developer/walletSets");
    expect(set?.body).toMatchObject({ idempotencyKey: REQUEST, name: "CultRemix dev" });
    const values = readEnvFile(file);
    expect(values.get("CIRCLE_API_BASE_TEST")).toBe(SANDBOX);
    expect(values.get("CIRCLE_WALLET_SET_REQUEST_TEST")).toBe(REQUEST);
    expect(values.get("CIRCLE_WALLET_SET_ID_TEST")).toBe("set-1");
    expect(values.get("CIRCLE_ENTITY_SECRET_TEST_REGISTERED_AT")).toBe(NOW.toISOString());
    expect(readFileSync(result.recoveryFile!, "utf8")).toBe("RECOVERY");
    expect(statSync(result.recoveryFile!).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8").startsWith("# keys\n")).toBe(true);
  });

  it("reuses everything on a rerun, without calling Circle", async () => {
    const pem = await publicKeyPem();
    const { dir, file } = folder([`CIRCLE_API_KEY_TEST=${TEST_KEY}`]);
    const first = fakeCircle(pem, { hosts: [MAIN] });
    await runCircleSetup({ env: "dev", file, dir, fetch: first.fetchImpl, ...fixed });
    const again = fakeCircle(pem, { hosts: [MAIN] });
    const result = await runCircleSetup({ env: "dev", file, dir, fetch: again.fetchImpl, ...fixed, randomHex: () => "cd".repeat(32) });
    expect(again.calls).toEqual([]);
    expect(result).toMatchObject({ base: MAIN, secret: SECRET, walletSetId: "set-1" });
  });

  it("forgets a new secret Circle won't register, so the next run starts clean", async () => {
    const pem = await publicKeyPem();
    const { dir, file } = folder([`CIRCLE_API_KEY_TEST=${TEST_KEY}`]);
    const { calls, fetchImpl } = fakeCircle(pem, {
      hosts: [MAIN],
      register: () => Response.json({ code: 156016, message: "Entity secret has already been registered." }, { status: 409 }),
    });
    const error = await runCircleSetup({ env: "dev", file, dir, fetch: fetchImpl, ...fixed }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CircleSetupError);
    expect((error as Error).message).toMatch(/already has one/u);
    expect((error as Error).message).not.toContain(SECRET);
    expect(readEnvFile(file).get("CIRCLE_ENTITY_SECRET_TEST")).toBeUndefined();
    expect(calls.some((call) => call.path === "/v1/w3s/developer/walletSets")).toBe(false);
  });

  it("checks a saved secret without its registration mark by making the wallet set", async () => {
    const pem = await publicKeyPem();
    const saved = "cd".repeat(32);
    const lines = [`CIRCLE_API_KEY_TEST=${TEST_KEY}`, `CIRCLE_ENTITY_SECRET_TEST=${saved}`];
    const refuse = () => Response.json({ code: 156016, message: "Entity secret has already been registered." }, { status: 409 });

    const ok = folder(lines);
    const known = fakeCircle(pem, { hosts: [MAIN], register: refuse });
    const result = await runCircleSetup({ env: "dev", file: ok.file, dir: ok.dir, fetch: known.fetchImpl, ...fixed });
    expect(result).toMatchObject({ secret: saved, walletSetId: "set-1" });
    expect(readEnvFile(ok.file).get("CIRCLE_ENTITY_SECRET_TEST_REGISTERED_AT")).toMatch(/^confirmed by the wallet set/u);

    const wrong = folder(lines);
    const unknown = fakeCircle(pem, {
      hosts: [MAIN],
      register: refuse,
      walletSet: () => Response.json({ code: 156013, message: "Invalid entity secret ciphertext." }, { status: 400 }),
    });
    const error = await runCircleSetup({ env: "dev", file: wrong.file, dir: wrong.dir, fetch: unknown.fetchImpl, ...fixed }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/may not be the entity secret Circle has/u);
    // The saved secret stays: it may be the one Circle has, and only its owner can tell.
    expect(readEnvFile(wrong.file).get("CIRCLE_ENTITY_SECRET_TEST")).toBe(saved);
  });

  it("asks for the right kind of key, and tries only api.circle.com with a live one", async () => {
    const pem = await publicKeyPem();
    const none = folder(["# nothing yet"]);
    await expect(runCircleSetup({ env: "dev", file: none.file, dir: none.dir, ...fixed })).rejects.toThrow(/Put a Circle test API key/u);
    const live = folder(["CIRCLE_API_KEY_TEST=LIVE_API_KEY:a:b"]);
    await expect(runCircleSetup({ env: "dev", file: live.file, dir: live.dir, ...fixed })).rejects.toThrow(/isn't a test key/u);

    const prod = folder(["CIRCLE_API_KEY_LIVE=LIVE_API_KEY:a:b"]);
    const sandboxOnly = fakeCircle(pem, { hosts: [SANDBOX] });
    await expect(runCircleSetup({ env: "prod", file: prod.file, dir: prod.dir, fetch: sandboxOnly.fetchImpl, ...fixed })).rejects.toThrow(
      /didn't accept CIRCLE_API_KEY_LIVE/u,
    );
    expect(sandboxOnly.calls.map((call) => call.host)).toEqual([MAIN]);
  });
});
