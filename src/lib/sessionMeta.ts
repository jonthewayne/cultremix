// The server marks a page it rendered for a signed-in member (src/routes/__root.tsx), so the browser
// knows before React starts whether live queries should wait for the member's token (src/router.tsx).
export const SESSION_META = "cr-session";

export function pageHasSession(doc: Pick<Document, "querySelector"> | undefined = globalThis.document): boolean {
  return Boolean(doc?.querySelector(`meta[name="${SESSION_META}"]`));
}
