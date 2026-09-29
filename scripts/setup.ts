import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  appUrlDefaults,
  authEmailFromDefault,
  authTrustedOriginsForDev,
  defaultConfig,
  generateSecret,
  inferRootDomain,
  isMissing,
  normalizeDomain,
  parseEnvFile,
  serializeEnvFile,
  slugifyProjectName,
} from "./lib/config";
import type {
  EmailProvider,
  EnvFile,
  SmsProvider,
  StarterConfig,
} from "./lib/config";

const root = new URL("..", import.meta.url);
const dryRun = process.argv.includes("--dry-run");
const applyExternal = process.argv.includes("--apply-external");
const rotateSecrets = process.argv.includes("--rotate-secrets");
const useDefaults = process.argv.includes("--defaults");
const localOnly = process.argv.includes("--local-only") || useDefaults;
const skipConvexSetup = process.argv.includes("--skip-convex");

const rl = createInterface({ input, output });

type SecretStatus = "generated" | "reused" | "rotated";

type SetupSecrets = {
  authSecret: string;
  testSecret: string;
  authSecretStatus: SecretStatus;
  testSecretStatus: SecretStatus;
};

async function main() {
  phase("Welcome");
  console.log("Starter setup wizard");
  console.log(
    "Local-first path: project identity, Convex, domains, auth providers, optional deployment, then verification.",
  );

  const defaults = await detectedDefaults();
  const existingLocalEnv = await readEnvFile(".env.local");
  const config = await collectConfig(defaults);
  const secrets = selectSecrets(existingLocalEnv);

  phase("Write local files");
  await writeEnvFile(".env.local", {
    CONVEX_DEPLOYMENT: config.convexDeployment,
    VITE_CONVEX_URL: config.convexDevUrl,
    VITE_CONVEX_SITE_URL: config.convexDevSiteUrl,
    SITE_URL: config.canonicalDevUrl,
    AUTH_TRUSTED_ORIGINS: authTrustedOriginsForDev(
      config.canonicalDevUrl,
      config.rootDomain,
    ),
    AUTH_SECRET: secrets.authSecret,
    AUTH_EMAIL_FROM: config.authEmailFrom,
    AUTH_EMAIL_PROVIDER: config.emailProvider,
    AUTH_EMAIL_OTP_ENABLED: "true",
    AUTH_MAGIC_LINK_ENABLED: "true",
    AUTH_PHONE_ENABLED: String(config.enablePhone),
    AUTH_SMS_PROVIDER: config.enablePhone ? config.smsProvider : "console",
    PHONE_TEMP_EMAIL_DOMAIN: "phone.local.test",
    FIRST_SUPER_ADMIN_EMAIL: config.firstSuperAdminEmail,
    TEST_HELPER_SECRET: secrets.testSecret,
    ENABLE_TEST_OTP_STORAGE: "true",
  });

  await writeEnvFile(".env.development", {
    VITE_CONVEX_URL: config.convexDevUrl,
    VITE_CONVEX_SITE_URL: config.convexDevSiteUrl,
  });
  await writeEnvFile(".env.production", {
    VITE_CONVEX_URL: config.convexProdUrl,
    VITE_CONVEX_SITE_URL: config.convexProdSiteUrl,
  });

  await patchPackageName(config.projectName);
  await patchWrangler(config);
  await writeSetupReport(config, secrets);

  phase("External services");
  await printExternalSteps(config, secrets);

  phase("Done");
  console.log("Run `bun run doctor` next.");
  console.log(
    "Run `bun run doctor:external` after applying Convex env commands.",
  );
  console.log(
    "Run `bun run doctor:deployment` when Cloudflare/GitHub deployment setup is ready.",
  );
  rl.close();
}

async function collectConfig(defaults: StarterConfig): Promise<StarterConfig> {
  phase("Project");
  const projectName = slugifyProjectName(
    await ask("Project package/Worker name", defaults.projectName),
  );
  const appName = await ask("App display name", defaults.appName);

  phase("Convex");
  const convexDefaults = await maybeRunConvexSetup({
    ...defaults,
    projectName,
    appName,
  });

  phase("Domains");
  const inferredRootDomain =
    defaults.rootDomain ||
    inferRootDomain(convexDefaults.prodUrl, convexDefaults.canonicalDevUrl);
  const rootDomain = normalizeDomain(
    await ask("Root domain for app URLs", inferredRootDomain),
  );
  const urlDefaults = appUrlDefaults(rootDomain);
  const canonicalDevUrl = await ask(
    "Canonical dev app URL",
    defaultUrl(convexDefaults.canonicalDevUrl, urlDefaults.canonicalDevUrl),
  );
  const configureDeployment = localOnly
    ? false
    : (await ask("Configure Cloudflare/GitHub deployment now? yes/no", "no"))
        .toLowerCase()
        .startsWith("y");
  const devUrl = configureDeployment
    ? await ask(
        "Development app URL",
        defaultUrl(convexDefaults.devUrl, urlDefaults.devUrl),
      )
    : canonicalDevUrl;
  const prodUrl = configureDeployment
    ? await ask(
        "Production app URL",
        defaultUrl(convexDefaults.prodUrl, urlDefaults.prodUrl),
      )
    : defaultUrl(convexDefaults.prodUrl, urlDefaults.prodUrl);

  phase("Auth and providers");
  const emailProvider = await askChoice<EmailProvider>(
    "Email delivery mode (console/resend)",
    defaults.emailProvider,
    ["console", "resend"],
  );
  const resendApiKey =
    emailProvider === "resend"
      ? await ask("Resend API key", defaults.resendApiKey)
      : "";
  const authEmailFrom = await ask(
    "Auth email from",
    defaultEmailFrom(convexDefaults.authEmailFrom, appName, rootDomain),
  );
  const enablePhone = (
    await ask(
      "Enable phone auth? yes/no",
      String(defaults.enablePhone ? "yes" : "no"),
    )
  )
    .toLowerCase()
    .startsWith("y");
  const smsProvider = enablePhone
    ? await askChoice<SmsProvider>(
        "SMS delivery mode (console/telnyx)",
        defaults.smsProvider,
        ["console", "telnyx"],
      )
    : "console";
  const telnyxApiKey =
    enablePhone && smsProvider === "telnyx"
      ? await ask("Telnyx API key", defaults.telnyxApiKey)
      : "";
  const telnyxPhoneNumber =
    enablePhone && smsProvider === "telnyx"
      ? await ask("Telnyx sender number", defaults.telnyxPhoneNumber)
      : "";
  const firstSuperAdminEmail = await ask(
    "First super admin email",
    convexDefaults.firstSuperAdminEmail,
  );

  phase("Convex env values");
  const convexDeployment = await ask(
    "Convex dev deployment",
    convexDefaults.convexDeployment,
  );
  const convexDevUrl = await ask("Convex dev URL", convexDefaults.convexDevUrl);
  const convexDevSiteUrl = await ask(
    "Convex dev site URL",
    convexDefaults.convexDevSiteUrl,
  );
  const convexProdUrl = configureDeployment
    ? await ask("Convex prod URL", convexDefaults.convexProdUrl)
    : convexDefaults.convexProdUrl;
  const convexProdSiteUrl = configureDeployment
    ? await ask("Convex prod site URL", convexDefaults.convexProdSiteUrl)
    : convexDefaults.convexProdSiteUrl;

  phase("Deployment");
  const cloudflareAccountId = configureDeployment
    ? await ask("Cloudflare account id", convexDefaults.cloudflareAccountId)
    : convexDefaults.cloudflareAccountId;
  const cloudflareZoneId = configureDeployment
    ? await ask("Cloudflare zone id", convexDefaults.cloudflareZoneId)
    : convexDefaults.cloudflareZoneId;
  const githubRepo = configureDeployment
    ? await ask(
        "GitHub repo owner/name (blank to skip)",
        convexDefaults.githubRepo,
      )
    : "";
  if (!configureDeployment) {
    console.log(
      "Deployment prompts skipped. Rerun setup without --local-only when ready.",
    );
  }

  return {
    projectName,
    appName,
    rootDomain,
    canonicalDevUrl,
    devUrl,
    prodUrl,
    convexDeployment,
    convexDevUrl,
    convexDevSiteUrl,
    convexProdUrl,
    convexProdSiteUrl,
    cloudflareAccountId,
    cloudflareZoneId,
    emailProvider,
    resendApiKey,
    authEmailFrom,
    enablePhone,
    smsProvider,
    telnyxApiKey,
    telnyxPhoneNumber,
    firstSuperAdminEmail,
    githubRepo,
  };
}

async function maybeRunConvexSetup(
  defaults: StarterConfig,
): Promise<StarterConfig> {
  if (skipConvexSetup || useDefaults) return defaults;
  const hasConvexConfig =
    !isMissing(defaults.convexDeployment) && !isMissing(defaults.convexDevUrl);
  const setupMode = await askChoice(
    "Convex project setup (create/existing/local/skip)",
    hasConvexConfig ? "skip" : "create",
    ["create", "existing", "local", "skip"],
  );
  if (setupMode === "skip") return defaults;

  if (setupMode === "local") {
    const localEnv = await readEnvFile(".env.local");
    const configuredDeployment = localEnv.CONVEX_DEPLOYMENT;
    const alreadyLocal =
      configuredDeployment?.startsWith("anonymous") ||
      configuredDeployment?.startsWith("local:");
    if (configuredDeployment && !alreadyLocal) {
      await removeEnvFileKey(".env.local", "CONVEX_DEPLOYMENT");
    }
    const command = alreadyLocal
      ? "bunx convex dev --once"
      : "CONVEX_DEPLOYMENT= bunx convex dev --once";
    console.log(`\nRunning: ${command}`);
    const ok = await run(command);
    return ok ? detectedDefaults() : defaults;
  }

  console.log(
    "\nConvex cloud projects belong to a team. Agents must ask the human which team to use before running this step.",
  );
  console.log(
    "Enter an existing team slug, type `interactive` to let the Convex CLI ask, or type `dashboard` to create a team in the Convex dashboard first.",
  );
  const teamChoice = (await ask("Convex team choice", "")).toLowerCase();
  if (!teamChoice) {
    console.log(
      "Convex setup paused. Rerun setup after choosing a team slug, or use `bun run setup --skip-convex` and run Convex setup yourself.",
    );
    return defaults;
  }
  if (teamChoice === "dashboard" || teamChoice === "create") {
    console.log(
      "Create the team in the Convex dashboard, then rerun `bun run setup` with that team's slug.",
    );
    console.log("Dashboard: https://dashboard.convex.dev/");
    return defaults;
  }

  const interactiveTeamSelection = teamChoice === "interactive";
  const projectSlug =
    setupMode === "existing"
      ? await ask("Existing Convex project slug", defaults.projectName)
      : defaults.projectName;
  const command = interactiveTeamSelection
    ? `bunx convex dev --configure ${setupMode} --once`
    : `bunx convex dev --configure ${setupMode} --project ${shellQuote(projectSlug)} --team ${shellQuote(teamChoice)} --dev-deployment cloud --once`;

  if (interactiveTeamSelection) {
    console.log(`When Convex asks for the project name, use: ${projectSlug}`);
  }
  console.log(`\nRunning: ${command}`);
  const ok = await run(command);
  if (!ok) {
    console.log(
      "Convex setup did not complete. You can rerun this wizard or run `bunx convex dev --configure new --once` manually.",
    );
    return defaults;
  }

  return detectedDefaults();
}

async function detectedDefaults(): Promise<StarterConfig> {
  const local = await readEnvFile(".env.local");
  const development = await readEnvFile(".env.development");
  const production = await readEnvFile(".env.production");
  const rootDomain = inferRootDomain(
    local.SITE_URL,
    defaultConfig.prodUrl,
    defaultConfig.canonicalDevUrl,
  );

  return {
    ...defaultConfig,
    rootDomain,
    convexDeployment: local.CONVEX_DEPLOYMENT ?? defaultConfig.convexDeployment,
    convexDevUrl:
      local.VITE_CONVEX_URL ??
      development.VITE_CONVEX_URL ??
      defaultConfig.convexDevUrl,
    convexDevSiteUrl:
      local.VITE_CONVEX_SITE_URL ??
      development.VITE_CONVEX_SITE_URL ??
      inferConvexSiteUrl(local.VITE_CONVEX_URL) ??
      defaultConfig.convexDevSiteUrl,
    convexProdUrl: production.VITE_CONVEX_URL ?? defaultConfig.convexProdUrl,
    convexProdSiteUrl:
      production.VITE_CONVEX_SITE_URL ?? defaultConfig.convexProdSiteUrl,
    canonicalDevUrl: local.SITE_URL ?? defaultConfig.canonicalDevUrl,
    emailProvider: isEmailProvider(local.AUTH_EMAIL_PROVIDER)
      ? local.AUTH_EMAIL_PROVIDER
      : defaultConfig.emailProvider,
    authEmailFrom: local.AUTH_EMAIL_FROM ?? defaultConfig.authEmailFrom,
    enablePhone: local.AUTH_PHONE_ENABLED === "true",
    smsProvider: isSmsProvider(local.AUTH_SMS_PROVIDER)
      ? local.AUTH_SMS_PROVIDER
      : defaultConfig.smsProvider,
    firstSuperAdminEmail:
      local.FIRST_SUPER_ADMIN_EMAIL ?? defaultConfig.firstSuperAdminEmail,
  };
}

function selectSecrets(existingLocalEnv: EnvFile): SetupSecrets {
  const existingAuthSecret = existingLocalEnv.AUTH_SECRET;
  const existingTestSecret = existingLocalEnv.TEST_HELPER_SECRET;
  const authSecretStatus = secretStatus(existingAuthSecret);
  const testSecretStatus = secretStatus(existingTestSecret);
  return {
    authSecret:
      authSecretStatus === "reused" && existingAuthSecret
        ? existingAuthSecret
        : generateSecret(),
    testSecret:
      testSecretStatus === "reused" && existingTestSecret
        ? existingTestSecret
        : generateSecret(18),
    authSecretStatus,
    testSecretStatus,
  };
}

function secretStatus(existing: string | undefined): SecretStatus {
  if (rotateSecrets) return "rotated";
  return existing && !isMissing(existing) ? "reused" : "generated";
}

async function ask(question: string, fallback: string) {
  if (useDefaults) {
    console.log(`${question}${fallback ? ` [${fallback}]` : ""}: ${fallback}`);
    return fallback;
  }
  const answer = await rl.question(
    `${question}${fallback ? ` [${fallback}]` : ""}: `,
  );
  return answer.trim() || fallback;
}

async function askChoice<T extends string>(
  question: string,
  fallback: T,
  choices: ReadonlyArray<T>,
): Promise<T> {
  let selected: T | undefined;
  while (selected === undefined) {
    const answer = (await ask(question, fallback)).toLowerCase() as T;
    if (choices.includes(answer)) {
      selected = answer;
    } else {
      console.log(`Please choose one of: ${choices.join(", ")}`);
    }
  }
  return selected;
}

async function writeEnvFile(path: string, values: Record<string, string>) {
  const file = new URL(path, root);
  const existing = await Bun.file(file)
    .text()
    .catch(() => "");
  const next: EnvFile = { ...parseEnvFile(existing), ...values };
  await writeText(path, serializeEnvFile(next));
}

async function removeEnvFileKey(path: string, key: string) {
  const file = new URL(path, root);
  const existing = await Bun.file(file)
    .text()
    .catch(() => "");
  const lines = existing.split(/\r?\n/u).filter((line) => {
    const equals = line.indexOf("=");
    return equals < 0 || line.slice(0, equals).trim() !== key;
  });
  await writeText(path, `${lines.join("\n").replace(/\n+$/u, "")}\n`);
}

async function readEnvFile(path: string) {
  const file = Bun.file(new URL(path, root));
  if (!(await file.exists())) return {};
  return parseEnvFile(await file.text());
}

async function patchPackageName(projectName: string) {
  const path = "package.json";
  const file = new URL(path, root);
  const pkg = JSON.parse(await Bun.file(file).text());
  pkg.name = projectName;
  await writeText(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function patchWrangler(config: StarterConfig) {
  const path = "wrangler.jsonc";
  const file = new URL(path, root);
  const wrangler = JSON.parse(await Bun.file(file).text());
  const devHost = hostname(config.devUrl);
  const prodHost = hostname(config.prodUrl);

  wrangler.name = config.projectName;
  wrangler.account_id = config.cloudflareAccountId;
  wrangler.vars ??= {};
  wrangler.vars.SITE_URL = config.canonicalDevUrl;
  wrangler.vars.VITE_CONVEX_URL = config.convexDevUrl;
  wrangler.vars.VITE_CONVEX_SITE_URL = config.convexDevSiteUrl;

  wrangler.env ??= {};
  wrangler.env.development ??= {};
  wrangler.env.development.name = `${config.projectName}-dev`;
  wrangler.env.development.routes = [
    { pattern: devHost, zone_name: config.rootDomain, custom_domain: true },
  ];
  wrangler.env.development.vars ??= {};
  wrangler.env.development.vars.SITE_URL = config.devUrl;
  wrangler.env.development.vars.VITE_CONVEX_URL = config.convexDevUrl;
  wrangler.env.development.vars.VITE_CONVEX_SITE_URL = config.convexDevSiteUrl;

  wrangler.env.production ??= {};
  wrangler.env.production.name = `${config.projectName}-prod`;
  wrangler.env.production.routes = [
    { pattern: prodHost, zone_name: config.rootDomain, custom_domain: true },
  ];
  wrangler.env.production.vars ??= {};
  wrangler.env.production.vars.SITE_URL = config.prodUrl;
  wrangler.env.production.vars.VITE_CONVEX_URL = config.convexProdUrl;
  wrangler.env.production.vars.VITE_CONVEX_SITE_URL = config.convexProdSiteUrl;

  await writeText(path, `${JSON.stringify(wrangler, null, 2)}\n`);
}

async function writeSetupReport(config: StarterConfig, secrets: SetupSecrets) {
  const report = {
    generatedAt: new Date().toISOString(),
    project: {
      packageName: config.projectName,
      appName: config.appName,
      rootDomain: config.rootDomain,
    },
    urls: {
      canonicalDevUrl: config.canonicalDevUrl,
      devUrl: config.devUrl,
      prodUrl: config.prodUrl,
      trustedDevOrigins: authTrustedOriginsForDev(
        config.canonicalDevUrl,
        config.rootDomain,
      ),
    },
    convex: {
      devDeployment: config.convexDeployment,
      devUrl: config.convexDevUrl,
      devSiteUrl: config.convexDevSiteUrl,
      prodUrl: config.convexProdUrl,
      prodSiteUrl: config.convexProdSiteUrl,
    },
    auth: {
      emailProvider: config.emailProvider,
      authEmailFrom: config.authEmailFrom,
      phoneEnabled: config.enablePhone,
      smsProvider: config.enablePhone ? config.smsProvider : "console",
      firstSuperAdminEmail: config.firstSuperAdminEmail,
    },
    secrets: {
      authSecret: secrets.authSecretStatus,
      testHelperSecret: secrets.testSecretStatus,
      note: "Secret values are intentionally omitted from this report.",
    },
    nextSteps: [
      "bun run doctor",
      ...(!isLocalConvexDeployment(config.convexDeployment)
        ? ["apply the printed Convex env commands"]
        : []),
      "bun run doctor:external",
      "bun run dev",
    ],
  };
  await writeText(
    ".starter/setup-state.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function printExternalSteps(
  config: StarterConfig,
  secrets: SetupSecrets,
) {
  const devConvexCommands = convexEnvCommands({
    siteUrl: config.canonicalDevUrl,
    trustedOrigins: authTrustedOriginsForDev(
      config.canonicalDevUrl,
      config.rootDomain,
    ),
    config,
    authSecret: secrets.authSecret,
    testSecret: secrets.testSecret,
    includeTestHelpers: true,
  });

  console.log("Convex dev env commands:");
  const localConvexDeployment = isLocalConvexDeployment(
    config.convexDeployment,
  );
  const applyDevEnv = applyExternal || localConvexDeployment;
  for (const [key, value] of devConvexCommands) {
    const command = `bunx convex env set ${key} ${shellQuote(value)}`;
    console.log(`  ${command}`);
    if (applyDevEnv) {
      const ok = await runArgv(
        ["bunx", "convex", "env", "set", key, value],
        command,
      );
      if (!ok && localConvexDeployment) {
        throw new Error(`Could not apply ${key} to local Convex`);
      }
    }
  }

  if (!isMissing(config.convexProdUrl)) {
    console.log("\nConvex production env commands:");
    for (const [key, value] of convexEnvCommands({
      siteUrl: config.prodUrl,
      trustedOrigins: trustedOriginsForProduction(config.prodUrl),
      config,
      authSecret: secrets.authSecret,
      testSecret: secrets.testSecret,
      includeTestHelpers: false,
    })) {
      const command = `bunx convex env set --prod ${key} ${shellQuote(value)}`;
      console.log(`  ${command}`);
      if (applyExternal) {
        await runArgv(
          ["bunx", "convex", "env", "set", "--prod", key, value],
          command,
        );
      }
    }
  } else {
    console.log(
      "\nConvex production env commands: skipped until you enter production Convex URLs.",
    );
  }

  console.log("\nEmail delivery:");
  if (config.emailProvider === "console") {
    console.log(
      "  Local console email is selected. Resend is not required until you choose real delivery.",
    );
  } else if (config.resendApiKey) {
    console.log(
      "  Resend is selected. Make sure AUTH_EMAIL_FROM uses a verified Resend sender/domain.",
    );
  } else {
    console.log("  Resend is selected, but RESEND_API_KEY is still pending.");
  }

  console.log("\nCloudflare Worker secrets:");
  console.log(
    "  None required by default. Auth/email/SMS secrets live in Convex backend env.",
  );

  if (config.githubRepo) {
    console.log("\nGitHub Actions commands:");
    const variables: Array<[string, string]> = [
      ["CLOUDFLARE_ACCOUNT_ID", config.cloudflareAccountId],
      ["CLOUDFLARE_ZONE_ID", config.cloudflareZoneId],
      ["CLOUDFLARE_ZONE_NAME", config.rootDomain],
      ["CLOUDFLARE_PROJECT_NAME", config.projectName],
      ["DEV_URL", config.devUrl],
      ["PROD_URL", config.prodUrl],
      [
        "PREVIEW_BASE_DOMAIN",
        appUrlDefaults(config.rootDomain).previewBaseDomain,
      ],
      ["VITE_CONVEX_URL", config.convexProdUrl],
      ["VITE_CONVEX_SITE_URL", config.convexProdSiteUrl],
    ];
    for (const [key, value] of variables) {
      const command = `gh variable set ${key} --repo ${shellQuote(config.githubRepo)} --body ${shellQuote(value)}`;
      console.log(`  ${command}`);
      if (applyExternal) {
        await runArgv(
          [
            "gh",
            "variable",
            "set",
            key,
            "--repo",
            config.githubRepo,
            "--body",
            value,
          ],
          command,
        );
      }
    }
    console.log(
      `  printf %s REPLACE_WITH_DEV_DEPLOY_KEY | gh secret set CONVEX_DEPLOY_KEY_DEV --repo ${shellQuote(config.githubRepo)}`,
    );
    console.log(
      `  printf %s REPLACE_WITH_PROD_DEPLOY_KEY | gh secret set CONVEX_DEPLOY_KEY_PROD --repo ${shellQuote(config.githubRepo)}`,
    );
  }
}

function convexEnvCommands({
  siteUrl,
  trustedOrigins,
  config,
  authSecret,
  testSecret,
  includeTestHelpers,
}: {
  siteUrl: string;
  trustedOrigins: string;
  config: StarterConfig;
  authSecret: string;
  testSecret: string;
  includeTestHelpers: boolean;
}): Array<[string, string]> {
  return [
    ["SITE_URL", siteUrl],
    ["AUTH_SECRET", authSecret],
    ["AUTH_TRUSTED_ORIGINS", trustedOrigins],
    ["AUTH_EMAIL_FROM", config.authEmailFrom],
    ["AUTH_EMAIL_PROVIDER", config.emailProvider],
    ["AUTH_EMAIL_OTP_ENABLED", "true"],
    ["AUTH_MAGIC_LINK_ENABLED", "true"],
    ["AUTH_PHONE_ENABLED", String(config.enablePhone)],
    ["AUTH_SMS_PROVIDER", config.enablePhone ? config.smsProvider : "console"],
    ["PHONE_TEMP_EMAIL_DOMAIN", "phone.local.test"],
    ["FIRST_SUPER_ADMIN_EMAIL", config.firstSuperAdminEmail],
    ...(includeTestHelpers
      ? ([
          ["TEST_HELPER_SECRET", testSecret],
          ["ENABLE_TEST_OTP_STORAGE", "true"],
        ] satisfies Array<[string, string]>)
      : []),
    ...(config.emailProvider === "resend" && config.resendApiKey
      ? ([["RESEND_API_KEY", config.resendApiKey]] satisfies Array<
          [string, string]
        >)
      : []),
    ...(config.enablePhone &&
    config.smsProvider === "telnyx" &&
    config.telnyxApiKey
      ? ([["TELNYX_API_KEY", config.telnyxApiKey]] satisfies Array<
          [string, string]
        >)
      : []),
    ...(config.enablePhone &&
    config.smsProvider === "telnyx" &&
    config.telnyxPhoneNumber
      ? ([["TELNYX_PHONE_NUMBER", config.telnyxPhoneNumber]] satisfies Array<
          [string, string]
        >)
      : []),
  ];
}

async function writeText(path: string, text: string) {
  if (dryRun) {
    console.log(`[dry-run] write ${path}`);
    return;
  }
  const file = new URL(path, root);
  await mkdir(new URL(".", file), { recursive: true });
  await Bun.write(file, text);
}

async function run(command: string) {
  if (dryRun) {
    console.log(`[dry-run] run ${command}`);
    return true;
  }
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd: root.pathname,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.log(`Pending: ${command}`);
    return false;
  }
  return true;
}

async function runArgv(args: Array<string>, display: string) {
  if (dryRun) {
    console.log(`[dry-run] run ${display}`);
    return true;
  }
  const proc = Bun.spawn(args, {
    cwd: root.pathname,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.log(`Pending: ${display}`);
    return false;
  }
  return true;
}

function isLocalConvexDeployment(deployment: string) {
  return deployment.startsWith("anonymous:") || deployment.startsWith("local:");
}

function phase(title: string) {
  console.log(`\n== ${title} ==`);
}

function defaultUrl(existing: string, derived: string) {
  return existing.includes("example.com") || existing.includes("REPLACE")
    ? derived
    : existing;
}

function defaultEmailFrom(
  existing: string,
  appName: string,
  rootDomain: string,
) {
  return existing.includes("example.com")
    ? authEmailFromDefault(appName, rootDomain)
    : existing;
}

function isEmailProvider(value: string | undefined): value is EmailProvider {
  return value === "console" || value === "resend";
}

function isSmsProvider(value: string | undefined): value is SmsProvider {
  return value === "console" || value === "telnyx";
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "example.com";
  }
}

function inferConvexSiteUrl(convexUrl: string | undefined) {
  if (!convexUrl) return undefined;
  return convexUrl.replace(".convex.cloud", ".convex.site");
}

function trustedOriginsForProduction(siteUrl: string) {
  const host = hostname(siteUrl);
  return [siteUrl, `https://www.${host}`]
    .filter(
      (value) => !value.includes("example.com") && !value.includes("REPLACE"),
    )
    .join(",");
}

main().catch((error) => {
  console.error(error);
  rl.close();
  process.exit(1);
});
