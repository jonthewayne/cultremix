#!/usr/bin/env bun
// Records smooth, sharp clips of CultRemix's pages for the demo and pitch videos (B-roll). Each clip
// is a tour of one page: it scrolls in eased steps, and every frame is a screenshot taken after the
// page settles, so scrolling is smooth at 30 frames a second however slow the browser is. Frames
// are encoded to H.264 MP4, which every video editor opens.
//
//   bun run clips                                    dev (localhost:3000), phone size
//   bun run clips -- --base https://cultremix.com    production
//   bun run clips -- --size laptop --only home,work  some clips, laptop size
//   bun run clips -- --list                          what it would record
//
// Signed out, read-only, and free: it never generates or publishes anything. It needs agent-browser
// and an ffmpeg with libx264 (FFMPEG, ~/.cache/cultremix-tools/ffmpeg, or ffmpeg on PATH); Playwright's
// bundled ffmpeg has no H.264, so with it the clips come out as WebM. Clips go to
// ~/cultremix-clips/<date>-<host>/ unless --out says otherwise.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Size = { name: "phone" | "laptop"; width: number; height: number; scale: number };
const SIZES: Record<Size["name"], Size> = {
  phone: { name: "phone", width: 390, height: 844, scale: 3 },
  laptop: { name: "laptop", width: 1280, height: 800, scale: 2 },
};

// A beat: hold still, or scroll to a spot (pixels from the top, a share of the page with "%", or the
// first element whose text starts with "text:...") over ms milliseconds.
type Beat = { hold: number } | { to: number | string; ms: number };
type Clip = { name: string; about: string; url: (found: Found) => string | null; beats: Array<Beat> };
type Found = { work: string | null; family: string | null; profile: string | null };

const CLIPS: Array<Clip> = [
  {
    name: "home",
    about: "The home feed: the headline, then designs with their CR numbers",
    url: () => "/",
    beats: [{ hold: 1500 }, { to: "text:Latest", ms: 2200 }, { hold: 700 }, { to: "45%", ms: 4500 }, { hold: 1000 }],
  },
  {
    name: "work",
    about: "A remix's page: its art, CR number, the drawn shirt, what a remix can change, who shares in a sale, and its fingerprint",
    url: (found) => found.work,
    beats: [
      { hold: 1800 },
      { to: "text:CR ", ms: 1800 },
      { hold: 1400 },
      { to: "text:Remix this", ms: 2600 },
      { hold: 900 },
      { to: "text:Who shares in a sale", ms: 2600 },
      { hold: 1800 },
      { to: "text:Fingerprint", ms: 2200 },
      { hold: 1500 },
    ],
  },
  {
    name: "family",
    about: "A family tree: the original and its remixes",
    url: (found) => found.family,
    beats: [{ hold: 1800 }, { to: "60%", ms: 4000 }, { hold: 1500 }],
  },
  {
    name: "profile",
    about: "A creator's profile and their designs",
    url: (found) => found.profile,
    beats: [{ hold: 1500 }, { to: "50%", ms: 3500 }, { hold: 1200 }],
  },
  {
    name: "onchain",
    about: "What CultRemix records on Monad, and how to check it",
    url: () => "/onchain",
    beats: [{ hold: 1500 }, { to: "text:Where it lives", ms: 4000 }, { hold: 1500 }, { to: "text:Which design is this file", ms: 2200 }, { hold: 1500 }],
  },
  {
    name: "how-it-works",
    about: "The five steps, from making a design to its record on Monad",
    url: () => "/how-it-works",
    beats: [{ hold: 1500 }, { to: "85%", ms: 7000 }, { hold: 1500 }],
  },
];

const FPS = 30;
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const base = (flag("--base") ?? "http://localhost:3000").replace(/\/+$/u, "");
const size = SIZES[(flag("--size") ?? "phone") as Size["name"]];
if (!size) throw new Error("--size is phone or laptop");
const only = flag("--only")?.split(",").map((name) => name.trim());
const clips = CLIPS.filter((clip) => !only || only.includes(clip.name));
if (clips.length === 0) throw new Error("No clips match --only. Clips: " + CLIPS.map((clip) => clip.name).join(", "));

if (argv.includes("--list")) {
  for (const clip of CLIPS) console.log(clip.name.padEnd(13) + clip.about);
  process.exit(0);
}

const session = "cultremix-clips-" + size.name;
const day = new Date().toISOString().slice(0, 10);
const out = flag("--out") ?? join(homedir(), "cultremix-clips", day + "-" + new URL(base).host.replace(/[^a-z0-9.-]/giu, "_"));
mkdirSync(out, { recursive: true });

function ffmpegPath() {
  const candidates = [process.env.FFMPEG, join(homedir(), ".cache", "cultremix-tools", "ffmpeg"), "ffmpeg"].filter(Boolean) as Array<string>;
  for (const path of candidates) {
    const probe = spawnSync(path, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    if (probe.status === 0) return { path, h264: /libx264/u.test(probe.stdout) };
  }
  throw new Error("No ffmpeg found. Set FFMPEG to one with libx264.");
}

function ab(args: Array<string>) {
  const result = spawnSync("agent-browser", args, { encoding: "utf8", env: { ...process.env, AGENT_BROWSER_SESSION: session } });
  if (result.status !== 0) throw new Error("agent-browser " + args[0] + " failed: " + (result.stderr || result.stdout).trim().slice(0, 300));
  return result.stdout.trim();
}

// Runs JavaScript in the page and returns its result, parsed.
function page<T>(js: string): T {
  const raw = ab(["eval", js]);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

function open(path: string) {
  ab(["open", base + path]);
  ab(["wait", "--load", "networkidle"]);
}

// Scrolls the whole page once so lazy images load, waits for them, and returns to the top.
function warm() {
  page("(async () => { const step = innerHeight * 0.8; for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } const until = Date.now() + 8000; while (Date.now() < until && [...document.images].some((i) => !i.complete)) await new Promise((r) => setTimeout(r, 200)); scrollTo(0, 0); await new Promise((r) => setTimeout(r, 600)); return true; })()");
}

// The scroll position a beat's target means on this page.
function target(to: number | string): number {
  if (typeof to === "number") return to;
  if (to.endsWith("%")) {
    const share = Number(to.slice(0, -1)) / 100;
    return page<number>("Math.max(0, (document.documentElement.scrollHeight - innerHeight) * " + share + ")");
  }
  const text = JSON.stringify(to.replace(/^text:/u, "").toLowerCase());
  const found = page<number | null>(
    "(() => { const want = " + text + "; const el = [...document.querySelectorAll('h1,h2,h3,h4,p,span,dt,button,a,div')].find((e) => e.children.length < 4 && (e.innerText || '').trim().toLowerCase().startsWith(want)); if (!el) return null; return Math.max(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.18); })()",
  );
  if (found === null) {
    console.log("    (no " + to + " here; holding)");
    return page<number>("scrollY");
  }
  return Math.min(found, page<number>("document.documentElement.scrollHeight - innerHeight"));
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function record(clip: Clip, path: string, ffmpeg: { path: string; h264: boolean }) {
  const frames = join(out, ".frames-" + clip.name + "-" + size.name);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  open(path);
  warm();
  let n = 0;
  let y = 0;
  const shoot = () => {
    const file = join(frames, String(n++).padStart(5, "0") + ".jpg");
    ab(["screenshot", file, "--screenshot-format", "jpeg", "--screenshot-quality", "92"]);
    return file;
  };
  let last = shoot();
  for (const beat of clip.beats) {
    if ("hold" in beat) {
      for (let i = 1; i < Math.round((beat.hold / 1000) * FPS); i++) copyFileSync(last, join(frames, String(n++).padStart(5, "0") + ".jpg"));
      continue;
    }
    const from = y;
    const to = target(beat.to);
    const count = Math.max(1, Math.round((beat.ms / 1000) * FPS));
    for (let i = 1; i <= count; i++) {
      y = Math.round(from + (to - from) * ease(i / count));
      page("(() => { scrollTo(0, " + y + "); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY)))); })()");
      last = shoot();
    }
  }
  const file = join(out, clip.name + "-" + size.name + (ffmpeg.h264 ? ".mp4" : ".webm"));
  const codec = ffmpeg.h264
    ? // JPEG frames are full-range; editors expect video's standard range (yuv420p, not yuvj420p).
      ["-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-color_range", "tv", "-movflags", "+faststart"]
    : ["-c:v", "libvpx", "-b:v", "8M"];
  const encoded = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(frames, "%05d.jpg"), ...codec, file], { encoding: "utf8" });
  if (encoded.status !== 0) throw new Error("ffmpeg failed: " + encoded.stderr.slice(0, 300));
  rmSync(frames, { recursive: true, force: true });
  return { file, seconds: n / FPS, mb: statSync(file).size / 1e6 };
}

const ffmpeg = ffmpegPath();
ab(["set", "viewport", String(size.width), String(size.height), String(size.scale)]);

// Finds a remix to tour (a design whose number doesn't end in -001), its family, and its creator.
open("/");
const work = page<string | null>("(() => { const links = [...new Set([...document.querySelectorAll('a[href^=\"/cr/\"]')].map((a) => a.getAttribute('href')))]; return links.find((h) => !/-001$/.test(h)) ?? links[0] ?? null; })()");
let family: string | null = null;
let profile: string | null = null;
if (work) {
  open(work);
  family = page<string | null>("(() => { const a = document.querySelector('a[href^=\"/family/\"]'); return a ? a.getAttribute('href') : null; })()") ?? "/family/" + work.split("/").pop()!.split("-")[0];
  profile = page<string | null>("(() => { const a = document.querySelector('main a[href^=\"/u/\"]') || document.querySelector('a[href^=\"/u/\"]'); return a ? a.getAttribute('href') : null; })()");
}
const found: Found = { work, family, profile };
console.log("Recording " + clips.length + " clip(s) of " + base + " at " + size.name + " size (" + size.width * size.scale + " x " + size.height * size.scale + "), " + FPS + " fps, to " + out);

const made: Array<string> = [];
for (const clip of clips) {
  const path = clip.url(found);
  if (!path) {
    console.log("  " + clip.name + ": skipped, nothing to show yet");
    continue;
  }
  const started = Date.now();
  console.log("  " + clip.name + ": " + path);
  const result = record(clip, path, ffmpeg);
  made.push(result.file);
  console.log("    " + result.seconds.toFixed(1) + " s of video, " + result.mb.toFixed(1) + " MB, recorded in " + Math.round((Date.now() - started) / 1000) + " s");
}
ab(["close"]);
console.log("Done: " + made.length + " clip(s) in " + out);
for (const name of readdirSync(out).filter((name) => !name.startsWith(".")).sort()) console.log("  " + name);
