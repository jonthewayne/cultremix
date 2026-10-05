"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { VISION_MODEL } from "./models";
import type { ImageRole } from "./prompts";

// Reads what a request wants from each numbered image: what's in it, only its look, or both.
// Tested 2026-10-02 on 16 tricky requests ("make her look like she belongs in the second
// picture", "a dragon in this style", "swap the lion for my cat"): GPT-6 Luna with reasoning off
// read 14 as expected, and the other two defensibly; namedStyles' phrases read 8. About 1 s.
// Retested 2026-10-04 on 17 requests, five of them with a style in the mixer: not knowing about the
// mixer, it read "the style" in "make her in this style" as the photo's own look and answered
// "both", which put the photo itself into the style mix at full strength (50 of 68 answers as
// intended). Told what the mixer holds, it still swapped images in "draw her like the lion design"
// with reasoning off (55 of 68). With low reasoning: 168 of 170 over two runs, at 2.4 s typical and
// 4.3 s at most.
// 2026-10-05: "use the colors from the second image" read as both for image 2 in 5 of 6 tries, because
// the "both" line's only example was "use image 1's colors". An image used for its colors or look is
// now style when the design's subject comes from elsewhere, and both only when it's also the subject.
const MODEL = VISION_MODEL;
const TIMEOUT_MS = 10_000;

const SYSTEM = [
  "You read a member's request to a t-shirt design studio. The member attached numbered images; the studio's style mixer may hold " +
    "more images, used only for their look. Decide what the request wants from each numbered image:",
  "- content: work on what's in it. Its people, characters, objects, words, or layout carry into the design, possibly changed or restyled.",
  "- style: use only its look (technique, colors, line, texture, lettering style, the way it draws people) for other content. Leave out its subjects and words.",
  "- both: keep what's in it and also use its own look. Only when the request asks for that image's own look and what's in it is also drawn, such as " +
    '"keep image 1\'s look" or "keep the lion\'s own colors".',
  "An image the request uses only for its colors, palette, technique, or vibe is style when the design's subject comes from elsewhere (another " +
    'numbered image, or a subject the request describes), such as "use the colors from the second image" when image 1 is the subject. It\'s both ' +
    'only when it\'s also the subject, such as "use image 1\'s colors with the style" when image 1 is the only numbered image.',
  "When the request describes no subject of its own and no other numbered image can be the subject, the only numbered image is the subject: " +
    "content, or both when the request asks for its own look or colors. It's never style then.",
  "An image the request doesn't mention is content. An image is style only when the request uses it for how it looks, in any wording, such as " +
    '"in the style of image 2", "make it look like the second one", "the poster\'s vibe", "drawn like the lion design", or "a dragon in this style". ' +
    'Asking to keep an image\'s own look makes it both. A negated style ("not the style of image 2") is not a style.',
  'When the style mixer holds images, a look that doesn\'t point at a numbered image, such as "in the style", "this style", or "like the style", ' +
    "is the mixer's, and leaves the numbered images as content.",
  'Also decide "styleHair": true only when the request asks to give people the hair of the style or of a style image (its hairstyle or ' +
    'hair shape), in any wording, such as "with the style\'s hair", "give her the cartoon\'s spiky hair", or "hair like image 2". Otherwise ' +
    "false, including when the request describes some other hairstyle or only a hair color.",
  'Answer with JSON only: {"roles": [one of "content", "style", "both" for each numbered image, in order], "styleHair": true or false}.',
].join("\n");

const ROLES = new Set<string>(["content", "style", "both"]);

type ReaderImage = { summary?: string; kind?: "photo" | "art" };

// roles: what the request wants from each numbered image. styleHair: the request asks to give
// people the style's hair, which studioPrompt then names (people keep their own hair otherwise).
export type RequestReading = { roles: Array<ImageRole>; styleHair: boolean };

function describe(image: ReaderImage) {
  const kind = image.kind === "photo" ? "a photo" : image.kind === "art" ? "art" : "an image";
  return `${kind}${image.summary ? `: ${image.summary}` : ""}`;
}

// Null when there's nothing to read or the reader can't answer; callers fall back to namedStyles.
export async function readRoles(args: {
  instruction: string;
  images: Array<ReaderImage>;
  // The style mixer's images with a slider above zero: a number for a numbered image, or the
  // image itself for one added only in the mixer.
  mixer?: Array<number | ReaderImage>;
  remix: boolean;
}): Promise<RequestReading | null> {
  if (!args.instruction.trim() || args.images.length === 0 || !process.env.AI_GATEWAY_API_KEY) return null;
  const list = args.images.map((image, i) => `${i + 1}. ${describe(image)}`).join("\n");
  const mixer = (args.mixer ?? []).map((entry) => `- ${typeof entry === "number" ? `image ${entry}` : describe(entry)}`);
  const styles = mixer.length > 0 ? `Style mixer:\n${mixer.join("\n")}` : "Style mixer: empty.";
  const remix = args.remix ? "\nImage 1 is the published design being remixed; it stays content." : "";
  try {
    const started = Date.now();
    const result = await generateText({
      model: gateway(MODEL),
      system: SYSTEM,
      prompt: `Numbered images:\n${list}${remix}\n${styles}\n\nRequest: ${args.instruction}`,
      providerOptions: { openai: { reasoningEffort: "low" } },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = result.text;
    const parsed: { roles?: unknown; styleHair?: unknown } = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const roles = parsed.roles;
    if (!Array.isArray(roles) || roles.length !== args.images.length || !roles.every((role) => ROLES.has(String(role)))) {
      console.error("readRoles: unexpected answer", text.slice(0, 200));
      return null;
    }
    const styleHair = parsed.styleHair === true;
    console.log("readRoles ok", Date.now() - started, "ms", roles.join("/"), styleHair ? "style hair" : "own hair");
    return { roles: roles as Array<ImageRole>, styleHair };
  } catch (error) {
    console.error("readRoles failed", error instanceof Error ? error.message : error);
    return null;
  }
}
