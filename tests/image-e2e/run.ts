// The image test suite's runner: reruns the cases in cases.ts against the pinned models (pin.ts),
// building every prompt with production's own code, and writes a report with a board per case to
// .tmp/image-e2e/runs/<run>/. It costs money (about $2.70 to run every case); see README.md.
//   bun run test:image                         every case, against production's models
//   bun run test:image --group remix,words     some groups
//   bun run test:image --case remix-words      some cases
//   bun run test:image --list                  the cases, without running anything
//   bun run test:image --catalog               rewrite CASES.md
//   bun run test:image --dry-run               notes and prompts only, no images
//   bun run test:image --recheck <run>         check an earlier run's images again, without new ones
//   bun run test:image --image-model <id> --name <name>   another image model
//   bun run test:image --update-baseline       record this run as its baseline
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateway } from "@ai-sdk/gateway";
import sharp from "sharp";
import { batchPrompt } from "../../convex/lib/batchPrompt";
import { cutGrid } from "../../convex/lib/gridCut";
import { gatewayImage } from "../../convex/lib/imageCalls";
import { writeNotes } from "../../convex/lib/notesWriter";
import { stripPngMetadata } from "../../convex/lib/pngMeta";
import { gatewayCostCents, gridWorstCaseCents, photoWorstCaseCents, qualityOf } from "../../convex/lib/pricing";
import { photoPrompt, pickLook } from "../../convex/lib/prompts";
import { compareRemix } from "../../convex/lib/remixCompare";
import { checkWordChanges, proposeRemixFields, wordChangeInstruction } from "../../convex/lib/remixFields";
import { allowedChangesNote, checkPartChanges, partChangeInstruction } from "../../convex/lib/remixParts";
import { decodeToRgba, encodePng } from "../../convex/lib/resize";
import { describePart, proposeParts } from "../../convex/lib/partsReader";
import { readRoles } from "../../convex/lib/roleReader";
import { spellingMisses, wordsToCheck } from "../../convex/lib/spelling";
import { readDesignWords } from "../../convex/lib/wordReader";
import { caseBoard } from "./board";
import { CASES, keepsParts } from "./cases";
import { renderCatalog } from "./catalog";
import { fixture, fixturePath } from "./fixtures";
import { checkImage, readWords, throttled, wordsMatch } from "./judge";
import { PIN } from "./pin";
import type { Answers } from "./judge";
import type { Ask, Case, CompareCase, GenerateCase, KeepsCheck, Notes, NotesCase, PartsCase, PhotoCase, ReaderCase, SpellingCase, WordsCheck } from "./cases";
import type { SpellingMiss } from "../../convex/lib/spelling";
import type { RemixPart } from "../../convex/lib/remixParts";
import type { RemixField } from "../../convex/lib/remixFields";

const SUITE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));

type Args = {
  groups: Array<string>;
  ids: Array<string>;
  list: boolean;
  catalog: boolean;
  dryRun: boolean;
  imageModel?: string;
  quality?: string;
  trials?: number;
  concurrency: number;
  updateBaseline: boolean;
  name?: string;
  force: boolean;
  // An earlier run folder whose grids and photos are checked again in place of new images.
  recheck?: string;
};

function parseArgs(argv: Array<string>): Args {
  const args: Args = { groups: [], ids: [], list: false, catalog: false, dryRun: false, concurrency: 6, updateBaseline: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value.`);
      return next;
    };
    if (flag === "--") continue;
    else if (flag === "--group") args.groups.push(...value().split(","));
    else if (flag === "--case") args.ids.push(...value().split(","));
    else if (flag === "--list") args.list = true;
    else if (flag === "--catalog") args.catalog = true;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--image-model") args.imageModel = value();
    else if (flag === "--quality") args.quality = value();
    else if (flag === "--trials") args.trials = Number(value());
    else if (flag === "--concurrency") args.concurrency = Number(value());
    else if (flag === "--update-baseline") args.updateBaseline = true;
    else if (flag === "--name") args.name = value();
    else if (flag === "--force") args.force = true;
    else if (flag === "--recheck") args.recheck = value();
    else throw new Error(`Unknown option ${flag}. See tests/image-e2e/README.md.`);
  }
  return args;
}

// The gateway key from the environment, or from ~/.config/cultremix/gateway.env. Never printed.
function loadGatewayKey() {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  const file = join(homedir(), ".config", "cultremix", "gateway.env");
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?AI_GATEWAY_API_KEY\s*=\s*(.+?)\s*$/u.exec(line);
    if (match) {
      process.env.AI_GATEWAY_API_KEY = match[1].replace(/^["']|["']$/gu, "");
      return true;
    }
  }
  return false;
}

async function pool<T, R>(items: Array<T>, limit: number, fn: (item: T) => Promise<R>): Promise<Array<R>> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

type Check = { id: string; label: string; passed: boolean; detail: string };
type CaseResult = {
  id: string;
  group: string;
  kind: Case["kind"];
  status: "supported" | "known-limit";
  title: string;
  passed: boolean;
  checks: Array<Check>;
  seconds: number;
  costCents: number;
  board?: string;
  note?: string;
  // Set when the case couldn't run or be checked (no credit, a network failure, the checker not
  // answering). Such a case is neither a pass nor a failure, and never goes into the baseline.
  error?: string;
};

type Context = {
  args: Args;
  runDir: string;
  notes: Map<string, Notes>;
  png: (id: string) => Promise<Uint8Array>;
  check: (args: { design: Uint8Array; refs: Array<{ as: string; bytes: Uint8Array }>; asks: Array<Ask>; readWords: boolean }) => Promise<Answers>;
  spent: { cents: number };
  // Why the run stopped early: the first error that means no further call can work.
  halt: { reason?: string };
};

// Errors that stop the whole run: out of credit, rate limited, or the network down.
const STOPPING = /credit balance|insufficient (funds|credit)|quota|rate.?limit|\b402\b|\b429\b|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|getaddrinfo/iu;

function noteFailure(ctx: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!ctx.halt.reason && STOPPING.test(message)) ctx.halt.reason = message.slice(0, 160);
  return message;
}

// A name in backticks, for Markdown.
const code = (text: string) => "`" + text + "`";
const toBytes = (buffer: Buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);

// With --recheck, the image an earlier run made for a case (its grid or photo).
function earlierImage(runDir: string, caseId: string, name: string) {
  const file = join(runDir, caseId, name);
  if (!existsSync(file)) throw new Error(`The rechecked run has no ${caseId}/${name}.`);
  return toBytes(readFileSync(file));
}

function askChecks(asks: Array<Ask>, answers: Array<Answers | null>, total: number, prefix = ""): Array<Check> {
  return asks.map((ask) => {
    const expect = ask.expect ?? true;
    const matched = answers.filter((answer) => answer?.answers[ask.id] === expect).length;
    const need = ask.min ?? total;
    return {
      id: prefix + ask.id,
      label: `${expect ? "" : "not: "}${ask.ask}`,
      passed: matched >= need,
      detail: `${matched}/${total}${matched < need ? ` (needs ${need})` : ""}`,
    };
  });
}

function wordsChecks(words: WordsCheck | undefined, answers: Array<Answers | null>, total: number): Array<Check> {
  if (!words) return [];
  const results = answers.map((answer) => (answer ? wordsMatch(answer.words, words) : null));
  const matched = results.filter((r) => r?.ok).length;
  const need = words.min ?? total;
  const misses = [...new Set(results.flatMap((r) => (r ? [...r.missing.map((w) => `no ${w}`), ...r.unwanted.map((w) => `has ${w}`)] : [])))];
  return [
    {
      id: "words",
      label: `words ${words.has.join(" ")}${words.not?.length ? `, never ${words.not.join(", ")}` : ""}`,
      passed: matched >= need,
      detail: `${matched}/${total}${misses.length ? ` (${misses.join(", ")})` : ""}`,
    },
  ];
}

// Which checks one design missed, for its board.
function designMisses(asks: Array<Ask>, words: WordsCheck | undefined, answer: Answers | null) {
  if (!answer) return ["checker failed"];
  const misses = asks.filter((ask) => answer.answers[ask.id] !== (ask.expect ?? true)).map((ask) => ask.id);
  if (words) {
    const read = wordsMatch(answer.words, words);
    misses.push(...read.missing.map((w) => `no ${w}`), ...read.unwanted.map((w) => `has ${w}`));
  }
  return misses;
}

// A second look at whatever a design missed, before it counts as a miss: the questions it missed are
// asked once more, and its words read once more. The checker misses about one question in 40 that it
// answers right on another try (2026-10-05). Returns the extra cost.
async function secondLook(
  ctx: Context,
  args: { design: Uint8Array; refs: Array<{ as: string; bytes: Uint8Array }>; asks: Array<Ask>; words?: WordsCheck; answer: Answers | null },
) {
  const { design, refs, asks, words, answer } = args;
  if (!answer) return 0;
  let cents = 0;
  const missed = asks.filter((ask) => answer.answers[ask.id] !== (ask.expect ?? true));
  const wordsMissed = Boolean(words) && !wordsMatch(answer.words, words!).ok;
  const [again, reread] = await Promise.all([
    missed.length ? ctx.check({ design, refs, asks: missed, readWords: false }).catch(() => null) : null,
    wordsMissed ? readWords(PIN.wordReader, design).catch(() => null) : null,
  ]);
  if (again) {
    for (const ask of missed) if (again.answers[ask.id] === (ask.expect ?? true)) answer.answers[ask.id] = again.answers[ask.id];
    cents += again.costCents ?? 0;
  }
  if (reread) {
    if (wordsMatch(reread.words, words!).ok) answer.words = reread.words;
    cents += reread.costCents;
  }
  return cents;
}

// The remix comparison, with up to three tries like production's (convex/remixCheck.ts): during a
// full run, with image calls alongside, some calls ran past its 45-second limit (2026-10-05).
async function compareWithRetries(original: Uint8Array, remix: Uint8Array, allowed?: string) {
  let lastError: unknown = new Error("no answer");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await throttled(() => compareRemix(original, remix, PIN.vision, allowed));
    } catch (error) {
      lastError = error;
      if (STOPPING.test(error instanceof Error ? error.message : String(error))) break;
    }
  }
  throw lastError;
}

// The comparison on one design against image 1, for a case's keeps check: what it read as changed
// ("a new design" when it calls the design a fork).
async function keptParts(original: Uint8Array, design: Uint8Array, keeps: KeepsCheck, allowed?: string) {
  const result = await compareWithRetries(original, design, allowed);
  const misses = keeps.parts.filter((part) => result[part] !== "same").map((part) => `${part} ${result[part] ?? "not judged"}`);
  if (result.verdict !== "variation") misses.unshift("a new design");
  return { misses, costCents: result.costCents ?? 0 };
}

function keepsChecks(keeps: KeepsCheck | undefined, kept: Array<{ misses: Array<string> } | null>, total: number): Array<Check> {
  if (!keeps) return [];
  const matched = kept.filter((k) => k && k.misses.length === 0).length;
  const need = keeps.min ?? total;
  const notes = [...(matched < need ? [`needs ${need}`] : []), ...new Set(kept.flatMap((k) => k?.misses ?? []))];
  return [
    {
      id: "keeps",
      label: `the remix comparison calls it image 1's design with the same ${keepsParts(keeps)}`,
      passed: matched >= need,
      detail: `${matched}/${total}${notes.length ? ` (${notes.join("; ")})` : ""}`,
    },
  ];
}

// The studio's word boxes for a remix: each edit names the words it changes. A whole box matches
// first; otherwise the word inside a box. Checked the way studio.generate checks them.
function editWordBoxes(fields: Array<RemixField>, edits: Array<{ from: string; to: string }>) {
  const norm = (text: string) => text.replace(/\s+/gu, " ").trim().toUpperCase();
  const pattern = (word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu");
  const texts = new Map<string, string>();
  const unmatched: Array<string> = [];
  for (const edit of edits) {
    const whole = fields.find((f) => !texts.has(f.id) && norm(f.text) === norm(edit.from));
    if (whole) {
      texts.set(whole.id, edit.to);
      continue;
    }
    const inside = fields.find((f) => pattern(edit.from).test(texts.get(f.id) ?? f.text));
    if (!inside) {
      unmatched.push(edit.from);
      continue;
    }
    const replaced = (texts.get(inside.id) ?? inside.text).replace(pattern(edit.from), (_m, lead: string) => `${lead}${edit.to}`);
    texts.set(inside.id, replaced.split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).filter(Boolean).join("\n"));
  }
  const asked = [...texts].map(([fieldId, text]) => ({ fieldId, text }));
  return { asked, unmatched, checked: checkWordChanges(fields, asked) };
}

async function runGenerate(c: GenerateCase, ctx: Context): Promise<CaseResult> {
  const started = Date.now();
  const dir = join(ctx.runDir, c.id);
  mkdirSync(dir, { recursive: true });
  const numbered = c.images ?? [];
  // A remix's part photos come right after the numbered images, as production numbers them.
  const partPhotos = (c.remix?.parts?.fill ?? []).flatMap((f) => (f.photos ?? []).map((id) => ({ id, partId: f.partId })));
  const mixerOnly = (c.mixer ?? []).map((m) => m.fixture).filter((id) => !numbered.includes(id));
  const order = [...numbered, ...partPhotos.map((p) => p.id), ...mixerOnly];
  const partLabel = (i: number) => {
    const photo = i >= numbered.length && i < numbered.length + partPhotos.length ? partPhotos[i - numbered.length] : null;
    return photo ? c.remix?.parts?.list.find((p) => p.id === photo.partId)?.label : undefined;
  };
  const attachments = order.map((id, i) => {
    const notes = ctx.notes.get(id);
    return {
      analysis: notes ? ("ready" as const) : ("failed" as const),
      summary: notes?.summary,
      kind: notes?.kind,
      notes: notes?.notes,
      styleOnly: i >= numbered.length + partPhotos.length,
      partFor: partLabel(i),
    };
  });
  const styles = (c.mixer ?? []).map((m) => ({ attachment: order.indexOf(m.fixture) + 1, weight: m.weight }));
  const checks: Array<Check> = [];
  const base = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title } as const;
  let wordChanges: string | undefined;
  if (c.remix?.words?.length) {
    const fields = proposeRemixFields(ctx.notes.get(numbered[0])?.notes);
    const edited = editWordBoxes(fields, c.remix.words);
    const ok = edited.unmatched.length === 0 && edited.checked.ok;
    checks.push({
      id: "boxes",
      label: "the notes offer the edited words as boxes",
      passed: ok,
      detail: !edited.checked.ok
        ? edited.checked.problem
        : edited.unmatched.length
          ? `not found: ${edited.unmatched.join(", ")} (boxes: ${fields.map((f) => f.text.replace(/\n/gu, " / ")).join("; ")})`
          : edited.checked.changes.map((ch) => `${ch.label}: ${ch.from.replace(/\n/gu, " / ")} to ${ch.to.replace(/\n/gu, " / ") || "(removed)"}`).join("; "),
    });
    if (!ok || !edited.checked.ok) {
      return { ...base, passed: false, checks, seconds: (Date.now() - started) / 1000, costCents: 0, error: "The remix's word boxes didn't match the notes." };
    }
    wordChanges = wordChangeInstruction(fields, edited.checked.changes);
  }
  let partChanges: string | undefined;
  if (c.remix?.parts) {
    const { list, fill } = c.remix.parts;
    const checked = checkPartChanges(list, fill.map((f) => ({ partId: f.partId, to: f.to, photos: (f.photos ?? []).map((id) => ({ imageId: id, key: id })) })));
    checks.push({ id: "parts", label: "the remix's parts pass the creator's rules", passed: checked.ok, detail: checked.ok ? checked.changes.map((ch) => ch.label).join(", ") : checked.problem });
    if (!checked.ok) return { ...base, passed: false, checks, seconds: (Date.now() - started) / 1000, costCents: 0, error: "The remix's parts didn't pass." };
    const numbers = new Map<string, Array<number>>();
    partPhotos.forEach((photo, i) => numbers.set(photo.partId, [...(numbers.get(photo.partId) ?? []), numbered.length + i + 1]));
    partChanges = partChangeInstruction(list, checked.changes, numbers);
  }
  // The request reader inside batchPrompt has a 10-second limit, so it waits its turn with the other calls.
  const prompt = await throttled(() => batchPrompt({ instruction: c.request, presets: [], attachments, styles, remixOfParent: Boolean(c.remix), wordChanges, partChanges }));
  writeFileSync(join(dir, "prompt.txt"), prompt.text);
  const roles = `read as ${prompt.roles.join("/") || "no images"}${prompt.styleHair ? ", style hair" : ""}${prompt.read ? "" : " (phrases)"}`;
  if (ctx.args.dryRun) {
    return { ...base, passed: true, checks, seconds: (Date.now() - started) / 1000, costCents: 0, note: `dry run; ${roles}; ${prompt.text.length} characters` };
  }
  let cost = 0;
  let grid: Uint8Array;
  if (ctx.args.recheck) {
    grid = earlierImage(ctx.args.recheck, c.id, "grid.png");
  } else {
    const inputs = await Promise.all(order.map((id) => ctx.png(id)));
    const out = await gatewayImage({
      text: prompt.text,
      images: inputs,
      size: PIN.gridSize,
      background: "transparent",
      quality: ctx.args.quality ?? PIN.gridQuality,
      model: ctx.args.imageModel,
    });
    cost = gatewayCostCents(out.providerMetadata) ?? 0;
    grid = stripPngMetadata(out.bytes);
  }
  writeFileSync(join(dir, "grid.png"), grid);
  const rgba = await decodeToRgba(grid);
  let clear = 0;
  for (let i = 3; i < rgba.data.length; i += 4) if (rgba.data[i] === 0) clear++;
  const clearShare = clear / (rgba.width * rgba.height);
  const cells = cutGrid(rgba);
  const designs = await Promise.all(cells.map(async (cell) => (cell.tile ? encodePng(cell.tile) : null)));
  designs.forEach((design, i) => {
    if (design) writeFileSync(join(dir, `design-${i + 1}.png`), design);
  });
  const cut = designs.filter(Boolean).length;
  checks.push({ id: "cut", label: "four designs cut from one grid", passed: cut === 4, detail: `${cut}/4` });
  checks.push({ id: "transparent", label: "a transparent background", passed: clearShare >= 0.15, detail: `${Math.round(clearShare * 100)}% clear` });
  const refs = await Promise.all((c.shows ?? []).map(async (shown) => ({ as: shown.as, bytes: await ctx.png(shown.fixture) })));
  const original = c.keeps ? await ctx.png(numbered[0]) : null;
  // Why a design went unchecked, for the report.
  let checkFailure: string | undefined;
  const [answers, kept] = await Promise.all([
    Promise.all(
      designs.map((design) =>
        design
          ? ctx.check({ design, refs, asks: c.asks, readWords: Boolean(c.words) }).catch((error) => {
              checkFailure ??= noteFailure(ctx, error);
              return null;
            })
          : Promise.resolve(null),
      ),
    ),
    Promise.all(
      designs.map((design) =>
        design && original && c.keeps
          ? keptParts(original, design, c.keeps, c.remix?.parts ? allowedChangesNote(c.remix.parts.list) : undefined).catch((error) => {
              checkFailure ??= noteFailure(ctx, error);
              return null;
            })
          : Promise.resolve(null),
      ),
    ),
  ]);
  const unchecked = designs.some((design, i) => design && (!answers[i] || (c.keeps && !kept[i])));
  const extra = await Promise.all(
    answers.map((answer, i) => (designs[i] ? secondLook(ctx, { design: designs[i]!, refs, asks: c.asks, words: c.words, answer }) : 0)),
  );
  cost += extra.reduce((sum, cents) => sum + cents, 0);
  checks.push(...wordsChecks(c.words, answers, 4), ...keepsChecks(c.keeps, kept, 4), ...askChecks(c.asks, answers, 4));
  if (c.gridAsks?.length) {
    const gridAnswer = await ctx.check({ design: grid, refs: [], asks: c.gridAsks, readWords: false }).catch((error) => {
      noteFailure(ctx, error);
      return null;
    });
    checks.push(...askChecks(c.gridAsks, [gridAnswer], 1, "grid:"));
  }
  cost += answers.reduce((sum, a) => sum + (a?.costCents ?? 0), 0);
  cost += kept.reduce((sum, k) => sum + (k?.costCents ?? 0), 0);
  const board = join(dir, "board.png");
  await caseBoard({
    title: c.title,
    lines: [
      `Request: ${c.request || "(nothing typed)"}`,
      ...(c.remix?.words?.length ? [`Word boxes: ${c.remix.words.map((w) => (w.to ? `${w.from} to ${w.to}` : `${w.from} emptied`)).join(", ")}`] : []),
      roles,
      checks.map((check) => `${check.passed ? "✓" : "✗"} ${check.id} ${check.detail}`).join("   "),
    ],
    inputs: await Promise.all(
      order.map(async (id, i) => {
        const weight = c.mixer?.find((m) => m.fixture === id)?.weight;
        const part = partLabel(i);
        const label = i < numbered.length ? `image ${i + 1}${weight ? `, style ${weight}` : ""}` : part ? `image ${i + 1}, ${part}` : `style ${weight}`;
        return { label, bytes: await ctx.png(id) };
      }),
    ),
    designs: designs.map((design, i) => {
      const keptMisses = c.keeps ? (kept[i]?.misses ?? ["comparison failed"]) : [];
      const misses = design ? [...designMisses(c.asks, c.words, answers[i]), ...keptMisses] : ["no design"];
      return { bytes: design, ok: misses.length === 0, misses };
    }),
    out: board,
  });
  return {
    ...base,
    passed: !unchecked && checks.every((check) => check.passed),
    checks,
    seconds: (Date.now() - started) / 1000,
    costCents: cost,
    board,
    note: roles,
    error: unchecked ? `The checker or the remix comparison didn't answer for every design: ${(checkFailure ?? "no answer").slice(0, 120)}` : undefined,
  };
}

async function runPhoto(c: PhotoCase, ctx: Context): Promise<CaseResult> {
  const started = Date.now();
  const dir = join(ctx.runDir, c.id);
  mkdirSync(dir, { recursive: true });
  const base = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title } as const;
  const art = await ctx.png(c.design);
  const text = photoPrompt(c.shirt, pickLook(`suite:${c.id}`, []), c.garment);
  writeFileSync(join(dir, "prompt.txt"), text);
  if (ctx.args.dryRun) return { ...base, passed: true, checks: [], seconds: 0, costCents: 0, note: "dry run" };
  let photo: Uint8Array;
  let cents = 0;
  if (ctx.args.recheck) {
    photo = earlierImage(ctx.args.recheck, c.id, "photo.png");
  } else {
    const out = await gatewayImage({ text, images: [art], size: PIN.photoSize, background: "opaque", quality: PIN.photoQuality, model: ctx.args.imageModel });
    cents = gatewayCostCents(out.providerMetadata) ?? 0;
    photo = stripPngMetadata(out.bytes);
  }
  writeFileSync(join(dir, "photo.png"), photo);
  const photoRefs = [{ as: "the design", bytes: art }];
  const answer = await ctx.check({ design: photo, refs: photoRefs, asks: c.asks, readWords: Boolean(c.words) }).catch((error) => {
    noteFailure(ctx, error);
    return null;
  });
  cents += await secondLook(ctx, { design: photo, refs: photoRefs, asks: c.asks, words: c.words, answer });
  const checks = [...wordsChecks(c.words, [answer], 1), ...askChecks(c.asks, [answer], 1)];
  const board = join(dir, "board.png");
  const misses = designMisses(c.asks, c.words, answer);
  await caseBoard({
    title: c.title,
    lines: [checks.map((check) => `${check.passed ? "✓" : "✗"} ${check.id} ${check.detail}`).join("   ")],
    inputs: [{ label: "the design", bytes: art }],
    designs: [{ bytes: photo, ok: misses.length === 0, misses }],
    out: board,
  });
  const cost = cents + (answer?.costCents ?? 0);
  return {
    ...base,
    passed: Boolean(answer) && checks.every((check) => check.passed),
    checks,
    seconds: (Date.now() - started) / 1000,
    costCents: cost,
    board,
    error: answer ? undefined : "The checker didn't answer.",
  };
}

// A notes case's reading: the fixture's shared notes, or its own when it has a request.
function notesKey(c: NotesCase) {
  return c.request ? `${c.fixture}#${c.id}` : c.fixture;
}

function runNotes(c: NotesCase, ctx: Context): CaseResult {
  const base = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title } as const;
  const notes = ctx.notes.get(notesKey(c));
  if (!notes) return { ...base, passed: false, checks: [], seconds: 0, costCents: 0, error: "No notes were written." };
  const checks = c.expect.map((e) => {
    let passed = false;
    try {
      passed = e.test(notes);
    } catch {
      passed = false;
    }
    return { id: e.id, label: e.describe, passed, detail: passed ? "yes" : "no" };
  });
  return { ...base, passed: checks.every((check) => check.passed), checks, seconds: 0, costCents: 0, note: `notes/${c.request ? c.id : c.fixture}.txt` };
}

async function runReader(c: ReaderCase, ctx: Context): Promise<CaseResult> {
  const started = Date.now();
  const base = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title } as const;
  const trials = ctx.args.trials ?? 2;
  const describe = (id: string) => ({ summary: fixture(id).what, kind: fixture(id).kind });
  const accepted = new Set(c.roles.flatMap((roles) => (c.styleHair ?? [false]).map((hair) => `${roles.join("/")}${hair ? "+hair" : ""}`)));
  const answers = await Promise.all(
    Array.from({ length: trials }, async () => {
      const read = await throttled(() => readRoles({ instruction: c.request, images: c.images.map(describe), mixer: (c.mixer ?? []).map(describe), remix: false }));
      return read ? `${read.roles.join("/")}${read.styleHair ? "+hair" : ""}` : "no answer";
    }),
  );
  const matched = answers.filter((a) => accepted.has(a)).length;
  const need = Math.min(c.min ?? trials, trials);
  const checks = [{ id: "read", label: `reads it as ${[...accepted].join(" or ")}`, passed: matched >= need, detail: `${matched}/${trials}: ${answers.join(", ")}` }];
  // The reader returns nothing when its call fails; that's not a wrong answer.
  const silent = answers.includes("no answer");
  return {
    ...base,
    passed: !silent && matched >= need,
    checks,
    seconds: (Date.now() - started) / 1000,
    costCents: 0,
    error: silent ? "The reader didn't answer every try." : undefined,
  };
}

async function runCompare(c: CompareCase, ctx: Context): Promise<CaseResult> {
  const started = Date.now();
  const base = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title } as const;
  const trials = ctx.args.trials ?? 2;
  const [original, remix] = await Promise.all([ctx.png(c.original), ctx.png(c.remix)]);
  const verdicts = await Promise.all(
    Array.from({ length: trials }, async () => {
      try {
        const result = await compareWithRetries(original, remix);
        ctx.spent.cents += result.costCents ?? 0;
        return { verdict: result.verdict as string, reason: result.reason };
      } catch (error) {
        return { verdict: "error", reason: noteFailure(ctx, error) };
      }
    }),
  );
  const matched = verdicts.filter((v) => (c.expect === "either" ? v.verdict !== "error" : v.verdict === c.expect)).length;
  const checks = [{ id: "verdict", label: `reads as ${c.expect}`, passed: matched === trials, detail: `${matched}/${trials}: ${verdicts.map((v) => v.verdict).join(", ")}` }];
  const failedCall = verdicts.find((v) => v.verdict === "error");
  return {
    ...base,
    passed: !failedCall && matched === trials,
    checks,
    seconds: (Date.now() - started) / 1000,
    costCents: 0,
    note: verdicts[0]?.reason,
    error: failedCall ? `The comparison failed: ${failedCall.reason.slice(0, 120)}` : undefined,
  };
}

// The remixable parts reader on a fixture's notes, as production runs it (convex/lib/partsReader.ts):
// the parts it proposes, or the one part a creator's words describe. Every try must pass every check.
async function runParts(c: PartsCase, ctx: Context): Promise<CaseResult> {
  const started = Date.now();
  const base = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title } as const;
  const notes = ctx.notes.get(c.fixture);
  if (!notes) return { ...base, passed: false, checks: [], seconds: 0, costCents: 0, error: "No notes were written." };
  const trials = ctx.args.trials ?? 2;
  const tries = await Promise.all(
    Array.from({ length: trials }, async () => {
      const read = await throttled(async () =>
        c.words === undefined ? await proposeParts(notes.notes) : await describePart(notes.notes, c.words, []).then((part) => (part ? [part] : null)),
      );
      return read;
    }),
  );
  const answered = tries.filter((parts): parts is Array<RemixPart> => parts !== null);
  const checks = c.expect.map((e) => {
    const matched = answered.filter((parts) => {
      try {
        return e.test(parts);
      } catch {
        return false;
      }
    }).length;
    return { id: e.id, label: e.describe, passed: matched === trials, detail: `${matched}/${trials}` };
  });
  const shown = answered.map((parts) => parts.map((p) => `${p.kind} ${p.label}${p.count ? ` (${p.count}${p.max ? `, up to ${p.max}` : ""})` : ""}: ${p.text}`).join("; ") || "none");
  return {
    ...base,
    passed: answered.length === trials && checks.every((check) => check.passed),
    checks,
    seconds: (Date.now() - started) / 1000,
    costCents: 0,
    note: shown[0],
    error: answered.length < trials ? "The parts reader didn't answer every try." : undefined,
  };
}

// The studio's spelling check on a finished design, as convex/spellingCheck.ts runs it: the words its
// request asked for, its lettering read back (a failed reading tried once more), and the asked words
// it drew a letter or two off. Every try (two by default) must flag exactly the case's words.
type Reading = { words: Array<string>; misses: Array<SpellingMiss> } | { error: string };
async function runSpelling(c: SpellingCase, ctx: Context): Promise<CaseResult> {
  const started = Date.now();
  const base = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title } as const;
  const trials = ctx.args.trials ?? 2;
  const asked = wordsToCheck({ instruction: c.request, wordChanges: (c.wordChanges ?? []).map((to) => ({ to })) });
  const design = await ctx.png(c.fixture);
  const reads = await Promise.all(
    Array.from({ length: trials }, async (): Promise<Reading> => {
      let lastError = "The reading failed.";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { words, costCents } = await throttled(() => readDesignWords(design, PIN.wordReader));
          ctx.spent.cents += costCents ?? 0;
          return { words, misses: spellingMisses(asked, words) };
        } catch (error) {
          lastError = noteFailure(ctx, error);
          if (STOPPING.test(lastError)) break;
        }
      }
      return { error: lastError };
    }),
  );
  const want = [...c.flags].sort().join(",");
  const matched = reads.filter((read) => "misses" in read && read.misses.map((m) => m.asked).sort().join(",") === want).length;
  const shown = reads.map((read) => ("misses" in read ? read.misses.map((m) => `${m.asked} as ${m.read}`).join(", ") || "none" : "no reading"));
  const checks = [
    { id: "flags", label: c.flags.length ? `flags ${c.flags.join(", ")}` : "flags nothing", passed: matched === trials, detail: `${matched}/${trials}: ${shown.join("; ")}` },
  ];
  const failed = reads.find((read) => "error" in read);
  const first = reads.find((read) => "words" in read);
  return {
    ...base,
    passed: !failed && matched === trials,
    checks,
    seconds: (Date.now() - started) / 1000,
    costCents: 0,
    note: first && "words" in first ? `read: ${first.words.join(" / ")}` : undefined,
    error: failed && "error" in failed ? `The word reader failed: ${failed.error.slice(0, 120)}` : undefined,
  };
}

type Baseline = {
  name: string;
  models: { withImages: string; textOnly: string; quality: string; vision: string; words?: string };
  recordedAt: string;
  cases: Record<string, { passed: boolean; checks: Record<string, string> }>;
};

function baselineFile(name: string) {
  return join(SUITE_DIR, "baselines", `${name}.json`);
}

function readBaseline(name: string): Baseline | null {
  const file = baselineFile(name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Baseline) : null;
}

function selected(args: Args) {
  const unknown = args.ids.filter((id) => !CASES.some((c) => c.id === id));
  if (unknown.length) throw new Error(`No case ${unknown.join(", ")}. bun run test:image --list shows them.`);
  return CASES.filter((c) => (args.groups.length === 0 || args.groups.includes(c.group)) && (args.ids.length === 0 || args.ids.includes(c.id)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.catalog) {
    writeFileSync(join(SUITE_DIR, "CASES.md"), renderCatalog());
    console.log("Wrote tests/image-e2e/CASES.md");
    return;
  }
  const cases = selected(args);
  if (args.list) {
    for (const c of cases) console.log(`${c.group.padEnd(8)} ${c.id.padEnd(44)} ${c.title}${c.status === "known-limit" ? " (known limit)" : ""}`);
    console.log(`${cases.length} cases`);
    return;
  }
  if (!loadGatewayKey()) throw new Error("No AI_GATEWAY_API_KEY in the environment or ~/.config/cultremix/gateway.env.");
  if (args.recheck) {
    const earlier = [args.recheck, join(REPO_DIR, ".tmp", "image-e2e", "runs", args.recheck)].find((dir) => existsSync(join(dir, "results.json")));
    if (!earlier) throw new Error(`No earlier run at ${args.recheck}.`);
    args.recheck = earlier;
  }
  const name = args.name ?? (args.imageModel ? args.imageModel.replace(/^.*\//u, "") : PIN.name);
  const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace("T", "-").slice(0, 13);
  const runDir = join(REPO_DIR, ".tmp", "image-e2e", "runs", `${stamp}-${name}${args.recheck ? "-recheck" : ""}`);
  mkdirSync(join(runDir, "notes"), { recursive: true });
  const grids = cases.filter((c): c is GenerateCase => c.kind === "generate");
  const quality = qualityOf(args.quality, PIN.gridQuality);
  const estimate = args.recheck
    ? 0
    : grids.reduce((sum, c) => sum + gridWorstCaseCents(new Set([...(c.images ?? []), ...(c.mixer ?? []).map((m) => m.fixture)]).size, quality), 0) +
      cases.filter((c) => c.kind === "photo").length * photoWorstCaseCents();
  console.log(
    `${cases.length} cases against ${args.imageModel ?? `${PIN.imageWithImages} / ${PIN.imageTextOnly}`} (${quality})${
      args.dryRun ? ", dry run" : args.recheck ? `, rechecking the images in ${args.recheck}` : `, images up to about $${(estimate / 100).toFixed(2)}`
    }`,
  );

  // The gateway refuses every call once its credit runs out, so a run checks the balance first.
  // The checker and the text calls add about a quarter to the image estimate.
  const needCents = args.dryRun || args.recheck ? 25 : Math.ceil(estimate * 1.25) + 30;
  const balance = await gateway
    .getCredits()
    .then((credits) => Number.parseFloat(credits.balance))
    .catch(() => null);
  if (balance === null) {
    console.log("Couldn't read the CultRemix Gateway balance; running anyway.");
  } else {
    console.log(`CultRemix Gateway balance: $${balance.toFixed(2)}`);
    if (balance * 100 < needCents && !args.force) {
      throw new Error(
        `This run needs about $${(needCents / 100).toFixed(2)} of gateway credit and the balance is $${balance.toFixed(2)}. Add credit, or run fewer cases with --group or --case (--force runs anyway).`,
      );
    }
  }
  console.log(`Run folder: ${runDir}`);

  const started = Date.now();
  const pngs = new Map<string, Promise<Uint8Array>>();
  const png = (id: string) => {
    let bytes = pngs.get(id);
    if (!bytes) {
      bytes = sharp(readFileSync(fixturePath(id))).png().toBuffer().then(toBytes);
      pngs.set(id, bytes);
    }
    return bytes;
  };
  const spent = { cents: 0 };
  const check: Context["check"] = async (input) => {
    const answer = await checkImage({ model: PIN.checker, wordModel: PIN.wordReader, ...input });
    return answer;
  };

  // Notes for every image the cases use, written by production's notes writer. A notes case with a
  // request gets its own reading, made with it, as a published design's notes are.
  const needNotes = new Set<string>();
  for (const c of cases) {
    if (c.kind === "generate") for (const id of [...(c.images ?? []), ...(c.mixer ?? []).map((m) => m.fixture)]) needNotes.add(id);
    if ((c.kind === "notes" && !c.request) || c.kind === "parts") needNotes.add(c.fixture);
  }
  const notes = new Map<string, Notes>();
  const keep = (key: string, file: string, result: Awaited<ReturnType<typeof writeNotes>>) => {
    if (!result.ok || !result.notes) return;
    notes.set(key, { summary: result.summary, kind: result.kind, notes: result.notes });
    writeFileSync(join(runDir, "notes", file), `Summary: ${result.summary ?? ""}\nKind: ${result.kind ?? ""}\n\n${result.notes}\n`);
  };
  await pool([...needNotes], 6, async (id) => keep(id, `${id}.txt`, await writeNotes(await png(id), PIN.vision)));
  const withRequest = cases.filter((c): c is NotesCase => c.kind === "notes" && Boolean(c.request));
  await pool(withRequest, 6, async (c) => keep(notesKey(c), `${c.id}.txt`, await writeNotes(await png(c.fixture), PIN.vision, c.request)));
  if (needNotes.size) console.log(`Notes written for ${[...needNotes].filter((id) => notes.has(id)).length} of ${needNotes.size} images.`);
  if (withRequest.length) console.log(`Notes with a request written for ${withRequest.filter((c) => notes.has(notesKey(c))).length} of ${withRequest.length} cases.`);

  const halt: Context["halt"] = {};
  const ctx: Context = { args, runDir, notes, png, check, spent, halt };
  if ([...needNotes].some((id) => !notes.has(id))) console.log(`Notes missing for ${[...needNotes].filter((id) => !notes.has(id)).join(", ")}.`);
  const run = async (c: Case): Promise<CaseResult> => {
    const blank = { id: c.id, group: c.group, kind: c.kind, status: c.status ?? "supported", title: c.title, passed: false, checks: [], seconds: 0, costCents: 0 } as const;
    if (halt.reason) {
      console.log(`SKIP  ${c.id}`);
      return { ...blank, checks: [], error: `Skipped: ${halt.reason}` };
    }
    try {
      const result =
        c.kind === "generate"
          ? await runGenerate(c, ctx)
          : c.kind === "photo"
            ? await runPhoto(c, ctx)
            : c.kind === "notes"
              ? runNotes(c, ctx)
              : c.kind === "reader"
                ? await runReader(c, ctx)
                : c.kind === "compare"
                  ? await runCompare(c, ctx)
                  : c.kind === "parts"
                    ? await runParts(c, ctx)
                    : await runSpelling(c, ctx);
      const mark = result.error ? "ERROR" : result.passed ? "PASS" : result.status === "known-limit" ? "LIMIT" : "FAIL";
      const detail = result.error ?? result.checks.filter((k) => !k.passed).map((k) => `${k.id} ${k.detail}`).join("; ");
      console.log(`${mark.padEnd(5)} ${c.id.padEnd(44)} ${detail}`);
      return result;
    } catch (error) {
      const message = noteFailure(ctx, error);
      console.log(`ERROR ${c.id.padEnd(44)} ${message.slice(0, 160)}`);
      return { ...blank, checks: [], error: message };
    }
  };
  // Image calls run args.concurrency at a time; the cheap text calls alongside them.
  const heavy = cases.filter((c) => c.kind === "generate" || c.kind === "photo");
  const light = cases.filter((c) => c.kind !== "generate" && c.kind !== "photo");
  const [heavyResults, lightResults] = await Promise.all([pool(heavy, args.concurrency, run), pool(light, 8, run)]);
  const results = cases.map((c) => [...heavyResults, ...lightResults].find((r) => r.id === c.id)!);

  const minutes = (Date.now() - started) / 60000;
  const cost = results.reduce((sum, r) => sum + r.costCents, 0) + spent.cents;
  // Cases that couldn't run or be checked are counted apart from passes and failures.
  const errored = results.filter((r) => r.error);
  const ran = results.filter((r) => !r.error);
  const supported = ran.filter((r) => r.status === "supported");
  const failed = supported.filter((r) => !r.passed);
  const limits = ran.filter((r) => r.status === "known-limit");

  // Against the pin's baseline.
  const baseline = readBaseline(PIN.name);
  const newlyFailing = baseline ? ran.filter((r) => baseline.cases[r.id]?.passed && !r.passed) : [];
  const newlyPassing = baseline ? ran.filter((r) => baseline.cases[r.id] && !baseline.cases[r.id].passed && r.passed) : [];

  const models = {
    withImages: args.imageModel ?? PIN.imageWithImages,
    textOnly: args.imageModel ?? PIN.imageTextOnly,
    quality,
    vision: PIN.vision,
    words: PIN.wordReader,
  };
  const summary =
    `${supported.length - failed.length} of ${supported.length} supported cases passed` +
    (limits.length ? `; known limits: ${limits.filter((r) => r.passed).length} of ${limits.length} passed` : "") +
    (errored.length ? `; ${errored.length} couldn't run or be checked` : "");
  const report = [
    `# Image test suite: ${name}`,
    "",
    `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, ${minutes.toFixed(1)} min, about $${(cost / 100).toFixed(2)}${args.dryRun ? " (dry run)" : ""}.`,
    `Images: \`${models.withImages}\` with images, \`${models.textOnly}\` without, ${PIN.gridSize} at ${quality}. Notes, reader, comparison, and checker: \`${PIN.vision}\`; words read by \`${PIN.wordReader}\`.${args.recheck ? ` Images from ${args.recheck}, checked again.` : ""}`,
    "",
    `**${summary}.**`,
    "",
    ...(halt.reason ? [`The run stopped early: ${halt.reason}`, ""] : []),
    ...(baseline
      ? [
          `Against the ${baseline.name} baseline (${baseline.recordedAt.slice(0, 10)}): ${newlyFailing.length ? "newly failing " + newlyFailing.map((r) => code(r.id)).join(", ") : "nothing newly failing"}; ${newlyPassing.length ? "newly passing " + newlyPassing.map((r) => code(r.id)).join(", ") : "nothing newly passing"}.`,
          "",
        ]
      : ["No baseline yet for this pin.", ""]),
    "| Case | Group | Result | Checks |",
    "|---|---|---|---|",
    ...results.map((r) => {
      const mark = r.error ? "couldn't run" : r.passed ? "pass" : r.status === "known-limit" ? "known limit" : "**fail**";
      const detail = r.error ? r.error.slice(0, 120) : r.checks.map((k) => `${k.passed ? "" : "✗ "}${k.id} ${k.detail}`).join("; ");
      return `| ${r.board ? `[${r.id}](${r.id}/board.png)` : r.id} | ${r.group} | ${mark} | ${detail.replace(/\|/gu, "/")} |`;
    }),
    "",
  ].join("\n");
  writeFileSync(join(runDir, "report.md"), report);
  writeFileSync(join(runDir, "results.json"), JSON.stringify({ name, models, results }, null, 1));
  console.log(`\n${summary}. ${minutes.toFixed(1)} min, about $${(cost / 100).toFixed(2)}.`);
  if (halt.reason) console.log(`The run stopped early: ${halt.reason}`);
  if (newlyFailing.length) console.log(`Newly failing against the baseline: ${newlyFailing.map((r) => r.id).join(", ")}`);
  if (newlyPassing.length) console.log(`Newly passing against the baseline: ${newlyPassing.map((r) => r.id).join(", ")}`);
  console.log(`Report: ${join(runDir, "report.md")}`);

  if (args.updateBaseline && !args.dryRun) {
    const previous = readBaseline(name);
    const next: Baseline = {
      name,
      models,
      recordedAt: new Date().toISOString(),
      cases: { ...(previous?.cases ?? {}) },
    };
    // Only cases that ran and were checked; the rest keep their previous entry.
    for (const r of ran) next.cases[r.id] = { passed: r.passed, checks: Object.fromEntries(r.checks.map((k) => [k.id, k.detail])) };
    mkdirSync(join(SUITE_DIR, "baselines"), { recursive: true });
    writeFileSync(baselineFile(name), `${JSON.stringify(next, null, 1)}\n`);
    console.log(`Baseline written for ${ran.length} cases: tests/image-e2e/baselines/${name}.json`);
  }
  if (failed.length || errored.length) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
