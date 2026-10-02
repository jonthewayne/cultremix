import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const starterRoot = new URL("../..", import.meta.url).pathname;

async function run(args: Array<string>, cwd: string) {
  const process = spawn(args[0], args.slice(1), {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    process.on("error", reject);
    process.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(
      `${args.join(" ")} failed with exit ${exitCode}: ${stderr}`,
    );
  }
}

describe("generated project acceptance", () => {
  it("copies safe files and writes a non-secret setup report", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "starter-generated-"));
    const project = join(tempRoot, "project");
    try {
      await run(
        ["bun", "run", "scripts/create-project.ts", project],
        starterRoot,
      );
      await expect(stat(join(project, ".env.local"))).rejects.toThrow();
      await expect(stat(join(project, ".mega"))).rejects.toThrow();
      await expect(stat(join(project, ".env.example"))).resolves.toBeDefined();
      await run(["bun", "run", "scripts/setup.ts", "--defaults"], project);

      const report = JSON.parse(
        await readFile(join(project, ".starter/setup-state.json"), "utf8"),
      );
      const env = await readFile(join(project, ".env.local"), "utf8");
      const packageJson = JSON.parse(
        await readFile(join(project, "package.json"), "utf8"),
      );
      const wrangler = JSON.parse(
        await readFile(join(project, "wrangler.jsonc"), "utf8"),
      );

      expect(report.project.packageName).toBe("my-starter-app");
      expect(report.auth).toMatchObject({
        emailProvider: "console",
        phoneEnabled: false,
      });
      expect(report.secrets).toMatchObject({
        authSecret: "generated",
        testHelperSecret: "generated",
      });
      expect(report.nextSteps).toContain("bun run doctor");
      expect(report).not.toHaveProperty("AUTH_SECRET");
      const authSecret = env.match(/^AUTH_SECRET=(.+)$/mu)?.[1];
      expect(authSecret).toBeTruthy();
      expect(JSON.stringify(report)).not.toContain(authSecret);
      expect(packageJson.name).toBe(report.project.packageName);
      expect(wrangler.name).toBe(report.project.packageName);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
    // It copies the project and runs setup in a child process: about 20 s on an idle machine,
    // past 30 s when other work is using the disk.
  }, 120_000);
});
