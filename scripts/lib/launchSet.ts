// The launch set's originals (docs/hackathon/launch-set.md, its Originals table), read from the doc
// itself so the doc stays the one list, for scripts/launch-batches.ts.

export type LaunchDesign = { title: string; request: string };

export function launchOriginals(markdown: string): Array<LaunchDesign> {
  const start = markdown.indexOf("\n## Originals");
  if (start < 0) throw new Error("launch-set.md has no Originals section.");
  const next = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  const designs: Array<LaunchDesign> = [];
  for (const line of section.split("\n")) {
    const cells = line.trim().match(/^\|(.*)\|$/u)?.[1].split("|").map((cell) => cell.trim());
    if (!cells || cells.length !== 2) continue;
    const [title, request] = cells;
    // The header row and the |---|---| line under it.
    if (title === "Title" || /^-+$/u.test(title)) continue;
    if (title && request) designs.push({ title, request });
  }
  if (designs.length === 0) throw new Error("launch-set.md's Originals table has no designs.");
  return designs;
}

// --only "Grow Slow,Night Shift" picks some, by title (case doesn't matter).
export function pickDesigns(designs: Array<LaunchDesign>, only: string | undefined): Array<LaunchDesign> {
  if (!only) return designs;
  const wanted = only.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  const picked = designs.filter((design) => wanted.includes(design.title.toLowerCase()));
  const missing = wanted.filter((name) => !designs.some((design) => design.title.toLowerCase() === name));
  if (missing.length > 0) {
    throw new Error("No design called " + missing.join(", ") + ". The launch set has: " + designs.map((d) => d.title).join(", ") + ".");
  }
  return picked;
}

// The launch set's remixes (its "Remixes, from the second account" table): which original, and
// either a word box to change or a request for Anything else to change.
export type LaunchRemix = {
  original: string;
  change: { kind: "words"; from: string; to: string } | { kind: "request"; text: string };
  expect: string;
};

export function launchRemixes(markdown: string): Array<LaunchRemix> {
  const start = markdown.indexOf("\n## Remixes");
  if (start < 0) throw new Error("launch-set.md has no Remixes section.");
  const next = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  const remixes: Array<LaunchRemix> = [];
  for (const line of section.split("\n")) {
    const cells = line.trim().match(/^\|(.*)\|$/u)?.[1].split("|").map((cell) => cell.trim());
    if (!cells || cells.length !== 3) continue;
    const [original, action, expect] = cells;
    if (original === "Original" || /^-+$/u.test(original)) continue;
    const words = /^Change the word box (.+?) to (.+)$/u.exec(action);
    const request = /^In Anything else to change: "(.+)"$/u.exec(action);
    if (words) remixes.push({ original, change: { kind: "words", from: words[1], to: words[2] }, expect });
    else if (request) remixes.push({ original, change: { kind: "request", text: request[1] }, expect });
    else throw new Error("launch-set.md: can't read what to do for " + original + ": " + action);
  }
  if (remixes.length === 0) throw new Error("launch-set.md's Remixes table has none.");
  return remixes;
}

// A remix's session name: "Grow Slow: LOUD", or the request's first words.
export function remixSessionTitle(remix: LaunchRemix) {
  if (remix.change.kind === "words") return remix.original + ": " + remix.change.to;
  const words = remix.change.text.split(/\s+/u);
  let short = "";
  for (const word of words) {
    if ((short + " " + word).trim().length > 32) break;
    short = (short + " " + word).trim();
  }
  return remix.original + ": " + short.replace(/[,.:;]$/u, "") + (short.length < remix.change.text.length ? "…" : "");
}
