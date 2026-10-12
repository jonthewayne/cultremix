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
