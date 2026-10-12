// Circle setup for member wallets, from an API key alone. It finds which Circle host takes the
// key, registers a new entity secret (saved, with Circle's recovery file, next to the key before
// Circle ever sees it), creates the environment's wallet set, and with --apply puts the three
// values in that deployment's Convex env, piped in so they never appear on a command line.
//
//   bun run circle:setup --env dev             registers and creates; prints what to set
//   bun run circle:setup --env dev --apply     also sets dev's Convex env
//   bun run circle:setup --env prod --apply    production (asks you to type "production")
//
// The keys live in ~/.config/cultremix/circle.env: CIRCLE_API_KEY_TEST for dev and
// CIRCLE_API_KEY_LIVE for production (Circle's console, Keys). The script adds
// CIRCLE_ENTITY_SECRET_<TEST|LIVE> and CIRCLE_WALLET_SET_ID_<TEST|LIVE> there, and writes each
// recovery file beside it. Back up both: Circle can't recover the entity secret, and it controls
// every member wallet. Running it again reuses what's saved, so it's safe to rerun.
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CIRCLE_API_BASE, CIRCLE_API_HOSTS, CircleError, circleClient } from "../convex/lib/circle";
import { CHAIN_ENVIRONMENTS } from "../shared/config/chains";
import { confirmTarget } from "./lib/convex-run";
import { readEnvFile, updateEnvFile } from "./lib/envFile";

const DIR = join(homedir(), ".config", "cultremix");
const FILE = join(DIR, "circle.env");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function describe(error: unknown) {
  if (error instanceof CircleError) return error.message;
  return error instanceof Error ? error.name : "unknown error";
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
}

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Sets one variable on the deployment with the value on stdin (convex env set NAME < value).
async function convexEnvSet(prod: boolean, name: string, value: string) {
  const proc = Bun.spawn(["bunx", "convex", "env", "set", ...(prod ? ["--prod"] : []), name], {
    stdin: new Blob([value]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  // The CLI's messages name the variable, never its value; print only the last line on failure.
  if (code !== 0) fail(`Setting ${name} failed: ${stderr.trim().split("\n").at(-1) ?? "no detail"}`);
  console.log(`  set ${name}`);
}

const args = process.argv.slice(2);
const envAt = args.indexOf("--env");
const envName = envAt >= 0 ? args[envAt + 1] : undefined;
if (envName !== "dev" && envName !== "prod") fail("Use --env dev or --env prod.");
const kind = CHAIN_ENVIRONMENTS[envName].circleKeyEnvironment;
const label = kind === "TEST" ? "test" : "live";
const names = {
  apiKey: `CIRCLE_API_KEY_${kind}`,
  secret: `CIRCLE_ENTITY_SECRET_${kind}`,
  registered: `CIRCLE_ENTITY_SECRET_${kind}_REGISTERED_AT`,
  recovery: `CIRCLE_RECOVERY_FILE_${kind}`,
  request: `CIRCLE_WALLET_SET_REQUEST_${kind}`,
  walletSet: `CIRCLE_WALLET_SET_ID_${kind}`,
  base: `CIRCLE_API_BASE_${kind}`,
};

// A circle.env made by hand in an editor is readable by everyone; the keys in it shouldn't be.
if (existsSync(DIR)) chmodSync(DIR, 0o700);
if (existsSync(FILE)) chmodSync(FILE, 0o600);
let values = readEnvFile(FILE);
const apiKey = values.get(names.apiKey)?.trim();
if (!apiKey) {
  fail(`Put a Circle ${label} API key in ${FILE} as ${names.apiKey}=... (Circle's console, Keys), then run this again.`);
}
if (!apiKey.startsWith(`${kind}_API_KEY:`)) {
  fail(`${names.apiKey} isn't a ${label} key: Circle's ${label} keys start with ${kind}_API_KEY:.`);
}

// 1. The host that takes the key.
let base = values.get(names.base)?.trim() ?? null;
if (!base) {
  for (const host of kind === "LIVE" ? [CIRCLE_API_BASE] : CIRCLE_API_HOSTS) {
    try {
      await circleClient({ apiKey, entitySecret: "00".repeat(32), baseUrl: host }).checkKey();
      base = host;
      break;
    } catch (error) {
      console.log(`${host} didn't take the key: ${describe(error)}`);
    }
  }
  if (!base) fail(`Circle didn't accept ${names.apiKey}. Check it in Circle's console (Keys) and run this again.`);
  updateEnvFile(FILE, { [names.base]: base });
}
console.log(`Circle takes the ${label} key at ${base}.`);

// 2. The entity secret: saved before Circle sees it, so a run that stops partway can't lose it.
values = readEnvFile(FILE);
let secret = values.get(names.secret)?.trim();
let registered = Boolean(values.get(names.registered)?.trim());
const fresh = !secret;
if (!secret) {
  secret = randomHex(32);
  updateEnvFile(FILE, { [names.secret]: secret });
}
const client = circleClient({ apiKey, entitySecret: secret, baseUrl: base });
if (!registered) {
  try {
    const { recoveryFile } = await client.registerEntitySecret();
    const path = join(DIR, `circle-recovery-${label}-${stamp()}.dat`);
    writeFileSync(path, recoveryFile, { mode: 0o600 });
    updateEnvFile(FILE, { [names.registered]: new Date().toISOString(), [names.recovery]: path });
    registered = true;
    console.log(`Registered a new entity secret. Its recovery file is ${path}.`);
  } catch (error) {
    if (fresh) {
      updateEnvFile(FILE, { [names.secret]: null });
      fail(
        `Circle didn't register the entity secret: ${describe(error)}. If this account already has one (made in Circle's console or an earlier run), put it in ${FILE} as ${names.secret} and run this again, or reset it in Circle's console with its recovery file.`,
      );
    }
    // A secret saved by an interrupted run, or put in the file by hand: the wallet set below
    // shows whether Circle knows it.
    console.log(`Circle didn't register the saved entity secret (${describe(error)}); checking it by making the wallet set.`);
  }
} else {
  console.log("Using the entity secret already registered.");
}

// 3. The wallet set, with a request key saved first so a rerun gets the same set back.
values = readEnvFile(FILE);
let walletSetId = values.get(names.walletSet)?.trim();
if (!walletSetId) {
  let requestKey = values.get(names.request)?.trim();
  if (!requestKey) {
    requestKey = crypto.randomUUID();
    updateEnvFile(FILE, { [names.request]: requestKey });
  }
  try {
    walletSetId = (await client.createWalletSet({ idempotencyKey: requestKey, name: `CultRemix ${envName}` })).walletSetId;
  } catch (error) {
    fail(
      `Circle didn't make the wallet set: ${describe(error)}.${registered ? "" : ` The saved ${names.secret} may not be the entity secret Circle has.`}`,
    );
  }
  updateEnvFile(FILE, {
    [names.walletSet]: walletSetId,
    ...(registered ? {} : { [names.registered]: `confirmed by the wallet set, ${new Date().toISOString()}` }),
  });
}
console.log(`Wallet set for ${envName}: ${walletSetId}`);

// 4. The deployment's env.
const prod = envName === "prod";
const sandbox = base !== CIRCLE_API_BASE;
if (args.includes("--apply")) {
  confirmTarget({ prod, label: prod ? "production" : "your dev deployment (.env.local)" }, args, "Setting CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID");
  await convexEnvSet(prod, "CIRCLE_API_KEY", apiKey);
  await convexEnvSet(prod, "CIRCLE_ENTITY_SECRET", secret);
  await convexEnvSet(prod, "CIRCLE_WALLET_SET_ID", walletSetId);
  if (sandbox) await convexEnvSet(prod, "CIRCLE_API_BASE", base);
  console.log("Done. Members get wallets within five minutes: the wallet check runs every five.");
} else {
  const flag = prod ? " --prod" : "";
  console.log(`\nTo set them (values piped in, never printed):\n  f=${FILE}\n  v(){ grep -E "^$1=" "$f" | head -1 | cut -d= -f2- | tr -d '\\n'; }`);
  console.log(`  v ${names.apiKey} | bunx convex env set${flag} CIRCLE_API_KEY`);
  console.log(`  v ${names.secret} | bunx convex env set${flag} CIRCLE_ENTITY_SECRET`);
  console.log(`  v ${names.walletSet} | bunx convex env set${flag} CIRCLE_WALLET_SET_ID`);
  if (sandbox) console.log(`  v ${names.base} | bunx convex env set${flag} CIRCLE_API_BASE`);
  console.log(`Or run this again with --apply.`);
}
console.log(`\nCommit the wallet set in shared/config/chains.ts: CHAIN_ENVIRONMENTS.${envName}.circleWalletSetId = "${walletSetId}".`);
console.log(`Back up ${FILE} and the recovery file in the password manager. Circle can't recover the entity secret.`);
