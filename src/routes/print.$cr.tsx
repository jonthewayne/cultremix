import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { StudioProduct } from "../../shared/config/print-products";
import type { Layer, Region } from "~/components/print/CompareSlider";
import type { Placement } from "~/lib/print/placement";
import { CrMark } from "~/components/cr/CrMark";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { CropZoom, PlacedView, useLoaded } from "~/components/print/CompareSlider";
import { CHECKER, KnockoutTool } from "~/components/print/KnockoutTool";
import { PrintCheckList } from "~/components/print/PrintEntry";
import { ShirtStage } from "~/components/print/ShirtStage";
import { errorMessage } from "~/lib/imagePrep";
import { printCheck, readyLine } from "~/lib/print/check";
import { DPI_GREAT_FROM, dpiGrade, maxWidthAtDpi, sourceDpi } from "~/lib/print/dpi";
import { parseHex } from "~/lib/print/knockout";
import {
  MIN_WIDTH_IN,
  aspectOf,
  atTop,
  canvasPx,
  centered,
  clampPlacement,
  defaultPlacement,
  maxWidthIn,
  pixelRect,
  placedHeight,
} from "~/lib/print/placement";
import { areaPlacement, toInches } from "~/lib/print/shirtPlacement";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { cn } from "~/lib/utils";

// Print Studio: the creator (or the owner) gets a published work ready for a shirt. Clean the art
// up (trim, knock out, upscale), place it on the shirt, pass the print check, and make the print
// file once. Then see exactly what goes to the printer.
export const Route = createFileRoute("/print/$cr")({
  head: ({ params }) => ({ meta: [{ title: `Print CR ${params.cr} · CultRemix` }] }),
  beforeLoad: requireAuthenticatedRoute,
  component: PrintPage,
});

// Mirrors UPSCALE_MAX_SIDE in convex/print.ts, which the browser can't import.
const UPSCALE_MAX_SIDE = 1536;

type Studio = NonNullable<FunctionReturnType<typeof api.print.studio>>;
type Version = Studio["versions"][number];
type Draft = Placement & { color: string; versionId: Id<"printVersions"> };

const OP_LABEL: Record<Version["op"], string> = {
  published: "Published",
  trim: "Trimmed",
  knockout: "Knocked out",
  upscale: "Upscaled 4×",
  cutout: "Background removed",
};

function closestColor(hex: string, colors: StudioProduct["colors"]) {
  const target = parseHex(hex);
  if (!target) return colors[0].name;
  let best = colors[0];
  let bestDistance = Infinity;
  for (const color of colors) {
    const rgb = parseHex(color.hex)!;
    const distance = (rgb.r - target.r) ** 2 + (rgb.g - target.g) ** 2 + (rgb.b - target.b) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [color, distance];
  }
  return best.name;
}

function isReady(version: Version | undefined): version is Version & { width: number; height: number; metrics: NonNullable<Version["metrics"]> } {
  return Boolean(version && version.status === "ready" && version.width && version.height && version.metrics);
}

// The art as it was before any upscale, framed the same as this version, so the comparison lines
// up. A trim after an upscale changes the frame, so that version stands for itself.
function beforeUpscale(version: Version, byNumber: Map<number, Version>) {
  let current: Version | undefined = version;
  while (current?.upscaled) {
    if (current.op === "trim") return version;
    const parent: Version | undefined = current.parentNumber ? byNumber.get(current.parentNumber) : undefined;
    if (current.op === "upscale") return parent ?? version;
    current = parent;
  }
  return current ?? version;
}

function PrintPage() {
  const { cr } = Route.useParams();
  const query = useQuery(convexQuery(api.print.studio, { cr }));
  const studio = query.data;
  const open = useMutation(api.print.open);
  const opened = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studio || opened.current) return;
    const first = studio.versions.find((version) => version.number === 1);
    if (first && first.status !== "failed") return;
    opened.current = true;
    open({ cr }).catch((err) => setError(errorMessage(err)));
  }, [studio, cr, open]);

  if (query.isLoading) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        <SiteHeader />
      </div>
    );
  }
  if (!studio) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        <SiteHeader />
        <main className="px-4 pt-16 md:px-10">
          <CrMark cr={cr} className="text-6xl text-muted-foreground" />
          <p className="mt-6 text-xl">Only the creator of a published work can prepare it for print.</p>
          <Link to="/cr/$cr" params={{ cr }} className="mt-6 inline-block font-bold underline underline-offset-4">
            Back to the work
          </Link>
        </main>
      </div>
    );
  }
  return <PrintStudio studio={studio} error={error} setError={setError} />;
}

function PrintStudio({ studio, error, setError }: { studio: Studio; error: string | null; setError: (error: string | null) => void }) {
  const cr = studio.cr;
  // The front of the first product the work sells on (convex/print.ts studio).
  const product = studio.product;
  const trim = useMutation(api.print.trim);
  const knockout = useMutation(api.print.knockout);
  const upscale = useMutation(api.print.upscale);
  const removeBackground = useMutation(api.print.removeBackground);
  const savePlacement = useMutation(api.print.savePlacement);
  const render = useMutation(api.print.render);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"shirt" | "printer">(studio.printFile ? "printer" : "shirt");
  const [guides, setGuides] = useState(true);
  const [tool, setTool] = useState<"knockout" | null>(null);
  const locked = Boolean(studio.printFile);

  // When the print file is made, show it.
  const hadFile = useRef(locked);
  useEffect(() => {
    if (locked && !hadFile.current) setView("printer");
    hadFile.current = locked;
  }, [locked]);

  const byNumber = useMemo(() => new Map(studio.versions.map((version) => [version.number, version])), [studio.versions]);
  const byId = useMemo(() => new Map(studio.versions.map((version) => [version.id, version])), [studio.versions]);

  // The version being worked on: the placed one, else the newest that's ready.
  const [selectedId, setSelectedId] = useState<Id<"printVersions"> | null>(null);
  const newestReady = [...studio.versions].reverse().find(isReady);
  const fallbackId = studio.printFile?.versionId ?? studio.placement?.versionId ?? newestReady?.id ?? null;
  const selected = byId.get(selectedId ?? fallbackId ?? ("" as Id<"printVersions">));

  // Follow a version that just finished being made.
  const known = useRef(new Set<string>());
  useEffect(() => {
    const firstLook = known.current.size === 0;
    for (const version of studio.versions) {
      const key = `${version.id}:${version.status}`;
      if (known.current.has(key)) continue;
      const fresh = !firstLook && version.status === "ready" && version.number > 1;
      known.current.add(key);
      if (fresh && !locked) setSelectedId(version.id);
    }
  }, [studio.versions, locked]);

  // The placement being edited, saved a moment after it stops changing.
  const [draft, setDraft] = useState<Draft | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (draft || !isReady(selected)) return;
    const aspect = aspectOf(selected.width, selected.height);
    const saved = studio.printFile?.placement ?? studio.placement;
    // A new placement starts on the work's lead shirt color, else the one nearest its background.
    const color = studio.printFile?.color ?? studio.placement?.color ?? studio.offeredColors.at(0) ?? closestColor(studio.backgroundColor, product.colors);
    // Nothing saved here yet: where the creator placed it when publishing, so the print matches the
    // work page ("about 9 inches wide on a large") until they change it.
    const published = studio.publishPlacement && areaPlacement(toInches(studio.publishPlacement, aspect, product.printArea), product.printArea);
    const base = saved ? { xIn: saved.xIn, yIn: saved.yIn, widthIn: saved.widthIn } : (published ?? defaultPlacement(aspect, product));
    setDraft({ ...clampPlacement(base, aspect, product), color, versionId: selected.id });
  }, [draft, selected, studio.placement, studio.printFile, studio.publishPlacement, studio.offeredColors, studio.backgroundColor, product]);

  // A different version keeps the width but re-fits its own shape.
  useEffect(() => {
    if (!draft || !isReady(selected) || draft.versionId === selected.id || locked) return;
    const aspect = aspectOf(selected.width, selected.height);
    dirty.current = true;
    setDraft({ ...draft, ...clampPlacement(draft, aspect, product), versionId: selected.id });
  }, [selected, draft, locked, product]);

  const save = async (next: Draft) => {
    dirty.current = false;
    await savePlacement({ cr, versionId: next.versionId, xIn: next.xIn, yIn: next.yIn, widthIn: next.widthIn, color: next.color });
  };
  useEffect(() => {
    if (!draft || !dirty.current || locked) return;
    const timer = setTimeout(() => {
      save(draft).catch((err) => setError(errorMessage(err)));
    }, 700);
    return () => clearTimeout(timer);
    // save is a new function every render; only a changed draft should start the timer.
  }, [draft, locked]);

  const change = (next: Partial<Draft>) => {
    if (!draft || locked) return;
    dirty.current = true;
    setDraft({ ...draft, ...next });
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const aspect = isReady(selected) ? aspectOf(selected.width, selected.height) : 1;
  const check = isReady(selected) && draft ? printCheck({ width: selected.width, height: selected.height, ...selected.metrics }, draft, product) : null;
  const shirt = product.colors.find((color) => color.name === draft?.color) ?? product.colors[0];
  const rendering = studio.placement?.rendering ?? false;
  const upscaling = studio.versions.some((version) => version.upscaling);
  const removing = studio.versions.some((version) => version.removing);

  // The swatches: the colors the work is offered in (plus the one in use), else every color the
  // shirt comes in. "More colors" shows the rest.
  const [allColors, setAllColors] = useState(false);
  const offered = studio.offeredColors.flatMap((name) => product.colors.filter((color) => color.name === name));
  const inUse = draft && !studio.offeredColors.includes(draft.color) ? product.colors.filter((color) => color.name === draft.color) : [];
  const swatches = allColors || offered.length === 0 ? product.colors : [...offered, ...inUse];

  const makeFile = () =>
    run(async () => {
      if (draft && dirty.current) await save(draft);
      await render({ cr });
    });

  const startUpscale = () =>
    run(async () => {
      if (!selected) return;
      const result = await upscale({ cr, versionId: selected.id });
      if ("refused" in result) {
        setError(
          result.refused === "NO_CREDITS"
            ? `Upscaling takes ${studio.upscaleCredits} credits. You have ${studio.credits}.`
            : result.refused === "BUDGET"
              ? "Upscaling is resting until tomorrow. Your credits weren't used."
              : "Upscaling is paused right now.",
        );
      }
    });

  const startCutout = () =>
    run(async () => {
      if (!selected) return;
      const result = await removeBackground({ cr, versionId: selected.id });
      if ("refused" in result) {
        setError(result.refused === "BUDGET" ? "Background removal is resting until tomorrow." : "Background removal is paused right now.");
      }
    });

  return (
    <div className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Prepare for print</p>
            <Link to="/cr/$cr" params={{ cr }} className="mt-1 block">
              <CrMark cr={cr} className="text-5xl md:text-7xl" />
            </Link>
            {studio.title && <p className="mt-2 text-xl font-black tracking-tight">{studio.title}</p>}
          </div>
          {studio.printFile && (
            <div className="flex flex-col items-start gap-2 md:items-end">
              <p className="rounded-xl bg-foreground px-3 py-2 text-sm font-bold text-background">
                {readyLine(studio.printFile.dpi, studio.printFile.placement.widthIn)}
              </p>
              {studio.printFile.url && (
                <a href={studio.printFile.url} download className="text-sm font-bold underline underline-offset-4">
                  Download the print file (PNG, {studio.printFile.widthPx} × {studio.printFile.heightPx})
                </a>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-6 rounded-2xl border-2 border-red-600 px-4 py-3 font-semibold text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
          <section className="min-w-0">
            <div className="mb-4 inline-flex rounded-2xl border border-border p-1">
              {(["shirt", "printer"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setView(tab)}
                  className={cn(
                    "h-10 rounded-xl px-4 text-sm font-bold",
                    view === tab ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab === "shirt" ? "On the shirt" : "What goes to the printer"}
                </button>
              ))}
            </div>

            {view === "shirt" ? (
              <div className="rounded-3xl bg-card p-2 md:p-6">
                {draft && isReady(selected) ? (
                  <ShirtStage
                    product={product}
                    kind={studio.product.kind}
                    shirtHex={shirt.hex}
                    imageUrl={selected.previewUrl ?? selected.url}
                    aspect={aspect}
                    placement={draft}
                    onChange={(placement) => change(placement)}
                    guides={guides}
                    locked={locked}
                    className="mx-auto max-w-2xl"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-muted-foreground">
                    {selected?.status === "failed" ? selected.error : "Measuring your art…"}
                  </div>
                )}
                {!locked && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Drag the design. It snaps to the center and the top line.
                  </p>
                )}
              </div>
            ) : (
              <PrinterView studio={studio} product={product} selected={selected} draft={draft} byNumber={byNumber} shirtHex={shirt.hex} />
            )}
          </section>

          <aside className="flex min-w-0 flex-col gap-8">
            <Panel title="Versions">
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
                {studio.versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    disabled={!isReady(version) || locked}
                    onClick={() => setSelectedId(version.id)}
                    className={cn(
                      "w-28 shrink-0 rounded-2xl border-2 p-1.5 text-left transition-colors disabled:cursor-default",
                      version.id === selected?.id ? "border-foreground" : "border-transparent hover:border-border",
                    )}
                  >
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl" style={CHECKER}>
                      {version.status === "ready" && version.previewUrl && !version.previewUrl.startsWith("fake:") ? (
                        <img src={version.previewUrl} alt={`Version ${version.number}`} className="h-full w-full object-contain" />
                      ) : (
                        <span className="px-2 text-center text-xs font-bold text-neutral-600">
                          {version.status === "pending"
                            ? version.upscaling
                              ? "Upscaling…"
                              : version.removing
                                ? "Removing the background…"
                                : "Making…"
                            : version.status === "failed"
                              ? "Didn’t work"
                              : `v${version.number}`}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs font-black">
                      v{version.number} · {OP_LABEL[version.op]}
                    </p>
                    {version.width && version.height ? (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {version.width}×{version.height}
                      </p>
                    ) : null}
                    {version.status === "failed" && version.error && <p className="mt-1 text-[11px] leading-snug text-red-600">{version.error}</p>}
                  </button>
                ))}
              </div>
            </Panel>

            {!locked && (
              <Panel title="Clean it up">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <ToolButton
                    label="Trim"
                    hint="Crop to the art"
                    disabled={busy || !isReady(selected)}
                    onClick={() => selected && run(() => trim({ cr, versionId: selected.id }))}
                  />
                  <ToolButton
                    label="Knock out"
                    hint="Clear a background color"
                    active={tool === "knockout"}
                    disabled={!isReady(selected)}
                    onClick={() => setTool(tool === "knockout" ? null : "knockout")}
                  />
                  <ToolButton
                    label="Remove background"
                    hint={isReady(selected) && selected.metrics.hasAlpha ? "Its background is already transparent" : "Cut the art out of any background"}
                    disabled={busy || !cutoutUsable(selected, studio, removing)}
                    onClick={startCutout}
                  />
                  <ToolButton
                    label="Upscale for print"
                    hint={studio.isOwner ? "4× sharper · free for you" : `4× sharper · ${studio.upscaleCredits} credits`}
                    disabled={busy || Boolean(upscaleBlocked(selected, studio, upscaling))}
                    onClick={startUpscale}
                  />
                </div>
                {cutoutBlocked(selected, studio, removing) && (
                  <p className="mt-3 text-xs text-muted-foreground">{cutoutBlocked(selected, studio, removing)}</p>
                )}
                {upscaleBlocked(selected, studio, upscaling) && (
                  <p className="mt-3 text-xs text-muted-foreground">{upscaleBlocked(selected, studio, upscaling)}</p>
                )}
                {tool === "knockout" && isReady(selected) && (
                  <div className="mt-5 rounded-2xl border border-border p-4">
                    <KnockoutTool
                      imageUrl={selected.url}
                      busy={busy}
                      onApply={(params) => {
                        setTool(null);
                        void run(() => knockout({ cr, versionId: selected.id, ...params }));
                      }}
                    />
                  </div>
                )}
              </Panel>
            )}

            {draft && isReady(selected) && (
              <Panel title="Placement">
                {studio.publishSide === "back" && (
                  <p className="mb-4 text-sm">
                    This design prints on the back of the {product.name}. Where it sits there is set on its page, under “Change what it
                    comes on and where it sits”; here you prepare the art, and the version you pick is the one that prints.
                  </p>
                )}
                <p className="text-sm font-bold">Shirt color · {shirt.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {swatches.map((color) => (
                    <button
                      key={color.name}
                      type="button"
                      title={color.name}
                      aria-label={color.name}
                      aria-pressed={color.name === draft.color}
                      disabled={locked}
                      onClick={() => change({ color: color.name })}
                      className={cn(
                        "h-10 w-10 rounded-full border-2 border-border transition-transform hover:scale-110 disabled:hover:scale-100",
                        color.name === draft.color && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                      )}
                      style={{ background: color.hex }}
                    />
                  ))}
                  {!locked && swatches.length < product.colors.length && (
                    <button type="button" onClick={() => setAllColors(true)} className="px-1 text-sm font-semibold underline underline-offset-4">
                      More colors
                    </button>
                  )}
                </div>

                <label className="mt-6 flex flex-col gap-2 text-sm font-bold">
                  <span className="flex justify-between gap-2">
                    Size
                    <span className="tabular-nums text-muted-foreground">
                      {draft.widthIn.toFixed(1)} × {placedHeight(draft.widthIn, aspect).toFixed(1)} in
                    </span>
                  </span>
                  <input
                    type="range"
                    min={MIN_WIDTH_IN}
                    max={maxWidthIn(aspect, product)}
                    step={0.1}
                    value={draft.widthIn}
                    disabled={locked}
                    onChange={(event) => {
                      // Grow from the center, keeping the top where it is.
                      const widthIn = Number(event.target.value);
                      const xIn = draft.xIn + (draft.widthIn - widthIn) / 2;
                      change(clampPlacement({ xIn, yIn: draft.yIn, widthIn }, aspect, product));
                    }}
                    className="w-full accent-foreground"
                  />
                </label>
                {!locked && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SmallButton onClick={() => change(clampPlacement(centered(draft, product), aspect, product))}>Center</SmallButton>
                    <SmallButton onClick={() => change(clampPlacement(atTop(draft, product), aspect, product))}>Top</SmallButton>
                    <SmallButton
                      onClick={() => {
                        const widthIn = Math.min(maxWidthAtDpi(selected.width, selected.height, DPI_GREAT_FROM), maxWidthIn(aspect, product));
                        change(clampPlacement(centered({ ...draft, widthIn }, product), aspect, product));
                      }}
                    >
                      Biggest that prints great
                    </SmallButton>
                    <SmallButton onClick={() => setGuides(!guides)}>{guides ? "Hide guides" : "Show guides"}</SmallButton>
                  </div>
                )}
              </Panel>
            )}

            {check && !locked && (
              <Panel title="Print check">
                <PrintCheckList items={check.items} />
                <button
                  type="button"
                  disabled={busy || rendering || !check.ready}
                  onClick={makeFile}
                  className="mt-6 h-14 w-full rounded-2xl bg-foreground text-lg font-black text-background transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                >
                  {rendering ? "Making the print file…" : "Make the print file"}
                </button>
                <p className="mt-2 text-xs text-muted-foreground">Made once at 300 DPI. After that it doesn’t change.</p>
                {studio.placement?.renderError && <p className="mt-2 text-sm font-semibold text-red-600">{studio.placement.renderError}</p>}
              </Panel>
            )}

            {studio.printFile && (
              <Panel title="The print file">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Size</dt>
                  <dd>
                    {studio.printFile.placement.widthIn} × {studio.printFile.placement.heightIn} in on {studio.printFile.color}
                  </dd>
                  <dt className="text-muted-foreground">Sharpness</dt>
                  <dd>
                    {Math.floor(studio.printFile.dpi)} DPI · {studio.printFile.grade}
                  </dd>
                  <dt className="text-muted-foreground">Ink</dt>
                  <dd>{Math.round(studio.printFile.coverage * 1000) / 10}% of the print area</dd>
                  <dt className="text-muted-foreground">SHA-256</dt>
                  <dd className="break-all font-mono text-xs">{studio.printFile.sha256}</dd>
                </dl>
                {studio.printFile.warnings.length > 0 && (
                  <ul className="mt-3 list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
                    {studio.printFile.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                {studio.placement && movedSince(studio.placement, studio.printFile.placement) && (
                  <p className="mt-3 text-sm">
                    Its placement changed on the design’s page after this file was made. Approving it for sale makes each
                    product’s print file the new way, {studio.placement.widthIn} in wide.
                  </p>
                )}
              </Panel>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

// The placement moved since the print file was made (by a change on the work page, which the
// Print Studio's placement follows; convex/lib/printSync.ts).
function movedSince(now: { widthIn: number; yIn: number }, made: { widthIn: number; yIn: number }) {
  return Math.abs(now.widthIn - made.widthIn) > 0.02 || Math.abs(now.yIn - made.yIn) > 0.02;
}

// Why "Remove background" can't run on this version right now, or null. It shares the Print-size art
// switch with upscales, and works on art from before any upscale.
function cutoutBlocked(version: Version | undefined, studio: Studio, removing: boolean) {
  if (!studio.upscaleEnabled) return "Background removal is paused right now.";
  if (removing) return "Removing the background… this takes a few seconds.";
  if (!isReady(version)) return null;
  if (version.upscaled) return "Remove the background before upscaling: pick a version from before the upscale.";
  return null;
}

// Whether "Remove background" can run on this version: it's for art without transparency (the
// button's own hint says so for transparent art, without a line under the tools).
const cutoutUsable = (version: Version | undefined, studio: Studio, removing: boolean) =>
  isReady(version) && !version.metrics.hasAlpha && !cutoutBlocked(version, studio, removing);

function upscaleBlocked(version: Version | undefined, studio: Studio, upscaling: boolean) {
  if (!studio.upscaleEnabled) return "Upscaling is paused right now.";
  if (upscaling) return "Upscaling… this takes about a minute.";
  if (!isReady(version)) return null;
  if (version.upscaled) return "This version is already upscaled.";
  if (Math.max(version.width, version.height) > UPSCALE_MAX_SIDE) return `Upscaling takes art up to ${UPSCALE_MAX_SIDE} px. Trim it first.`;
  if (!version.metrics.hasAlpha) return "Remove the background first (or knock out a flat color): the upscale keeps transparency.";
  if (!studio.isOwner && studio.credits < studio.upscaleCredits) return `Upscaling takes ${studio.upscaleCredits} credits. You have ${studio.credits}.`;
  return null;
}

// How a print of this many dots per inch looks: the words the printer tab uses.
function printsLike(dpi: number) {
  const grade = dpiGrade(dpi);
  return grade === "great" ? "sharp" : grade === "good" ? "well" : "soft";
}

// The printer tab. A screen shrinks a whole design to fit, so the published art stretched to print
// size and its upscale look the same there; the difference shows only up close, at real print
// pixels, so the tab leads with that. Before the file is made it previews the chosen version at
// print size; after, the real print file.
function PrinterView({
  studio,
  product,
  selected,
  draft,
  byNumber,
  shirtHex,
}: {
  studio: Studio;
  product: StudioProduct;
  selected: Version | undefined;
  draft: Draft | null;
  byNumber: Map<number, Version>;
  shirtHex: string;
}) {
  const file = studio.printFile;
  const placed = file ? byNumberFromId(byNumber, file.versionId) : selected;
  const fileUrl = useLoaded(file?.url, file?.previewUrl);
  if (!placed || !isReady(placed) || (!file && !draft)) {
    return <p className="rounded-3xl bg-card p-8 text-muted-foreground">Your art is still being measured.</p>;
  }
  const before = beforeUpscale(placed, byNumber);
  const aspect = aspectOf(placed.width, placed.height);
  const rect: Region = file ? file.rect : pixelRect(draft!, aspect, product);
  const canvas = canvasPx(product);
  const beforeLayer: Layer = { url: before.url ?? "", region: rect, pixelWidth: before.width };
  const afterLayer: Layer = file
    ? { url: fileUrl ?? file.previewUrl ?? "", region: { left: 0, top: 0, ...canvas } }
    : { url: placed.url ?? "", region: rect, pixelWidth: placed.width };
  const zoomAfter: Layer = file ? { url: file.url ?? "", region: { left: 0, top: 0, ...canvas } } : afterLayer;
  const missing = !beforeLayer.url || !afterLayer.url || beforeLayer.url.startsWith("fake:");
  const stretch = before.width ? rect.width / before.width : 1;
  const widthIn = rect.width / product.dpi;
  const heightIn = rect.height / product.dpi;
  const beforeDpi = Math.floor(sourceDpi(before.width ?? 0, before.height ?? 0, widthIn, heightIn));
  const afterDpi = Math.floor(file ? file.dpi : sourceDpi(placed.width, placed.height, widthIn, heightIn));
  // Nothing was upscaled between the published art and this version: one image, no comparison.
  const compares = before.number !== placed.number;
  const size = `${widthIn.toFixed(1)} in wide`;
  const whole = missing ? (
    <p className="mt-4 text-muted-foreground">The images aren’t available here.</p>
  ) : (
    <PlacedView
      layer={afterLayer}
      view={rect}
      background={shirtHex}
      alt={file ? "The print file" : `Version ${placed.number} at print size`}
      className="mx-auto mt-4"
      style={{ width: `min(100%, calc(70svh * ${rect.width / rect.height}))` }}
    />
  );
  const wholeNote = file
    ? `This exact file goes to the printer: your design where you placed it, at ${afterDpi} dots per inch.`
    : `A preview of v${placed.number} at print size. Make the print file to see the exact file the printer gets.`;

  return (
    <div className="flex flex-col gap-6">
      {compares ? (
        <div className="rounded-3xl bg-card p-4 md:p-6">
          <p className="text-sm font-bold uppercase tracking-wider">Up close</p>
          <p className="mt-1 text-sm">
            Your design prints {size}. The art as published (v{before.number}, {before.width} px across) gives {beforeDpi} dots per inch
            at that size, so it prints {printsLike(beforeDpi)}. {file ? "The print file" : `The upscaled copy (v${placed.number}, ${placed.width} px)`} gives{" "}
            {afterDpi}, so it prints {printsLike(afterDpi)}.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            A screen shrinks the whole design to fit, so the two only look different up close. This shows real print pixels, one
            per screen pixel: the left side is the published art blown up {Math.round(stretch * 10) / 10}×. Drag the line.
          </p>
          {!missing && (
            <div className="mt-4">
              <CropZoom
                before={beforeLayer}
                after={zoomAfter}
                design={rect}
                mapUrl={placed.previewUrl ?? placed.url ?? ""}
                background={shirtHex}
                beforeLabel={`v${before.number}, as published`}
                afterLabel={file ? "Print file" : `v${placed.number}, upscaled`}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-3xl bg-card p-4 md:p-6">
          <p className="text-sm">
            Your design prints {size}. Your art (v{placed.number}, {placed.width} px across) gives {afterDpi} dots per inch at that
            size, so it prints {printsLike(afterDpi)}.
            {afterDpi < DPI_GREAT_FROM && studio.upscaleEnabled && " Upscale for print makes it sharper."}
          </p>
        </div>
      )}
      <div className="rounded-3xl bg-card p-4 md:p-6">
        <p className="text-sm font-bold uppercase tracking-wider">{file ? "The print file" : "The whole design"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{wholeNote}</p>
        {whole}
      </div>
    </div>
  );
}

function byNumberFromId(byNumber: Map<number, Version>, id: Id<"printVersions">) {
  for (const version of byNumber.values()) if (version.id === id) return version;
  return undefined;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t-2 border-foreground pt-4">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider">{title}</h2>
      {children}
    </section>
  );
}

function ToolButton({ label, hint, onClick, disabled, active }: { label: string; hint: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start rounded-2xl border-2 px-4 py-3 text-left transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40",
        active ? "border-foreground bg-foreground text-background" : "border-foreground",
      )}
    >
      <span className="font-black">{label}</span>
      <span className={cn("text-xs", active ? "text-background/80" : "text-muted-foreground")}>{hint}</span>
    </button>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-9 rounded-xl border border-border px-3 text-sm font-bold hover:border-foreground">
      {children}
    </button>
  );
}
