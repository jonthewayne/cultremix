// Random codes for storage paths: 128 bits from the platform's cryptographic random source, as 26
// lowercase base32 characters (a-z, 2-7). A path that holds one can't be guessed, and the public
// bucket can't be listed, so only someone given the link can open the file (convex/lib/sizes.ts).
// Call it from actions: Convex seeds the random source inside queries and mutations.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function randomCode(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)) {
  const bytes = random(new Uint8Array(16));
  let value = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // 128 bits leave 3 over: the last character carries them, padded with zeros.
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
