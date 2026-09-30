// Tells a request the image provider's content filter refused apart from other
// failures: OpenAI's image moderation error (through the AI Gateway, or as the
// ChatGPT backend's failed event), or a model that answered with a refusal
// sentence and no image.
const FILTER_PATTERNS = [/safety system/i, /moderation[_ ]blocked/i, /content[_ ]policy/i, /safety[_ ]violations?/i];
const REFUSAL = /\b(?:can['’]?t|cannot|won['’]?t|unable to|not able to) (?:help|create|make|generate|produce|draw)\b/i;

// Prefix of the error thrown when the model replies in words without an image.
export const NO_IMAGE_REPLY = "The image service answered without an image:";

export function isBlockedError(error: string | undefined) {
  if (!error) return false;
  if (FILTER_PATTERNS.some((pattern) => pattern.test(error))) return true;
  return error.startsWith(NO_IMAGE_REPLY) && REFUSAL.test(error);
}
