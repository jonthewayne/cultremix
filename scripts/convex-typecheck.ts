import { isMissing } from "./lib/config";

if (isMissing(process.env.CONVEX_DEPLOYMENT)) {
  console.log(
    "Skipping `convex typecheck`: CONVEX_DEPLOYMENT is unset or still a placeholder.",
  );
  console.log("Run `bun run setup` and `bunx convex dev` to enable Convex typecheck.");
  process.exit(0);
}

const proc = Bun.spawn(["bunx", "convex", "typecheck"], {
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await proc.exited);

export {};
