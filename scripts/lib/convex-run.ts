// Runs one Convex function with `bunx convex run` for the launch scripts.
//
// Which deployment: `--prod` targets production. Without it the Convex CLI picks as usual:
// `CONVEX_DEPLOY_KEY` when set for that command (how staging is reached), otherwise the dev
// deployment in `.env.local`. Nothing here reads or prints a key.

export type Target = { prod: boolean; label: string };

export function targetFrom(argv: Array<string>): Target {
  const prod = argv.includes("--prod");
  const label = prod
    ? "production"
    : process.env.CONVEX_DEPLOY_KEY
      ? "the deployment for CONVEX_DEPLOY_KEY (staging, if that's the key you set)"
      : "your dev deployment (.env.local)";
  return { prod, label };
}

// Asks before touching production unless --yes was passed.
export function confirmTarget(target: Target, argv: Array<string>, action: string) {
  console.log(`${action} on ${target.label}.`);
  if (!target.prod || argv.includes("--yes")) return;
  const answer = prompt("Type 'production' to go ahead:");
  if (answer?.trim() !== "production") {
    console.log("Stopped. Nothing changed.");
    process.exit(1);
  }
}

// identity runs a public function as that member (convex run --identity), for scripts that act on
// someone's behalf; only the deployment's admins can do that.
export async function convexRun<T>(
  target: Target,
  fn: string,
  args: Record<string, unknown>,
  options: { identity?: { subject: string; issuer: string } } = {},
): Promise<T> {
  const command = [
    "bunx",
    "convex",
    "run",
    ...(target.prod ? ["--prod"] : []),
    ...(options.identity ? ["--identity", JSON.stringify(options.identity)] : []),
    fn,
    JSON.stringify(args),
  ];
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env: process.env });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${fn} failed:\n${lastErrorLines(stderr || stdout)}`);
  }
  return parseRunOutput<T>(stdout);
}

// `convex run` prints the function's return value as JSON, sometimes after log lines, and
// nothing at all for a function that returns null.
export function parseRunOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (trimmed === "") return null as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Log lines first; look for where the result starts.
  }
  // Log lines can start with "[" too, so try each line that could begin the JSON.
  for (const match of stdout.matchAll(/^[[{]/gmu)) {
    try {
      return JSON.parse(stdout.slice(match.index)) as T;
    } catch {
      // Not the result; keep looking.
    }
  }
  // A plain value (a string, a number, null) after log lines.
  const last = trimmed.split("\n").pop() ?? "";
  try {
    return JSON.parse(last) as T;
  } catch {
    // Not one either.
  }
  throw new Error(`Couldn't read the result:\n${stdout}`);
}

function lastErrorLines(text: string) {
  return text.trim().split("\n").slice(-12).join("\n");
}
