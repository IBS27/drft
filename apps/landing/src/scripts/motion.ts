// Small shared pieces for the landing's choreography. Every sequence takes an
// AbortSignal, so a scene that scrolls away stops mid-word and leaves nothing
// running behind it.

export const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const id = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Types `text` into `el` at a human, slightly uneven pace. */
export async function typeInto(el: HTMLElement, text: string, signal: AbortSignal): Promise<void> {
  el.textContent = "";
  for (const char of text) {
    el.textContent += char;
    // A beat after a comma, a shorter one between words.
    const pause = char === "," ? 220 : char === " " ? 30 + Math.random() * 70 : 0;
    await sleep(34 + Math.random() * 52 + pause, signal);
  }
}

/**
 * Runs `sequence` over and over while `active()` holds, restarting cleanly
 * each time it becomes true again. Returns a function to call whenever the
 * answer may have changed.
 */
export function loopWhile(
  active: () => boolean,
  sequence: (signal: AbortSignal) => Promise<void>,
  reset: () => void,
): () => void {
  let controller: AbortController | undefined;

  const run = async (signal: AbortSignal) => {
    try {
      while (!signal.aborted) await sequence(signal);
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  };

  return () => {
    const on = active();
    if (on && !controller) {
      controller = new AbortController();
      void run(controller.signal);
    } else if (!on && controller) {
      controller.abort();
      controller = undefined;
      reset();
    }
  };
}

/** Marks [data-reveal] elements as they scroll into view, once each. */
export function observeReveals(): void {
  const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (reducedMotion() || !("IntersectionObserver" in window)) {
    for (const el of items) el.dataset.state = "in";
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.state = "in";
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
  );
  for (const el of items) observer.observe(el);
}
