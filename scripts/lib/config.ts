import { randomBytes } from "node:crypto";

export type StarterConfig = {
  projectName: string;
  appName: string;
  rootDomain: string;
  canonicalDevUrl: string;
  devUrl: string;
  prodUrl: string;
  convexDeployment: string;
  convexDevUrl: string;
  convexDevSiteUrl: string;
  convexProdUrl: string;
  convexProdSiteUrl: string;
  cloudflareAccountId: string;
  cloudflareZoneId: string;
  emailProvider: EmailProvider;
  resendApiKey: string;
  authEmailFrom: string;
  enablePhone: boolean;
  smsProvider: SmsProvider;
  telnyxApiKey: string;
  telnyxPhoneNumber: string;
  firstSuperAdminEmail: string;
  githubRepo: string;
};

export type EmailProvider = "console" | "resend";
export type SmsProvider = "console" | "telnyx";
export type EnvFile = Partial<Record<string, string>>;

export const PLACEHOLDER = "REPLACE_ME";

export const defaultConfig: StarterConfig = {
  projectName: "my-starter-app",
  appName: "My Starter App",
  rootDomain: "example.com",
  canonicalDevUrl: "https://dev.example.com",
  devUrl: "https://dev.example.com",
  prodUrl: "https://example.com",
  convexDeployment: "dev:REPLACE_ME",
  convexDevUrl: "https://REPLACE_WITH_DEV_DEPLOYMENT.convex.cloud",
  convexDevSiteUrl: "https://REPLACE_WITH_DEV_DEPLOYMENT.convex.site",
  convexProdUrl: "https://REPLACE_WITH_PROD_DEPLOYMENT.convex.cloud",
  convexProdSiteUrl: "https://REPLACE_WITH_PROD_DEPLOYMENT.convex.site",
  cloudflareAccountId: PLACEHOLDER,
  cloudflareZoneId: PLACEHOLDER,
  emailProvider: "console",
  resendApiKey: "",
  authEmailFrom: "Starter <auth@example.com>",
  enablePhone: false,
  smsProvider: "console",
  telnyxApiKey: "",
  telnyxPhoneNumber: "",
  firstSuperAdminEmail: "admin@example.com",
  githubRepo: "",
};

export function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function slugifyProjectName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export function parseEnvFile(input: string): EnvFile {
  const result: EnvFile = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    result[key] = parseEnvValue(value);
  }
  return result;
}

function parseEnvValue(value: string) {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.replace(/^"|"$/g, "");
    }
  }
  return value.replace(/\s+#.*$/u, "").trim();
}

export function serializeEnvFile(values: EnvFile) {
  return `${Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
    .join("\n")}\n`;
}

export function quoteEnvValue(value: string) {
  if (!value) return "";
  if (/[\s#"]/u.test(value)) return JSON.stringify(value);
  return value;
}

export function isMissing(value: string | undefined) {
  return !value || value.includes("REPLACE") || value === PLACEHOLDER;
}

export function normalizeDomain(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./iu, "");
  } catch {
    return trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "")
      .split("/")[0]
      .replace(/^www\./iu, "");
  }
}

export function hostnameFromUrl(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export function inferRootDomain(...urls: Array<string | undefined>) {
  for (const url of urls) {
    const host = hostnameFromUrl(url);
    if (!host || isLocalhost(host) || host.includes("REPLACE")) continue;
    return host.replace(/^dev\./iu, "").replace(/^www\./iu, "");
  }
  return defaultConfig.rootDomain;
}

export function appUrlDefaults(rootDomain: string) {
  const domain = normalizeDomain(rootDomain) || defaultConfig.rootDomain;
  return {
    canonicalDevUrl: `https://dev.${domain}`,
    devUrl: `https://dev.${domain}`,
    prodUrl: `https://${domain}`,
    previewBaseDomain: `preview.${domain}`,
  };
}

export function authTrustedOriginsForDev(
  canonicalDevUrl: string,
  rootDomain: string,
) {
  const devHost = hostnameFromUrl(canonicalDevUrl);
  const domain = normalizeDomain(rootDomain);
  const origins = [
    devHost && !["localhost", "127.0.0.1", "::1"].includes(devHost)
      ? `https://*.${devHost}`
      : undefined,
    domain ? `https://*.preview.${domain}` : undefined,
    "http://localhost:3000",
    "http://localhost:5173",
  ];
  return origins.filter((origin): origin is string => origin !== undefined).join(",");
}

export function authEmailFromDefault(appName: string, rootDomain: string) {
  const domain = normalizeDomain(rootDomain) || defaultConfig.rootDomain;
  return `${appName} <hello@${domain}>`;
}

export function isLocalhostUrl(value: string | undefined) {
  const host = hostnameFromUrl(value);
  return isLocalhost(host);
}

function isLocalhost(host: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}

export const localEnvKeys = [
  "CONVEX_DEPLOYMENT",
  "VITE_CONVEX_URL",
  "VITE_CONVEX_SITE_URL",
  "SITE_URL",
  "AUTH_TRUSTED_ORIGINS",
  "AUTH_SECRET",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_PROVIDER",
  "AUTH_EMAIL_OTP_ENABLED",
  "AUTH_MAGIC_LINK_ENABLED",
  "AUTH_PHONE_ENABLED",
  "AUTH_SMS_PROVIDER",
  "PHONE_TEMP_EMAIL_DOMAIN",
  "FIRST_SUPER_ADMIN_EMAIL",
  "TEST_HELPER_SECRET",
  "ENABLE_TEST_OTP_STORAGE",
] as const;

export const deploymentEnvKeys = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ZONE_NAME",
  "CLOUDFLARE_PROJECT_NAME",
  "DEV_URL",
  "PROD_URL",
  "PREVIEW_BASE_DOMAIN",
] as const;

export const convexEnvKeys = [
  "SITE_URL",
  "CONVEX_SITE_URL",
  "AUTH_SECRET",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_PROVIDER",
  "AUTH_EMAIL_OTP_ENABLED",
  "AUTH_MAGIC_LINK_ENABLED",
  "AUTH_PHONE_ENABLED",
  "AUTH_SMS_PROVIDER",
  "PHONE_TEMP_EMAIL_DOMAIN",
  "FIRST_SUPER_ADMIN_EMAIL",
  "RESEND_API_KEY",
  "TELNYX_API_KEY",
  "TELNYX_PHONE_NUMBER",
  "TEST_HELPER_SECRET",
  "ENABLE_TEST_OTP_STORAGE",
] as const;

export const githubSecretKeys = [
  "CLOUDFLARE_API_TOKEN",
  "CONVEX_DEPLOY_KEY_DEV",
  "CONVEX_DEPLOY_KEY_PROD",
] as const;

export const githubVariableKeys = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ZONE_NAME",
  "CLOUDFLARE_PROJECT_NAME",
  "DEV_URL",
  "PROD_URL",
  "PREVIEW_BASE_DOMAIN",
  "VITE_CONVEX_URL",
  "VITE_CONVEX_SITE_URL",
] as const;
