// The work of bun run circle:setup (scripts/circle-setup.ts), with Circle's calls, the files, and
// the clock passed in so tests can run it against a fake Circle. From an API key it finds the host
// that takes the key, registers a new entity secret (saved in the env file before Circle sees it,
// so a run that stops partway can't lose it), writes Circle's recovery file beside it, and makes
// the environment's wallet set with a saved request key, so a rerun gets the same set back.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CIRCLE_API_BASE, CIRCLE_API_HOSTS, CircleError, circleClient } from "../../convex/lib/circle";
import { CHAIN_ENVIRONMENTS } from "../../shared/config/chains";
import { readEnvFile, updateEnvFile } from "./envFile";
import type { FetchLike } from "../../convex/lib/circle";

export class CircleSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircleSetupError";
  }
}

export type CircleSetupOptions = {
  env: "dev" | "prod";
  // The private env file (~/.config/cultremix/circle.env) and the folder for recovery files.
  file: string;
  dir: string;
  fetch?: FetchLike;
  hosts?: ReadonlyArray<string>;
  log?: (line: string) => void;
  now?: () => Date;
  randomHex?: (bytes: number) => string;
  uuid?: () => string;
};

export type CircleSetupResult = {
  kind: "TEST" | "LIVE";
  apiKey: string;
  secret: string;
  walletSetId: string;
  base: string;
  recoveryFile?: string;
};

// The env file's names for one Circle key environment.
export function circleNames(kind: "TEST" | "LIVE") {
  return {
    apiKey: `CIRCLE_API_KEY_${kind}`,
    secret: `CIRCLE_ENTITY_SECRET_${kind}`,
    registered: `CIRCLE_ENTITY_SECRET_${kind}_REGISTERED_AT`,
    recovery: `CIRCLE_RECOVERY_FILE_${kind}`,
    request: `CIRCLE_WALLET_SET_REQUEST_${kind}`,
    walletSet: `CIRCLE_WALLET_SET_ID_${kind}`,
    base: `CIRCLE_API_BASE_${kind}`,
  };
}

function describe(error: unknown) {
  if (error instanceof CircleError) return error.message;
  return error instanceof Error ? error.name : "unknown error";
}

function defaultRandomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function stamp(date: Date) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
}

export async function runCircleSetup(options: CircleSetupOptions): Promise<CircleSetupResult> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const randomHex = options.randomHex ?? defaultRandomHex;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const kind = CHAIN_ENVIRONMENTS[options.env].circleKeyEnvironment;
  const label = kind === "TEST" ? "test" : "live";
  const names = circleNames(kind);
  const { file } = options;

  let values = readEnvFile(file);
  const apiKey = values.get(names.apiKey)?.trim();
  if (!apiKey) {
    throw new CircleSetupError(`Put a Circle ${label} API key in ${file} as ${names.apiKey}=... (Circle's console, Keys), then run this again.`);
  }
  if (!apiKey.startsWith(`${kind}_API_KEY:`)) {
    throw new CircleSetupError(`${names.apiKey} isn't a ${label} key: Circle's ${label} keys start with ${kind}_API_KEY:.`);
  }

  // 1. The host that takes the key (a live key only ever uses api.circle.com).
  let base = values.get(names.base)?.trim() || null;
  if (!base) {
    const hosts = options.hosts ?? (kind === "LIVE" ? [CIRCLE_API_BASE] : CIRCLE_API_HOSTS);
    for (const host of hosts) {
      try {
        await circleClient({ apiKey, entitySecret: "00".repeat(32), baseUrl: host, fetch: options.fetch }).checkKey();
        base = host;
        break;
      } catch (error) {
        log(`${host} didn't take the key: ${describe(error)}`);
      }
    }
    if (!base) throw new CircleSetupError(`Circle didn't accept ${names.apiKey}. Check it in Circle's console (Keys) and run this again.`);
    updateEnvFile(file, { [names.base]: base });
  }
  log(`Circle takes the ${label} key at ${base}.`);

  // 2. The entity secret: saved before Circle sees it.
  values = readEnvFile(file);
  let secret = values.get(names.secret)?.trim();
  let registered = Boolean(values.get(names.registered)?.trim());
  const fresh = !secret;
  if (!secret) {
    secret = randomHex(32);
    updateEnvFile(file, { [names.secret]: secret });
  }
  const client = circleClient({ apiKey, entitySecret: secret, baseUrl: base, fetch: options.fetch });
  let recoveryFile: string | undefined;
  if (!registered) {
    try {
      const result = await client.registerEntitySecret();
      recoveryFile = join(options.dir, `circle-recovery-${label}-${stamp(now())}.dat`);
      writeFileSync(recoveryFile, result.recoveryFile, { mode: 0o600 });
      updateEnvFile(file, { [names.registered]: now().toISOString(), [names.recovery]: recoveryFile });
      registered = true;
      log(`Registered a new entity secret. Its recovery file is ${recoveryFile}.`);
    } catch (error) {
      if (fresh) {
        updateEnvFile(file, { [names.secret]: null });
        throw new CircleSetupError(
          `Circle didn't register the entity secret: ${describe(error)}. If this account already has one (made in Circle's console or an earlier run), put it in ${file} as ${names.secret} and run this again, or reset it in Circle's console with its recovery file.`,
        );
      }
      // A secret saved by an interrupted run, or put in the file by hand: the wallet set below
      // shows whether Circle knows it.
      log(`Circle didn't register the saved entity secret (${describe(error)}); checking it by making the wallet set.`);
    }
  } else {
    log("Using the entity secret already registered.");
  }

  // 3. The wallet set, with its request key saved first.
  values = readEnvFile(file);
  let walletSetId = values.get(names.walletSet)?.trim();
  if (!walletSetId) {
    let requestKey = values.get(names.request)?.trim();
    if (!requestKey) {
      requestKey = uuid();
      updateEnvFile(file, { [names.request]: requestKey });
    }
    try {
      walletSetId = (await client.createWalletSet({ idempotencyKey: requestKey, name: `CultRemix ${options.env}` })).walletSetId;
    } catch (error) {
      throw new CircleSetupError(
        `Circle didn't make the wallet set: ${describe(error)}.${registered ? "" : ` The saved ${names.secret} may not be the entity secret Circle has.`}`,
      );
    }
    updateEnvFile(file, {
      [names.walletSet]: walletSetId,
      ...(registered ? {} : { [names.registered]: `confirmed by the wallet set, ${now().toISOString()}` }),
    });
  }
  log(`Wallet set for ${options.env}: ${walletSetId}`);
  return { kind, apiKey, secret, walletSetId, base, recoveryFile };
}
