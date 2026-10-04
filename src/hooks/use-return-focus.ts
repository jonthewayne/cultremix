import { useEffect } from "react";

// For overlays: remember what had focus when it opened and put focus back there when it closes,
// so a keyboard user lands where they left off instead of at the top of the page. Call it before
// any effect that moves focus into the overlay.
export function useReturnFocus(active = true) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active]);
}
