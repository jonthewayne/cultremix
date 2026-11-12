#!/usr/bin/env bun
// Captures every screen of CultRemix, in the order someone meets them, at desktop (1440 px) and
// phone (390 px) widths, and writes a screen viewer beside the pictures:
//
//   bun run screens                      the local dev server (http://localhost:3000) on the dev deployment
//   bun run screens -- --no-generate     skip the one real batch (saves about 12 cents of image credit)
//   BASE_URL=... bun run screens          another server on the same dev deployment
//
// Signed-in screens use a temporary member (e2e+...@example.com), signed up through the real
// email code, given owner access for the admin screens, and removed with what it made at the end
// (scripts/e2e-helper.ts, which needs TEST_HELPER_SECRET in .env.local). It never publishes, so it
// adds nothing to the feed or to Monad. Output: .tmp/screens/ (index.html, manifest.js, shots/).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { optimize } from "./optimize";

const args = process.argv.slice(2);
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/u, "");
// Absolute: agent-browser reads a path starting with "." as a CSS selector and saves elsewhere.
const OUT = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : ".tmp/screens");
const GENERATE = !args.includes("--no-generate");
const SESSION = "screens-" + Date.now();
const stamp = String(Date.now()) + String(Math.floor(Math.random() * 1000));
const EMAIL = "e2e+" + stamp + "@example.com";
const NAME = "newremixer" + stamp.slice(-4);
const PROMPT = "A retro surf club badge that says SALT DAYS, sunset colors, bold hand-lettering";

const VIEWPORTS = [
  { key: "desktop", width: 1440, height: 900 },
  { key: "phone", width: 390, height: 844 },
] as const;

type Entry = {
  id: string;
  group: string;
  title: string;
  description: string;
  path: string;
  shots: Partial<Record<"desktop" | "phone", string>>;
  error?: string;
};
const entries: Array<Entry> = [];

rmSync(join(OUT, "shots"), { recursive: true, force: true });
mkdirSync(join(OUT, "shots"), { recursive: true });

function ab(cmd: Array<string>, allowFail = false): string {
  const res = spawnSync("agent-browser", cmd, {
    env: { ...process.env, AGENT_BROWSER_SESSION: SESSION },
    encoding: "utf8",
    timeout: 180_000,
  });
  if (res.status !== 0 && !allowFail) {
    throw new Error("agent-browser " + cmd[0] + ": " + (res.stderr || res.stdout || "").trim().slice(0, 300));
  }
  return (res.stdout ?? "").trim();
}

function js(code: string): unknown {
  const out = ab(["eval", code]);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

function waitFor(code: string, what: string, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (js(code) === true) return;
    Bun.sleepSync(500);
  }
  throw new Error("Timed out waiting for " + what);
}

const hasText = (text: string) =>
  "document.body.innerText.toLowerCase().includes(" + JSON.stringify(text.toLowerCase()) + ")";
const waitText = (text: string, timeoutMs?: number) => waitFor(hasText(text), JSON.stringify(text), timeoutMs);

// React has attached its props to the element, so the page responds (a dev-mode page can take a while).
function waitReady(selector: string, timeoutMs = 60_000) {
  waitFor(
    "(() => { const el = document.querySelector(" +
      JSON.stringify(selector) +
      "); return Boolean(el) && Object.keys(el).some((k) => k.startsWith('__reactProps')); })()",
    selector,
    timeoutMs,
  );
}

let currentPath = "/";
function go(path: string) {
  currentPath = path;
  ab(["open", BASE + path]);
  ab(["wait", "--load", "networkidle"], true);
  waitReady("a[href]");
}

// Scrolls through the page so lazy images load, then waits for them.
function settle() {
  js(
    "(async () => { const pause = (ms) => new Promise((r) => setTimeout(r, ms)); const h = () => document.documentElement.scrollHeight;" +
      " for (let y = 0; y < h() && y < 20000; y += 700) { window.scrollTo(0, y); await pause(120); } window.scrollTo(0, 0);" +
      " const end = Date.now() + 8000; while (Date.now() < end && [...document.images].some((i) => !i.complete)) await pause(200);" +
      " await pause(500); return true; })()",
  );
}

function setViewport(key: "desktop" | "phone") {
  const vp = VIEWPORTS.find((v) => v.key === key)!;
  ab(["set", "viewport", String(vp.width), String(vp.height)]);
}

// prepare runs at each width before its picture (a dialog's scroll position resets with the layout).
type ShotOptions = { full?: boolean; phone?: boolean; prepare?: () => void };
function capture(id: string, options: ShotOptions = {}): Entry["shots"] {
  const shots: Entry["shots"] = {};
  const number = String(entries.length + 1).padStart(2, "0");
  for (const vp of VIEWPORTS) {
    if (vp.key === "phone" && options.phone === false) continue;
    setViewport(vp.key);
    Bun.sleepSync(800);
    options.prepare?.();
    if (options.full !== false) settle();
    const file = "shots/" + number + "-" + id + "-" + vp.key + ".png";
    ab(["screenshot", ...(options.full !== false ? ["--full"] : []), join(OUT, file)]);
    shots[vp.key] = file;
  }
  setViewport("desktop");
  Bun.sleepSync(300);
  return shots;
}

// One screen: run its steps, then capture it. A failure is recorded and the run goes on.
function screen(
  group: string,
  id: string,
  title: string,
  description: string,
  steps: () => void,
  options: ShotOptions = {},
) {
  process.stdout.write("  " + title + " … ");
  try {
    steps();
    const shots = capture(id, options);
    entries.push({ id, group, title, description, path: currentPath, shots });
    console.log("ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let shots: Entry["shots"] = {};
    try {
      shots = capture(id, { full: false, phone: false });
    } catch {
      // the browser may be gone
    }
    entries.push({ id, group, title, description, path: currentPath, shots, error: message });
    console.log("FAILED: " + message);
  }
}

function helper(...rest: Array<string>) {
  const res = spawnSync("bun", ["scripts/e2e-helper.ts", ...rest], { encoding: "utf8" });
  if (res.status !== 0) throw new Error("e2e-helper " + rest[0] + ": " + (res.stderr || res.stdout).trim());
  return (res.stdout ?? "").trim();
}

function clickButton(name: string) {
  ab(["find", "role", "button", "click", "--name", name]);
}

// Scrolls the open dialog's scrolling panel to a share of its height.
function scrollDialog(share: number) {
  js(
    "(() => { const d = document.querySelector('[role=dialog]'); if (!d) return false;" +
      " const s = [d, ...d.querySelectorAll('*')].find((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 10; });" +
      " if (!s) return false; s.scrollTop = (s.scrollHeight - s.clientHeight) * " +
      share +
      "; return true; })()",
  );
  Bun.sleepSync(500);
}

const linkFrom = (selector: string) =>
  js("document.querySelector(" + JSON.stringify(selector) + ")?.getAttribute('href') ?? ''") as string;

function writeOutput() {
  const manifest = {
    capturedAt: new Date().toISOString(),
    base: BASE,
    generated: GENERATE,
    screens: entries,
  };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(OUT, "manifest.js"), "window.SCREENS = " + JSON.stringify(manifest) + ";\n");
  copyFileSync(join(import.meta.dir, "viewer.html"), join(OUT, "index.html"));
}

let variationPath = "";
let originalPath = "";
let creator = "";

console.log("Capturing " + BASE + " into " + OUT);
try {
  setViewport("desktop");

  console.log("First visit");
  const visit = "First visit";
  screen(visit, "home", "Home", "The front door: the tagline, Open the studio, the creators to follow, and the Featured feed, which admins curate. New designs don't land here automatically; they go to Latest.", () => {
    go("/");
    waitText("Remix culture");
  });
  screen(visit, "home-latest", "Latest", "Every shared design, newest first. Each card shows its CR number, its creator, and what it remixes (\"Variation of CR 109-001\").", () => {
    go("/?tab=latest");
    waitText("Latest");
    // A remix to show lineage with: the card whose byline says "Variation of", else the newest design.
    variationPath = process.env.SCREENS_WORK ?? (js("(() => { const note = [...document.querySelectorAll('main *')].find((e) => /Variation of/.test(e.textContent ?? '') && ![...e.children].some((c) => /Variation of/.test(c.textContent ?? ''))); if (!note) return document.querySelector('main a[href^=\"/cr/\"]')?.getAttribute('href') ?? ''; for (let box = note; box; box = box.parentElement) { const own = [...box.querySelectorAll('a[href^=\"/cr/\"]')].map((a) => a.getAttribute('href')).find((h) => !note.textContent.includes(h.replace('/cr/', ''))); if (own) return own; } return ''; })()") as string);
  });
  screen(visit, "home-trending", "Trending", "Designs ranked by hearts, Backs, and remixes from other members over the last week.", () => {
    go("/?tab=trending");
    waitText("Trending");
  });
  screen(visit, "how-it-works", "How it works", "The five-step explainer linked from the home page and every footer, for someone who has never heard of CultRemix.", () => {
    go("/how-it-works");
  });
  screen(visit, "work-variation", "A design's page", "A remix's page, signed out: the art and its model photo, the buy box (style, color, size), Remix this with what a remix can change, who shares in a sale, its fingerprint and Monad record, and its lineage and family tree.", () => {
    if (!variationPath) throw new Error("No design found in Latest");
    go(variationPath);
    waitText("Remix this");
    originalPath =
      linkFrom("a[href^='/cr/']:not([href='" + variationPath + "'])") ||
      "/cr/" + (variationPath.split("/").pop() ?? "").split("-")[0] + "-001";
    creator = (linkFrom("main a[href^='/u/']") || linkFrom("a[href^='/u/']") || "").replace("/u/", "");
  });
  screen(visit, "work-original", "The original it came from", "The design that started the family. Its page lists the remixes made from it.", () => {
    if (!originalPath) throw new Error("No original linked from the remix");
    go(originalPath);
    waitText("Remix this");
  });
  screen(visit, "family", "A family tree", "/family/<number>: every design in one family, with forks branching off and recorded designs marked.", () => {
    go("/family/" + (variationPath.split("/").pop() ?? "").split("-")[0]);
  });
  screen(visit, "profile", "A creator's profile", "A creator's bio, followers, and their Works, Remixes, and Backed shelves.", () => {
    if (!creator) throw new Error("No creator linked");
    go("/u/" + creator);
  });
  screen(visit, "followers", "Followers", "Who follows a creator, each with a Follow button.", () => {
    go("/u/" + creator + "/followers");
  });
  screen(visit, "onchain", "On Monad", "What CultRemix records on Monad and how anyone can check a design's record themselves, by dropping in its file.", () => {
    go("/onchain");
  });
  screen(visit, "terms", "Store policies", "The terms (with how design ownership, lineage corrections, and earnings work). Shipping, returns, and privacy sit beside it.", () => {
    go("/policies/terms");
  });
  screen(visit, "not-found", "A page that doesn't exist", "The 404 page.", () => {
    go("/this-page-does-not-exist");
  });

  console.log("Joining");
  const join_ = "Joining";
  screen(join_, "login", "Sign in", "One screen for signing in and signing up: an email address, then a code.", () => {
    go("/login");
    waitReady("form input");
  });
  screen(join_, "code", "The email code", "The code screen. Pasting or typing all six digits signs in at once.", () => {
    ab(["find", "label", "Email", "fill", EMAIL]);
    clickButton("Get a code");
    waitText("Check your email");
    waitReady("form input");
  }, { full: false });
  screen(join_, "username", "Pick your name", "A new member's only setup step: a username, which becomes their profile address.", () => {
    const code = helper("otp", EMAIL);
    ab(["find", "label", "6-digit code", "fill", code]);
    waitText("Pick your name.", 60_000);
    waitReady("input[placeholder=yourname]");
    ab(["find", "placeholder", "yourname", "fill", NAME]);
  }, { full: false });
  screen(join_, "studio-first", "The studio, first visit", "Where a new member lands. Describe a design, add images if you like, and Generate makes four at once. The idea list and the style mixer are hidden for now.", () => {
    clickButton("Continue");
    waitText("What do you want to make?", 60_000);
    waitText("Generate");
    currentPath = "/studio";
  });

  console.log("Making a design");
  const make = "Making a design";
  screen(make, "studio-request", "Describing a design", "A request typed into the studio. Words in quotes or capitals come out as lettering, and the spelling is checked afterwards.", () => {
    ab(["find", "placeholder", "Describe your design…", "fill", PROMPT]);
  }, { full: false });
  if (GENERATE) {
    screen(make, "studio-designing", "Designing", "Generate pressed: four designs are on their way, made in a single image call and cut apart.", () => {
      clickButton("Generate 4");
      waitFor("Boolean(document.querySelector('[aria-label=\"Designing\"]'))", "the batch to start", 60_000);
      Bun.sleepSync(1500);
    }, { full: false });
    screen(make, "studio-batch", "Four designs", "The finished batch. Each design can be hearted, dismissed, opened large, published, or used as the starting point for the next batch.", () => {
      waitFor("!document.querySelector('[aria-label=\"Designing\"]')", "the batch to finish", 300_000);
      Bun.sleepSync(2000);
    });
    screen(make, "viewer", "The viewer", "A design opened large: page through the batch, heart it, dismiss it, use it as an image or a style, download it, or publish it.", () => {
      js("document.querySelector('[aria-label=\"View large\"]')?.click(); true");
      waitFor("Boolean(document.querySelector('[aria-label=\"Design viewer\"]'))", "the viewer");
      Bun.sleepSync(1200);
    }, { full: false });
    screen(make, "publish-top", "Publishing: who it's for", "The publish sheet, with the design drawn on the shirt at its real size. First choice: share it with the world (a CR number, the feed, anyone can order or remix it) or keep it just for you. Then an optional title and a few words.", () => {
      js("[...document.querySelectorAll('[aria-label=\"Design viewer\"] button')].find((b) => b.textContent?.trim() === 'Publish')?.click(); true");
      waitText("Who it", 30_000);
      Bun.sleepSync(1200);
    }, { full: false, prepare: () => scrollDialog(0) });
    screen(make, "publish-middle", "Publishing: shirt colors", "The colors it sells in, each previewed with the design (contrast warnings mark faint ones), and which color leads: the shop page opens on it and the model photo is shot on it.", () => {}, {
      full: false,
      prepare: () => scrollDialog(0.45),
    });
    screen(make, "publish-bottom", "Publishing: products and placement", "Which products it comes on (here a tee and a hoodie; the hoodie only matches 2 of the picked colors) and where it sits: front or back, size in inches, and height. One placement fits every product. The script stops here and publishes nothing.", () => {}, {
      full: false,
      prepare: () => scrollDialog(1),
    });
    try {
      ab(["press", "Escape"], true);
      Bun.sleepSync(500);
      ab(["press", "Escape"], true);
    } catch {
      // fine
    }
  }
  screen(make, "studio-sessions", "Studio sessions", "Opening the studio from the menu starts fresh, with your earlier sessions listed underneath, each with its latest designs.", () => {
    go("/studio");
    waitText("What do you want to make?", 60_000);
  });
  screen(make, "remix-form", "Remixing a design", "Remix this on someone's design: the parts its creator opened up (words, characters, people) become a simple form, with a request box for anything else.", () => {
    go(variationPath);
    waitText("Remix this");
    ab(["find", "role", "link", "click", "--name", "Remix this"]);
    waitFor("location.search.includes('s=')", "the remix session", 60_000);
    waitText("Remixing", 60_000);
    currentPath = "/studio (remix)";
  });

  console.log("Your account");
  const account = "Your account";
  screen(account, "own-profile", "Your profile", "Your own profile, with the Kept shelf only you can see.", () => {
    go("/u/" + NAME);
    waitText("@" + NAME);
  });
  screen(account, "notifications", "Notifications", "The bell: follows, hearts, remixes, Backs, and orders.", () => {
    go("/notifications");
  });
  screen(account, "earnings", "Earnings", "What you've earned from sales of your designs and their remixes, and past payouts.", () => {
    go("/me/earnings");
  });
  screen(account, "settings", "Settings", "Username, bio, and email preferences.", () => {
    go("/settings");
  });
  screen(account, "brand-page", "The brand page", "For brand accounts: the families they own and how much of their share goes to creators. Other members see this explanation.", () => {
    go("/brand");
  });

  console.log("Running CultRemix");
  helper("role", EMAIL, "super_admin_owner");
  const admin = "Running CultRemix (owner)";
  const adminScreens: Array<[string, string, string, string]> = [
    ["/admin", "admin-overview", "Admin overview", "Ready to sell (what's left before real orders, row by row), the switches, gateway credit, and browser errors people hit."],
    ["/admin/products", "admin-products", "Products", "The garments on offer, with prices, print areas, placements, and colors."],
    ["/admin/sale", "admin-sale", "For sale", "Approving designs for sale, which makes print files and Shopify products; Printful's connection."],
    ["/admin/orders", "admin-orders", "Orders", "The latest orders and where each one is."],
    ["/admin/payouts", "admin-payouts", "Payouts", "Creators' payable balances and recorded payouts."],
    ["/admin/members", "admin-members", "Members", "Members, roles, and creator access."],
    ["/admin/metrics", "admin-metrics", "Metrics", "Sign-ups, batches, publishing, and sales over time."],
    ["/admin/waitlist", "admin-waitlist", "Waitlist", "Early-access emails, and the one email they get when buying opens."],
    ["/admin/chain", "admin-chain", "Monad", "The relayer, the record queue, and members' wallets."],
    ["/admin/brands", "admin-brands", "Brands", "Brand deals and what one shirt pays everyone under each deal."],
    ["/admin/lineage", "admin-lineage", "Lineage corrections", "Fixing a design's lineage when it turns out to remix something else."],
    ["/admin/judges", "admin-judges", "Judges", "Judge accounts from the hackathon."],
  ];
  for (const [path, id, title, description] of adminScreens) {
    screen(admin, id, title, description, () => go(path));
  }
  screen(admin, "change-colors", "Changing a design's colors", "On a design's page, its creator and the owner can change which shirt colors it sells in after publishing.", () => {
    go(variationPath);
    waitReady("main button");
    waitText("Change its shirt colors", 60_000);
    clickButton("Change its shirt colors");
    waitText("Pick the colors it sells in");
    Bun.sleepSync(800);
  }, { full: false });
  screen(admin, "print-studio", "Print Studio", "/print/<number>: trim the art, knock out a background, upscale it for print, place it, and compare what goes to the printer with the published art.", () => {
    ab(["press", "Escape"], true);
    go("/print/" + variationPath.split("/").pop());
    waitText("Prepare for print", 60_000);
  });
} finally {
  writeOutput();
  try {
    await optimize(OUT);
  } catch (error) {
    console.error("Couldn't shrink the pictures: " + String(error));
  }
  try {
    helper("cleanup", EMAIL);
  } catch (error) {
    console.error("Cleanup failed for " + EMAIL + ": " + String(error));
  }
  ab(["close"], true);
  const failed = entries.filter((e) => e.error).length;
  console.log("\n" + entries.length + " screens (" + failed + " failed). Open " + join(OUT, "index.html"));
}
