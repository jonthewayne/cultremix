// The server marks a page it rendered for a signed-in member (src/routes/__root.tsx), so the browser
// knows before React starts whether live queries should wait for the member's token (src/router.tsx).
export const SESSION_META = "cr-session";

// How long a signed-in page waits for an auth source before its live queries run signed out.
export const AUTH_WAIT_MS = 10_000;

export function pageHasSession(doc: Pick<Document, "querySelector"> | undefined = globalThis.document): boolean {
  return Boolean(doc?.querySelector(`meta[name="${SESSION_META}"]`));
}

type AuthSource = (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;
type AuthClient = { setAuth: (fetchToken: AuthSource, onChange?: (isAuthenticated: boolean) => void) => void };

// A client that waits for auth (expectAuth) stays paused until something sets an auth source, and
// Better Auth sets one only once it knows the member. If it never does (the token and the session
// check both failed), this sets an empty source after `afterMs`, which resumes the socket, so the
// page still gets its public data. Better Auth's own source replaces it whenever it arrives.
export function resumeWithoutAuthAfter(client: AuthClient, afterMs = AUTH_WAIT_MS) {
  const setAuth = client.setAuth.bind(client);
  let asked = false;
  client.setAuth = (fetchToken, onChange) => {
    asked = true;
    setAuth(fetchToken, onChange);
  };
  const timer = setTimeout(() => {
    if (!asked) setAuth(async () => null);
  }, afterMs);
  return () => clearTimeout(timer);
}
