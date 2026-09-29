import { existsSync } from "node:fs";
import {
  convexEnvKeys,
  deploymentEnvKeys,
  githubSecretKeys,
  githubVariableKeys,
  isLocalhostUrl,
  isMissing,
  localEnvKeys,
  parseEnvFile,
} from "./lib/config";
import type {EnvFile} from "./lib/config";

const root = new URL("..", import.meta.url);
const deploymentMode = process.argv.includes("--deployment");
const externalMode = process.argv.includes("--external") || deploymentMode;

let warnings = 0;

async function main() {
  let failed = false;
  const localEnv = await readEnv(".env.local");
  const devEnv = await readEnv(".env.development");
  const prodEnv = await readEnv(".env.production");

  section("Local files");
  for (const path of requiredFiles()) {
    failed = report(existsSync(new URL(path, root)), `${path} exists`) || failed;
  }

  section(".env.local");
  for (const key of localEnvKeys) {
    failed = report(!isMissing(localEnv[key]), `${key} is set`) || failed;
  }
  checkLocalAuthShape(localEnv);

  section("Vite build-time env");
  for (const [file, env] of viteEnvFiles(devEnv, prodEnv)) {
    failed = report(!isMissing(env.VITE_CONVEX_URL), `${file} VITE_CONVEX_URL`) || failed;
    failed = report(!isMissing(env.VITE_CONVEX_SITE_URL), `${file} VITE_CONVEX_SITE_URL`) || failed;
  }
  warn(
    !localEnv.VITE_CONVEX_URL ||
      !devEnv.VITE_CONVEX_URL ||
      localEnv.VITE_CONVEX_URL === devEnv.VITE_CONVEX_URL,
    ".env.development uses the same dev Convex URL as .env.local",
  );

  if (deploymentMode) {
    failed = (await checkDeploymentConfiguration()) || failed;
  }

  section("CLI availability");
  for (const command of ["bun", "convex", "wrangler", "gh"]) {
    const available = await hasCommand(command);
    const required = command !== "gh" || deploymentMode;
    failed = report(available || !required, `${command} CLI ${available ? "available" : "missing"}`) || failed;
  }

  if (externalMode) {
    failed = (await checkConvexEnv(localEnv, false)) || failed;
    failed = (await checkWrangler()) || failed;
    if (deploymentMode) {
      failed = (await checkConvexEnv(localEnv, true)) || failed;
      failed = (await checkGitHub()) || failed;
    }
  }

  section("GitHub Actions reference");
  console.log(`Secrets: ${githubSecretKeys.join(", ")}`);
  console.log(`Variables: ${githubVariableKeys.join(", ")}`);

  if (failed) {
    console.log("\nDoctor found missing or unsafe configuration.");
    console.log("Run `bun run setup`, apply pending external commands, then re-run doctor.");
    if (!deploymentMode) {
      console.log("Run `bun run doctor:deployment` when Cloudflare/GitHub deployment setup is ready.");
    }
    process.exit(1);
  }
  console.log(`\nDoctor passed${warnings ? ` with ${warnings} warning(s)` : ""}.`);
}

async function readEnv(path: string): Promise<EnvFile> {
  const file = Bun.file(new URL(path, root));
  if (!(await file.exists())) return {};
  return parseEnvFile(await file.text());
}

function section(title: string) {
  console.log(`\n${title}`);
}

function report(ok: boolean, label: string) {
  console.log(`${ok ? "[ok]" : "[missing]"} ${label}`);
  return !ok;
}

function warn(ok: boolean, label: string) {
  if (ok) {
    console.log(`[ok] ${label}`);
    return false;
  }
  warnings += 1;
  console.log(`[warn] ${label}`);
  return true;
}

function checkLocalAuthShape(localEnv: EnvFile) {
  const cloudConvex =
    localEnv.VITE_CONVEX_URL?.includes(".convex.cloud") ||
    localEnv.CONVEX_DEPLOYMENT?.startsWith("dev:");
  warn(
    !(cloudConvex && isLocalhostUrl(localEnv.SITE_URL)),
    "SITE_URL is not localhost when using a shared/cloud Convex deployment",
  );
  const trustedOrigins = localEnv.AUTH_TRUSTED_ORIGINS;
  warn(
    !trustedOrigins || trustedOrigins.includes("http://localhost:3000"),
    "AUTH_TRUSTED_ORIGINS includes the Vite dev origin",
  );
  warn(
    localEnv.AUTH_EMAIL_PROVIDER !== "resend" || !isMissing(localEnv.AUTH_EMAIL_FROM),
    "Resend mode has an AUTH_EMAIL_FROM sender",
  );
  const smsProvider = localEnv.AUTH_SMS_PROVIDER;
  warn(
    localEnv.AUTH_PHONE_ENABLED !== "true" ||
      (smsProvider !== undefined && ["console", "telnyx"].includes(smsProvider)),
    "phone auth uses a known SMS provider",
  );
}

async function hasCommand(command: string) {
  const proc = Bun.spawn(["bash", "-lc", `command -v ${command}`], {
    cwd: root.pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await proc.exited) === 0;
}

function requiredFiles() {
  return deploymentMode
    ? [".env.local", ".env.development", ".env.production", "wrangler.jsonc"]
    : [".env.local", ".env.development", "wrangler.jsonc"];
}

function viteEnvFiles(
  devEnv: EnvFile,
  prodEnv: EnvFile,
) {
  return deploymentMode
    ? Object.entries({ ".env.development": devEnv, ".env.production": prodEnv })
    : Object.entries({ ".env.development": devEnv });
}

async function checkDeploymentConfiguration() {
  section("Deployment configuration");
  const wranglerText = await Bun.file(new URL("wrangler.jsonc", root))
    .text()
    .catch(() => "");
  let failed = false;
  failed =
    report(!wranglerText.includes("REPLACE_ME"), "wrangler.jsonc account placeholders replaced") ||
    failed;
  failed =
    report(!wranglerText.includes("example.com"), "wrangler.jsonc domain placeholders replaced") ||
    failed;
  failed =
    report(!wranglerText.includes("localhost"), "wrangler.jsonc deployment SITE_URL is not localhost") ||
    failed;
  try {
    const wrangler = JSON.parse(wranglerText);
    failed = report(!isMissing(wrangler.account_id), "wrangler.jsonc account_id set") || failed;
    failed =
      report(
        !isMissing(wrangler.env?.production?.vars?.VITE_CONVEX_URL),
        "production VITE_CONVEX_URL set",
      ) || failed;
    failed =
      report(
        !isMissing(wrangler.env?.production?.vars?.VITE_CONVEX_SITE_URL),
        "production VITE_CONVEX_SITE_URL set",
      ) || failed;
  } catch {
    failed = report(false, "wrangler.jsonc parses as JSONC-compatible JSON") || failed;
  }
  for (const key of deploymentEnvKeys) {
    console.log(`- GitHub variable required: ${key}`);
  }
  console.log("- Convex production env must not include TEST_HELPER_SECRET or ENABLE_TEST_OTP_STORAGE.");
  return failed;
}

async function checkConvexEnv(
  localEnv: EnvFile,
  prod: boolean,
) {
  section(prod ? "Convex production backend env" : "Convex dev backend env");
  const listCommand = prod ? "bunx convex env --prod list" : "bunx convex env list";
  const output = await capture(listCommand);
  if (!output.ok) {
    report(false, `${listCommand} works`);
    console.log("  Run `bunx convex dev --once` and make sure you are logged in.");
    return true;
  }

  let failed = false;
  for (const key of requiredConvexKeys(localEnv, prod)) {
    if (key === "CONVEX_SITE_URL") {
      report(true, "Convex env CONVEX_SITE_URL is system-provided");
      continue;
    }
    failed = report(output.text.includes(key), `Convex env ${key}`) || failed;
  }

  if (prod) {
    failed =
      report(!output.text.includes("TEST_HELPER_SECRET"), "Convex prod env excludes TEST_HELPER_SECRET") ||
      failed;
    failed =
      report(
        !output.text.includes("ENABLE_TEST_OTP_STORAGE"),
        "Convex prod env excludes ENABLE_TEST_OTP_STORAGE",
      ) || failed;
  } else {
    failed = (await checkConvexValue("SITE_URL", localEnv.SITE_URL, prod)) || failed;
    failed =
      (await checkConvexValue(
        "AUTH_TRUSTED_ORIGINS",
        localEnv.AUTH_TRUSTED_ORIGINS,
        prod,
      )) || failed;
    failed =
      (await checkConvexValue("AUTH_EMAIL_PROVIDER", localEnv.AUTH_EMAIL_PROVIDER, prod)) ||
      failed;
    failed =
      (await checkConvexValue("FIRST_SUPER_ADMIN_EMAIL", localEnv.FIRST_SUPER_ADMIN_EMAIL, prod)) ||
      failed;
  }

  return failed;
}

function requiredConvexKeys(localEnv: EnvFile, prod: boolean) {
  return convexEnvKeys.filter((key) => {
    if (key === "CONVEX_SITE_URL") return true;
    if (prod && ["TEST_HELPER_SECRET", "ENABLE_TEST_OTP_STORAGE"].includes(key)) {
      return false;
    }
    if (key === "RESEND_API_KEY") return localEnv.AUTH_EMAIL_PROVIDER === "resend";
    if (key === "TELNYX_API_KEY" || key === "TELNYX_PHONE_NUMBER") {
      return (
        localEnv.AUTH_PHONE_ENABLED === "true" &&
        localEnv.AUTH_SMS_PROVIDER === "telnyx"
      );
    }
    return true;
  });
}

async function checkConvexValue(key: string, expected: string | undefined, prod: boolean) {
  if (!expected) return false;
  const command = prod
    ? `bunx convex env --prod get ${key}`
    : `bunx convex env get ${key}`;
  const output = await capture(command);
  if (!output.ok) {
    report(false, `Convex env ${key} can be read`);
    return true;
  }
  const actual = firstOutputLine(output.text);
  return report(actual === expected, `Convex env ${key} matches local config`);
}

function firstOutputLine(text: string) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

async function checkWrangler() {
  section("Cloudflare CLI");
  const output = await capture("wrangler whoami");
  const ok = output.ok || !deploymentMode;
  report(ok, output.ok ? "wrangler authenticated" : "wrangler login pending");
  return !ok;
}

async function checkGitHub() {
  section("GitHub CLI");
  const output = await capture("gh auth status");
  report(output.ok, output.ok ? "gh authenticated" : "gh auth login pending");
  return !output.ok;
}

async function capture(command: string) {
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd: root.pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    ok: exitCode === 0,
    text: `${stdout}\n${stderr}`,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
