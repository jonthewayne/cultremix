export function sanitizeRedirect(
  value: string | undefined | null,
  fallback = "/studio",
): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.toLowerCase().startsWith("/\\")) return fallback;
  if (value.includes("\n") || value.includes("\r")) return fallback;
  return value;
}
