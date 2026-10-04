// Judge lists for scripts/provision-judges.ts: one `email username` (or `email:username`,
// or `email,username`) per line or argument. Blank lines and `#` comments are skipped.

export type JudgeSpec = { email: string; username: string };

export function parseJudgeSpecs(lines: Array<string>): Array<JudgeSpec> {
  const specs: Array<JudgeSpec> = [];
  const seen = new Set<string>();
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const parts = line.split(/[\s,:]+/u).filter(Boolean);
    if (parts.length !== 2 || !parts[0].includes("@")) {
      throw new Error(`Line ${index + 1}: expected "email username", got "${raw.trim()}".`);
    }
    const email = parts[0].toLowerCase();
    const username = parts[1].replace(/^@/u, "");
    if (seen.has(email)) throw new Error(`Line ${index + 1}: ${email} is listed twice.`);
    seen.add(email);
    specs.push({ email, username });
  }
  return specs;
}
