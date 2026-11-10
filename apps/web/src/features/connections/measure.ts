// How a thought is named on the map, measured in the page's own font. This
// is the one part of the layout that needs the DOM, so it stays on the page;
// everything after it works from the shapes it returns.
import type { Shape, Voice } from "./geometry";

const PLAIN: Voice = { size: 13.5, weight: 400, leading: 18 };
const TODAY: Voice = { ...PLAIN, weight: 500 };

// A line of a name holds about 28 characters.
const LABEL_EMS = 15.2;

const widthCache = new Map<string, number>();
let measureContext: CanvasRenderingContext2D | null = null;

// A line's rendered width in Geist, measured once the font has loaded.
function textWidth(text: string, voice: Voice): number {
  const key = `${voice.size}/${voice.weight}/${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * voice.size * 0.51;
  measureContext.font = `${voice.weight} ${voice.size}px ${getComputedStyle(document.body).fontFamily}`;
  const width = measureContext.measureText(text).width;
  if (document.fonts.status === "loaded") widthCache.set(key, width);
  return width;
}

const JOINING = new Set(
  "a an the of in on at to for from with by and or but as is are was were be your my our their its that".split(" "),
);

// A thought's name: up to two lines broken at words; a longer thought ends
// in an ellipsis after a whole word.
function labelLines(text: string, voice: Voice): string[] {
  const max = voice.size * LABEL_EMS;
  const width = (line: string) => textWidth(line, voice);
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > max) {
      lines.push(line);
      line = "";
      if (lines.length === 2) break;
      line = word;
    } else {
      line = next;
    }
    used += 1;
  }
  if (line && lines.length < 2) lines.push(line);
  if (used < words.length) {
    const last = lines[lines.length - 1].split(" ");
    // The cut falls after a word that carries meaning, never after a stray
    // mark or a little joining word, and the ellipsis never follows punctuation.
    while (
      last.length > 1 &&
      (width(`${last.join(" ")}…`) > max ||
        !/[\p{L}\p{N}]/u.test(last[last.length - 1]) ||
        JOINING.has(last[last.length - 1].toLowerCase()))
    )
      last.pop();
    lines[lines.length - 1] = `${last.join(" ").replace(/[\s\p{P}\p{S}]+$/u, "")}…`;
    return lines;
  }
  // A whole thought on two lines breaks where the lines come out most even.
  if (lines.length === 2) {
    let best = lines;
    for (let i = 1; i < words.length; i += 1) {
      const pair = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      const widest = Math.max(...pair.map(width));
      if (widest <= max && widest < Math.max(...best.map(width))) best = pair;
    }
    return best;
  }
  return lines;
}

// Size says how connected a thought is.
function nodeRadius(connected: number): number {
  return connected >= 4 ? 5.5 : connected >= 2 ? 4 : 3;
}

export function shape(text: string, connected: number, returned: boolean): Shape {
  const voice = returned ? TODAY : PLAIN;
  const lines = labelLines(text, voice);
  return {
    r: nodeRadius(connected),
    lines,
    w: Math.max(...lines.map((line) => textWidth(line, voice))),
    h: lines.length * voice.leading,
    voice,
  };
}
