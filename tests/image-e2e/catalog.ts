import { CASES } from "./cases";
import type { Ask, Case, Group, WordsCheck } from "./cases";
import { FIXTURES, fixture } from "./fixtures";
import { PIN } from "./pin";

// CASES.md, rendered from cases.ts: every case, what it supports, its inputs, and how it's checked.
// tests/unit/imageSuite.test.ts fails when the file is out of date (bun run test:image --catalog).

const GROUPS: Array<{ group: Group; title: string; about: string }> = [
  { group: "words", title: "Words", about: "Spelling the request's words, and changing words on an image." },
  { group: "styles", title: "Styles", about: "Copying a style, naming a style in words, and mixing styles by their sliders." },
  { group: "people", title: "People", about: "Keeping a person recognizable while a style redraws them, head to toe." },
  { group: "remix", title: "Remixes", about: "Remixing a published design by its word boxes and in words, with and without a style." },
  { group: "layout", title: "Grid and layout", about: "Four designs per call, cut apart cleanly on a transparent background." },
  { group: "photo", title: "Model photo", about: "The photo of a model wearing a published design." },
  { group: "notes", title: "Image notes (GPT-6 Luna)", about: "What the notes capture from each image: its words, its look, how it draws people." },
  { group: "reader", title: "Request reader (GPT-6 Luna)", about: "What a request wants from each numbered image, and whether it asks for the style's hair." },
  { group: "compare", title: "Remix comparison (GPT-6 Luna)", about: "Whether a remix reads as the same design (a variation) or a new one (it may be a fork)." },
];

const quote = (text: string) => (text ? `"${text}"` : "(nothing typed)");
const askLine = (ask: Ask, designs: number) =>
  `${ask.expect === false ? "not: " : ""}${ask.ask.replace(/\?$/u, "")} (${ask.min ?? designs} of ${designs})`;
const wordsLine = (words: WordsCheck, designs: number) =>
  `words read: ${words.has.join(" ")}${words.not?.length ? `; never ${words.not.join(", ")}` : ""} (${words.min ?? designs} of ${designs})`;
const names = (ids: Array<string>) => ids.map((id) => `\`${id}\``).join(", ");

function generateLines(c: Extract<Case, { kind: "generate" | "photo" }>) {
  const lines: Array<string> = [];
  if (c.kind === "generate") {
    if (c.images?.length) lines.push(`Images: ${names(c.images)}${c.remix ? " (image 1 is the published design being remixed)" : ""}`);
    if (c.mixer?.length) lines.push(`Style mixer: ${c.mixer.map((m) => `\`${m.fixture}\` at ${m.weight}`).join(", ")}`);
    if (c.remix?.words?.length) lines.push(`Word boxes: ${c.remix.words.map((w) => (w.to ? `${w.from} to ${w.to}` : `${w.from} emptied`)).join(", ")}`);
    lines.push(`Request: ${quote(c.request)}`);
    lines.push("Checks: four designs cut from one grid on a transparent background");
    if (c.words) lines.push(`Checks: ${wordsLine(c.words, 4)}`);
    for (const ask of c.asks) lines.push(`Checks: ${askLine(ask, 4)}`);
    for (const ask of c.gridAsks ?? []) lines.push(`Checks, whole grid: ${askLine(ask, 1)}`);
  } else {
    lines.push(`Design: \`${c.design}\` on a ${c.shirt} shirt`);
    if (c.words) lines.push(`Checks: ${wordsLine(c.words, 1)}`);
    for (const ask of c.asks) lines.push(`Checks: ${askLine(ask, 1)}`);
  }
  return lines;
}

export function renderCatalog(cases: Array<Case> = CASES) {
  const out: Array<string> = [
    "# Image test suite: cases",
    "",
    "Rendered from [cases.ts](cases.ts) by `bun run test:image --catalog`; don't edit by hand. How to run the suite: [README.md](README.md).",
    "",
    `Pinned to \`${PIN.name}\`: \`${PIN.imageWithImages}\` with images, \`${PIN.imageTextOnly}\` without, grids ${PIN.gridSize} at ${PIN.gridQuality} quality; \`${PIN.vision}\` for notes, the request reader, the remix comparison, and the checker.`,
    "",
    `${cases.length} cases: ${GROUPS.map((g) => `${cases.filter((c) => c.group === g.group).length} ${g.title.toLowerCase()}`).join(", ")}.`,
    "",
  ];
  for (const { group, title, about } of GROUPS) {
    const list = cases.filter((c) => c.group === group);
    if (list.length === 0) continue;
    out.push(`## ${title}`, "", about, "");
    if (group === "reader") {
      out.push("| Case | Images | Mixer | Request | Expected | Since |", "|---|---|---|---|---|---|");
      for (const c of list) {
        if (c.kind !== "reader") continue;
        const expected = c.roles.map((r) => r.join("/")).join(" or ") + ((c.styleHair ?? [false]).includes(true) ? (c.styleHair?.includes(false) ? ", style hair either way" : ", style hair") : "");
        out.push(`| \`${c.id}\` | ${names(c.images)} | ${c.mixer?.length ? names(c.mixer) : ""} | ${quote(c.request)} | ${expected} | ${c.since} |`);
      }
      out.push("");
      continue;
    }
    if (group === "compare") {
      out.push("| Case | Original | Remix | Expected | Since |", "|---|---|---|---|---|");
      for (const c of list) {
        if (c.kind !== "compare") continue;
        out.push(`| ${c.title} | \`${c.original}\` | \`${c.remix}\` | ${c.expect} | ${c.since} |`);
      }
      out.push("");
      continue;
    }
    for (const c of list) {
      out.push(`### \`${c.id}\`: ${c.title}${c.status === "known-limit" ? " (known limit)" : ""}`, "", c.supports, "");
      if (c.kind === "generate" || c.kind === "photo") for (const line of generateLines(c)) out.push(`- ${line}`);
      if (c.kind === "notes") {
        out.push(`- Image: \`${c.fixture}\`, ${fixture(c.fixture).what}`);
        for (const e of c.expect) out.push(`- Checks: ${e.describe}`);
      }
      out.push(`- First tested ${c.since}`, "");
    }
  }
  out.push("## Fixtures", "", "Reference images in [fixtures/](fixtures/), all made by CultRemix's own image calls.", "", "| Fixture | What it is | Made |", "|---|---|---|");
  for (const f of FIXTURES) out.push(`| \`${f.id}\` | ${f.what} | ${f.origin} |`);
  return `${out.join("\n")}\n`;
}
