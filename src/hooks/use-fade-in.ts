import { useEffect, useState } from "react";

// Set once the page has hydrated.
let appHydrated = false;

// Whether something should fade in when it appears. Content on the server-rendered page shows as
// soon as the browser draws it, without waiting for JavaScript (starting it invisible held back
// the page's largest content, and left it blank without JavaScript); content that mounts later
// (a client navigation, a feed's next page) fades in. False during the server render and
// hydration, so both draw the same thing.
export function useFadeIn(): boolean {
  const [fadeIn] = useState(() => appHydrated);
  useEffect(() => {
    appHydrated = true;
  }, []);
  return fadeIn;
}
