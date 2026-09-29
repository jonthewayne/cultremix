import { access, copyFile, cp, mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { shouldExcludeProjectEntry } from "./lib/project-files";

const root = new URL("..", import.meta.url);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const install = args.includes("--install");
const runSetup = args.includes("--setup");
const destinationArg = args.find((arg) => !arg.startsWith("--"));

async function main() {
  if (!destinationArg) {
    console.log("Usage: bun run new-project ../my-app [--install] [--setup] [--dry-run]");
    process.exit(1);
  }

  const destination = resolve(destinationArg);
  await assertDestinationReady(destination);

  console.log(`Creating project at ${destination}`);
  if (dryRun) {
    console.log("[dry-run] copy starter files");
  } else {
    await mkdir(destination, { recursive: true });
    await cp(root.pathname, destination, {
      recursive: true,
      filter: (source) => !shouldExcludeProjectEntry(source),
    });
    await copyFile(
      new URL("../wrangler.jsonc.template", import.meta.url),
      resolve(destination, "wrangler.jsonc"),
    );
  }

  console.log("\nNext:");
  console.log(`  cd ${shellQuote(destination)}`);
  if (install) {
    await run("bun install", destination);
  } else {
    console.log("  bun install");
  }
  if (runSetup) {
    await run("bun run setup", destination);
  } else {
    console.log("  bun run setup");
  }
  console.log("  bun run doctor");
  console.log("  bun run dev");
}

async function assertDestinationReady(destination: string) {
  try {
    const info = await stat(destination);
    if (!info.isDirectory()) {
      throw new Error("Destination exists and is not a directory.");
    }
    const entries = await readdir(destination);
    if (entries.length > 0 && !force) {
      throw new Error("Destination directory is not empty. Use --force to merge anyway.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function run(command: string, cwd: string) {
  if (dryRun) {
    console.log(`[dry-run] ${command}`);
    return;
  }
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

await access(root);
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
