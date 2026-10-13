// "Use as style" while the style mixer is hidden (src/lib/studioSections.ts): the design joins the
// numbered images, and the request names it for its look. The server reads "in the style of image 2"
// the same way as a style in the mixer (convex/lib/roleReader.ts, and namedStyles in
// convex/lib/prompts.ts when the reader can't answer).

// The request with image n named for its look; count is how many numbered images there are. An empty
// request gets a start: "Draw image 1 in the style of image 2." when there's one other image, and
// otherwise "In the style of image 2: " for the member to finish. A request that already names image
// n's style stays as it is. Null when the result wouldn't fit in max characters.
export function withStyleOf(request: string, n: number, count: number, max: number): string | null {
  if (new RegExp(String.raw`\bstyle of image\s*#?\s*${n}\b`, "iu").test(request)) return request;
  const text = request.trim().replace(/[\s:;,\-–—]+$/u, "");
  const next = text
    ? `${text}${/[.!?]$/u.test(text) ? "" : "."} In the style of image ${n}.`
    : count === 2
      ? `Draw image ${n === 1 ? 2 : 1} in the style of image ${n}.`
      : `In the style of image ${n}: `;
  return next.length <= max ? next : null;
}
