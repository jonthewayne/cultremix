#!/usr/bin/env bun
// Makes judge accounts (KTD-15): email and password, creator access, 40 credits, a username.
//
//   bun run judges:provision -- judge1@example.com monad_judge_1 judge2@example.com monad_judge_2
//   bun run judges:provision -- --file judges.txt
//   bun run judges:provision -- --prod --file judges.txt
//   CONVEX_DEPLOY_KEY=<staging key> bun run judges:provision -- --file judges.txt
//
// Options:
//   --file <path>   one "email username" per line (# comments allowed)
//   --reset         give judges who already exist a new password
//   --prod          production (asks first; --yes skips the question)
//   --dry-run       show what would happen without calling Convex
//
// Running it again is safe: existing judges keep their password, credits, and creator number.
// New passwords go to .judges.local.json (gitignored, readable only by you), never the terminal.
import { chmod, readFile, writeFile } from "node:fs/promises";
import { confirmTarget, convexRun, targetFrom } from "./lib/convex-run";
import { parseJudgeSpecs } from "./lib/judge-list";

type Result = {
  email: string;
  username: string;
  creatorNumber?: number;
  credits: number;
  created: boolean;
  password?: string;
};

const OUTPUT = ".judges.local.json";
const argv = process.argv.slice(2);
const flags = new Set(["--prod", "--yes", "--reset", "--dry-run"]);
const fileIndex = argv.indexOf("--file");
const fileLines = fileIndex >= 0 ? (await readFile(argv[fileIndex + 1], "utf8")).split("\n") : [];
const argLines: Array<string> = [];
const positional = argv.filter((arg, index) => !flags.has(arg) && arg !== "--file" && index !== fileIndex + 1);
// Accept "email username" pairs as two arguments, or "email:username" as one.
let index = 0;
while (index < positional.length) {
  const arg = positional[index];
  if (arg.includes(":") || arg.includes(",")) {
    argLines.push(arg);
    index += 1;
  } else {
    argLines.push(`${arg} ${positional[index + 1] ?? ""}`);
    index += 2;
  }
}

const judges = parseJudgeSpecs([...fileLines, ...argLines]);
if (judges.length === 0) {
  console.log("No judges given. Pass `email username` pairs or --file judges.txt.");
  process.exit(1);
}

const target = targetFrom(argv);
const reset = argv.includes("--reset");
if (argv.includes("--dry-run")) {
  console.log(`Would make ${judges.length} judge account(s) on ${target.label}:`);
  for (const judge of judges) console.log(`  ${judge.email}  @${judge.username}`);
  process.exit(0);
}
confirmTarget(target, argv, `Making ${judges.length} judge account(s)`);

const saved: Record<string, unknown> = await readFile(OUTPUT, "utf8")
  .then((text) => JSON.parse(text) as Record<string, unknown>)
  .catch(() => ({}));
let failures = 0;
for (const judge of judges) {
  try {
    const result = await convexRun<Result>(target, "judges:provisionFromCli", {
      ...judge,
      ...(reset ? { resetPassword: true } : {}),
    });
    const number = result.creatorNumber !== undefined ? ` № ${result.creatorNumber}` : "";
    const passwordNote = result.password ? "new password saved" : "password unchanged";
    console.log(`✓ ${result.email}  @${result.username}${number}  ${result.credits} credits  (${passwordNote})`);
    if (result.password) {
      saved[`${target.prod ? "production" : "other"}:${result.email}`] = {
        email: result.email,
        username: result.username,
        password: result.password,
        environment: target.prod ? "production" : target.label,
        at: new Date().toISOString(),
      };
    }
  } catch (error) {
    failures += 1;
    console.log(`✗ ${judge.email}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await writeFile(OUTPUT, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT, 0o600);
console.log(`\nPasswords are in ${OUTPUT}. Send each judge theirs privately, then delete the file.`);
console.log("Judges sign in at /login with “Have a password? Sign in with it”.");
process.exit(failures > 0 ? 1 : 0);
