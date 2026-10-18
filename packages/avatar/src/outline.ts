import type { CharmName, LeafName, MoodName } from "./catalog";
import { CHARMS, LEAVES, MOODS, V, body, eye, f1, marks, mouth, tear, topAt, type Ear, type P } from "./render";
import type { Facing } from "./traits";

/*
 * An avatar as line art, for a backdrop: the silhouette, leaves, mood and charm that render() draws,
 * without its colors, shading, grain, toppings or ground shadow. Every line takes the inherited stroke
 * and every shape the inherited fill, so the caller picks both. A fill the color of the page lets a
 * shape hide the lines behind it. Open eyes are dots in currentColor. It returns a <g> in render()'s
 * 120 by 120 view.
 */
export interface OutlineTraits {
  leaf: LeafName;
  mood?: MoodName;
  charm?: CharmName;
  blush?: boolean;
  mouth?: boolean;
  facing?: Facing;
}

const PAINT = / (?:fill|stroke|stroke-width|opacity|fill-opacity|stroke-opacity)="[^"]*"/g;

/** Takes the color out of render()'s markup. A shape keeps no fill of its own and a line no stroke, and a white shine goes. */
function bare(svg: string): string {
  return svg.replace(/<(\w+)([^>]*?)(\/?)>/g, (_, tag: string, attrs: string, end: string) => {
    if (end && / fill="#fff(?:fff)?"/i.test(attrs)) return "";
    const none = / fill="none"| fill-opacity="/.test(attrs) ? ` fill="none"` : "";
    return `<${tag}${attrs.replace(PAINT, "")}${none}${end}>`;
  });
}

/** One leaf as line art, standing on 0 0 and pointing up, `length` long. */
export function leafOutline(name: LeafName, length: number): string {
  const L = LEAVES[name](length);
  return `<path d="${L.d}"${L.needles ? ` fill="none"` : ""}/>${L.vein ? `<path d="${L.vein}" fill="none"/>` : ""}`;
}

export function outline(t: OutlineTraits): string {
  const v = V, b = body(v), mood = MOODS[t.mood ?? "calm"];
  const ears = v.ears.map((e, i) => mood.ears(e, i));
  const leaf = ([fx, angle, len]: Ear) => {
    const x = v.cx + fx * v.rx;
    return `<g transform="translate(${f1(x)} ${f1(topAt(b, x) + 4)}) rotate(${angle})">${leafOutline(t.leaf, len * 1.25)}</g>`;
  };
  const face = (fx: number, fy: number): P => { const x = v.cx + fx * v.rx; return [x, topAt(b, x) + fy * v.H]; };
  const eyes = v.eyes.map(([fx, fy, r]) => { const [x, y] = face(fx, fy); return [x, y, r * 1.3] as const; });
  const charm = t.charm ? CHARMS[t.charm]({ v, b, eyes }) : {};

  let g = `${ears.filter((e) => e[3]).map(leaf).join("")}<path d="${b.d}"/>${bare(charm.underEar ?? "")}`;
  g += ears.filter((e) => !e[3]).map(leaf).join("");
  // A blush is three short strokes where render() puts a pink oval.
  if (t.blush || mood.blush) g += v.blush.map(([fx, fy]) => { const [x, y] = face(fx, fy); return `<path d="M${f1(x - 4.4)} ${f1(y + 1.6)} l2 -3.2 m1.4 3.2 l2 -3.2 m1.4 3.2 l2 -3.2" fill="none"/>`; }).join("");
  g += eyes.map(([x, y, r], i) => {
    const mode = mood.eyes(i);
    if (mode !== "open" && mode !== "sparkle") return bare(eye("nanten", x, y, r * mood.scale, mode, mood.gaze));
    return `<circle cx="${f1(x + mood.gaze[0])}" cy="${f1(y + mood.gaze[1])}" r="${f1(r * mood.scale * 0.62)}" fill="currentColor" stroke="none"/>`;
  }).join("");
  if (mood.tear && eyes[0]) g += bare(tear(eyes[0]));
  if (t.mouth) g += bare(mouth(face(...v.mouth)));
  g += bare((charm.front ?? "") + marks(t.mood ?? "calm", v, topAt(b, v.cx)));
  return `<g${t.facing === "left" ? ` transform="translate(120 0) scale(-1 1)"` : ""}>${g}</g>`;
}
