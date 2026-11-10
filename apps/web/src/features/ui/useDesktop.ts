import { useEffect, useState } from "react";

// Where the layout turns: from here up the rail is on screen and the
// collection lives in it (Tailwind's lg).
const DESKTOP = "(min-width: 64rem)";

// Whether the window is wide enough for the rail. Answered before the first
// paint, so a page never draws the wrong surface and then swaps it.
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => window.matchMedia(DESKTOP).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(DESKTOP);
    const change = () => setDesktop(media.matches);
    // The window may have crossed the line between render and here.
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return desktop;
}
