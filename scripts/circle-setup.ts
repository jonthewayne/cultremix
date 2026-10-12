// Circle setup for member wallets, from an API key alone (the work is scripts/lib/circleSetup.ts).
// It finds which Circle host takes the key, registers a new entity secret (saved, with Circle's
// recovery file, next to the key before Circle ever sees it), creates the environment's wallet
// set, and with --apply puts the three values in that deployment's Convex env, piped in so they
// never appear on a command line.
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
import { chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CIRCLE_API_BASE } from "../convex/lib/circle";
import { confirmTarget } from "./lib/convex-run";
import { CircleSetupError, circleNames, runCircleSetup } from "./lib/circleSetup";

const DIR = join(homedir(), ".config", "cultremix");
const FILE = join(DIR, "circle.env");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
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

// A circle.env made by hand in an editor is readable by everyone; the keys in it shouldn't be.
if (existsSync(DIR)) chmodSync(DIR, 0o700);
if (existsSync(FILE)) chmodSync(FILE, 0o600);

let result;
try {
  result = await runCircleSetup({ env: envName, file: FILE, dir: DIR, log: (line) => console.log(line) });
} catch (error) {
  if (error instanceof CircleSetupError) fail(error.message);
  throw error;
}

const prod = envName === "prod";
const sandbox = result.base !== CIRCLE_API_BASE;
const names = circleNames(result.kind);
if (args.includes("--apply")) {
  confirmTarget({ prod, label: prod ? "production" : "your dev deployment (.env.local)" }, args, "Setting CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID");
  await convexEnvSet(prod, "CIRCLE_API_KEY", result.apiKey);
  await convexEnvSet(prod, "CIRCLE_ENTITY_SECRET", result.secret);
  await convexEnvSet(prod, "CIRCLE_WALLET_SET_ID", result.walletSetId);
  if (sandbox) await convexEnvSet(prod, "CIRCLE_API_BASE", result.base);
  console.log("Done. Members get wallets within five minutes: the wallet check runs every five.");
} else {
  const flag = prod ? " --prod" : "";
  console.log(`\nTo set them (values piped in, never printed):\n  f=${FILE}\n  v(){ grep -E "^$1=" "$f" | head -1 | cut -d= -f2- | tr -d '\\n'; }`);
  console.log(`  v ${names.apiKey} | bunx convex env set${flag} CIRCLE_API_KEY`);
  console.log(`  v ${names.secret} | bunx convex env set${flag} CIRCLE_ENTITY_SECRET`);
  console.log(`  v ${names.walletSet} | bunx convex env set${flag} CIRCLE_WALLET_SET_ID`);
  if (sandbox) console.log(`  v ${names.base} | bunx convex env set${flag} CIRCLE_API_BASE`);
  console.log("Or run this again with --apply.");
}
console.log(`\nCommit the wallet set in shared/config/chains.ts: CHAIN_ENVIRONMENTS.${envName}.circleWalletSetId = "${result.walletSetId}".`);
console.log(`Back up ${FILE} and the recovery file in the password manager. Circle can't recover the entity secret.`);
