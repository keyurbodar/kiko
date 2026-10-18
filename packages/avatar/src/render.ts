import { FLAVOURS, type CharmName, type EyeName, type LeafName, type MoodName, type OutfitName, type PatternName, type Topping } from "./catalog";
import { mulberry, seedState, stream } from "./hash";
import type { AvatarTraits } from "./traits";

export interface RenderOptions {
  size?: number;
  title?: string;
}
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) =>
  "#" + hx(a).map((v, i) => Math.round(v + (hx(b)[i]! - v) * t).toString(16).padStart(2, "0")).join("");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type P = readonly [number, number];
const star4 = (x: number, y: number, r: number) => `M${f1(x)} ${f1(y - r)} Q${f1(x + r * 0.15)} ${f1(y - r * 0.15)} ${f1(x + r)} ${f1(y)} Q${f1(x + r * 0.15)} ${f1(y + r * 0.15)} ${f1(x)} ${f1(y + r)} Q${f1(x - r * 0.15)} ${f1(y + r * 0.15)} ${f1(x - r)} ${f1(y)} Q${f1(x - r * 0.15)} ${f1(y - r * 0.15)} ${f1(x)} ${f1(y - r)}Z`;
function smooth(pts: readonly P[]): string {
  const n = pts.length;
  let d = `M${f1(pts[0]![0])} ${f1(pts[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + "Z";
}

type Ear = readonly [fx: number, angle: number, length: number, far: boolean];
interface View {
  cx: number; rx: number; H: number; ground: number; flat: number; peak: number; asym: number;
  eyes: readonly (readonly [fx: number, fy: number, r: number])[];
  ears: readonly Ear[];
  blush: readonly P[];
  mouth: P;
}
const V: View = {
  ground: 100, flat: 0.48, peak: 0, asym: 0, cx: 58, rx: 39, H: 54,
  eyes: [[0.24, 0.4, 3.4], [0.68, 0.35, 2.9]],
  ears: [[-0.04, -22, 30, true], [0.34, 6, 32, false]],
  blush: [[0.08, 0.56], [0.8, 0.5]],
  mouth: [0.47, 0.5],
};

interface Body { pts: P[]; cy: number; top: number; d: string }
function body(v: View): Body {
  const N = 96, pts: P[] = [], ry = v.H / (1 + v.flat), cy = v.ground - ry * v.flat, L = 0.018;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 2 * Math.PI, c = Math.cos(t), s = -Math.sin(t);
    const lu = 1 + L * (Math.sin(5 * t) + 0.6 * Math.sin(9 * t));
    const x = v.cx + v.rx * c * (s > 0 ? lu : 1) * (1 - v.peak * Math.max(0, s) ** 2.5);
    const y = s > 0 ? cy - ry * s * lu * (1 + v.asym * -c) : cy - ry * v.flat * s;
    pts.push([x, y]);
  }
  return { pts, cy, top: Math.min(...pts.map((p) => p[1])), d: smooth(pts) };
}
function topAt(b: Body, x: number): number {
  let best = Infinity;
  for (let i = 0; i < b.pts.length; i++) {
    const a = b.pts[i]!, c = b.pts[(i + 1) % b.pts.length]!;
    if (a[1] > b.cy || c[1] > b.cy) continue;
    if ((x - a[0]) * (x - c[0]) <= 0) best = Math.min(best, a[1] + (c[1] - a[1]) * ((x - a[0]) / (c[0] - a[0] || 1e-6)));
  }
  return best;
}

interface LeafShape { d: string; vein: string; fill: string; veinFill: string; needles?: boolean }
const LEAVES: Record<LeafName, (L: number) => LeafShape> = {
  camellia: (L) => { const w = L * 0.4; return { d: `M0 0 C${f1(w * 1.05)} ${f1(-L * 0.2)} ${f1(w * 0.95)} ${f1(-L * 0.74)} 0 ${f1(-L)} C${f1(-w * 0.95)} ${f1(-L * 0.74)} ${f1(-w * 1.05)} ${f1(-L * 0.2)} 0 0Z`, vein: `M0 -1 Q${f1(w * 0.14)} ${f1(-L * 0.5)} 0 ${f1(-L * 0.9)}`, fill: "#2F5E3B", veinFill: "#6FA86F" }; },
  nandina: (L) => { const w = L * 0.25; return { d: `M0 0 C${f1(w * 1.1)} ${f1(-L * 0.25)} ${f1(w)} ${f1(-L * 0.75)} 0 ${f1(-L)} C${f1(-w)} ${f1(-L * 0.75)} ${f1(-w * 1.1)} ${f1(-L * 0.25)} 0 0Z`, vein: `M0 -1 Q${f1(w * 0.15)} ${f1(-L * 0.5)} 0 ${f1(-L * 0.9)}`, fill: "#3B6E3E", veinFill: "#7DB07A" }; },
  bamboo: (L) => { const w = L * 0.17; L *= 1.12; return { d: `M0 0 C${f1(w * 1.2)} ${f1(-L * 0.3)} ${f1(w * 0.9)} ${f1(-L * 0.8)} 0 ${f1(-L)} C${f1(-w * 0.9)} ${f1(-L * 0.8)} ${f1(-w * 1.2)} ${f1(-L * 0.3)} 0 0Z`, vein: `M0 -1 L0 ${f1(-L * 0.9)}`, fill: "#5E8F3A", veinFill: "#9CC56E" }; },
  pine: (L) => ({ needles: true, d: `M0 0 Q${f1(L * 0.08)} ${f1(-L * 0.5)} ${f1(-L * 0.14)} ${f1(-L)} M0 0 Q${f1(L * 0.02)} ${f1(-L * 0.5)} ${f1(L * 0.1)} ${f1(-L * 0.98)} M0 0 Q${f1(L * 0.16)} ${f1(-L * 0.45)} ${f1(L * 0.3)} ${f1(-L * 0.86)} M0 0 Q${f1(-L * 0.1)} ${f1(-L * 0.45)} ${f1(-L * 0.32)} ${f1(-L * 0.84)}`, vein: "", fill: "#3E6B44", veinFill: "" }),
  sakura: (L) => { L *= 0.85; const w = L * 0.46; return { d: `M0 0 C${f1(w)} ${f1(-L * 0.18)} ${f1(w * 1.12)} ${f1(-L * 0.78)} ${f1(w * 0.38)} ${f1(-L)} Q${f1(w * 0.12)} ${f1(-L * 1.02)} 0 ${f1(-L * 0.86)} Q${f1(-w * 0.12)} ${f1(-L * 1.02)} ${f1(-w * 0.38)} ${f1(-L)} C${f1(-w * 1.12)} ${f1(-L * 0.78)} ${f1(-w)} ${f1(-L * 0.18)} 0 0Z`, vein: `M0 -2 L0 ${f1(-L * 0.4)}`, fill: "#F2A3B3", veinFill: "#FBD3DB" }; },
  ume: (L) => { L *= 0.8; const w = L * 0.5; return { d: `M0 0 C${f1(w)} ${f1(-L * 0.15)} ${f1(w * 1.15)} ${f1(-L * 0.78)} 0 ${f1(-L)} C${f1(-w * 1.15)} ${f1(-L * 0.78)} ${f1(-w)} ${f1(-L * 0.15)} 0 0Z`, vein: `M0 -2 L0 ${f1(-L * 0.35)}`, fill: "#F6CCD6", veinFill: "#FCEBEF" }; },
  momiji: (L) => {
    const pts: P[] = [], lobes = [[-90, 1], [-36, 0.84], [-144, 0.84], [12, 0.48], [168, 0.48]] as const, R = L * 0.55, cy = -L * 0.44;
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * 360 - 180;
      let r = 0.24;
      for (const [la, k] of lobes) { const d = Math.abs(((a - la + 540) % 360) - 180); r = Math.max(r, 0.24 + 0.76 * k * Math.exp(-((d / 16) ** 2))); }
      pts.push([Math.cos((a * Math.PI) / 180) * r * R, Math.sin((a * Math.PI) / 180) * r * R + cy]);
    }
    return { d: smooth(pts), vein: `M0 0 L0 ${f1(cy)} L0 ${f1(cy - R * 0.88)} M0 ${f1(cy)} L${f1(R * 0.68)} ${f1(cy - R * 0.5)} M0 ${f1(cy)} L${f1(-R * 0.68)} ${f1(cy - R * 0.5)}`, fill: "#D8572E", veinFill: "#F49A62" };
  },
  ginkgo: (L) => ({ d: `M0 0 C${f1(-L * 0.05)} ${f1(-L * 0.35)} ${f1(-L * 0.42)} ${f1(-L * 0.6)} ${f1(-L * 0.5)} ${f1(-L * 0.82)} Q${f1(-L * 0.3)} ${f1(-L * 1.04)} ${f1(-L * 0.05)} ${f1(-L * 0.93)} Q0 ${f1(-L * 0.84)} ${f1(L * 0.05)} ${f1(-L * 0.93)} Q${f1(L * 0.3)} ${f1(-L * 1.04)} ${f1(L * 0.5)} ${f1(-L * 0.82)} C${f1(L * 0.42)} ${f1(-L * 0.6)} ${f1(L * 0.05)} ${f1(-L * 0.35)} 0 0Z`, vein: `M0 -2 L${f1(-L * 0.3)} ${f1(-L * 0.82)} M0 -2 L0 ${f1(-L * 0.8)} M0 -2 L${f1(L * 0.3)} ${f1(-L * 0.82)}`, fill: "#E2AC34", veinFill: "#F6D27A" }),
  susuki: (L) => { L *= 1.15; const w = L * 0.13; return { d: `M0 0 C${f1(w * 1.3)} ${f1(-L * 0.35)} ${f1(w)} ${f1(-L * 0.8)} 0 ${f1(-L)} C${f1(-w)} ${f1(-L * 0.8)} ${f1(-w * 1.3)} ${f1(-L * 0.35)} 0 0Z`, vein: `M0 ${f1(-L * 0.45)} L0 ${f1(-L * 0.95)}`, fill: "#C4A56A", veinFill: "#F3E6C4" }; },
};

type EyeMode = "open" | "happy" | "sleepy" | "love" | "sparkle" | "flat" | "spiral" | "squeeze" | "squeezeR";
interface Mood { ears: (e: Ear, i: number) => Ear; eyes: (i: number) => EyeMode; gaze: P; scale: number; blush?: number; tear?: boolean }
const same = (e: Ear) => e;
const open = () => "open" as const;
const tilt = (near: number, far: number, k = 1) => (e: Ear, i: number): Ear => [e[0], e[1] + (i === 0 ? far : near), e[2] * k, e[3]];
const MOODS: Record<MoodName, Mood> = {
  calm: { ears: same, eyes: open, gaze: [0, 0], scale: 1 },
  happy: { ears: tilt(14, -14), eyes: () => "happy", gaze: [0, 0], scale: 1 },
  wink: { ears: same, eyes: (i) => (i === 1 ? "happy" : "open"), gaze: [0, 0], scale: 1 },
  curious: { ears: tilt(62, 0, 0.95), eyes: open, gaze: [1, -0.4], scale: 1 },
  thinking: { ears: tilt(-6, -6), eyes: open, gaze: [0.6, -1.3], scale: 1 },
  surprised: { ears: (e) => [e[0], e[1] * 0.25, e[2] * 1.08, e[3]], eyes: open, gaze: [0, 0], scale: 1.18 },
  shy: { ears: tilt(-16, 16, 0.9), eyes: open, gaze: [0, 1], scale: 1, blush: 0.9 },
  love: { ears: tilt(8, -8), eyes: () => "love", gaze: [0, 0], scale: 1, blush: 0.65 },
  sleepy: { ears: tilt(-30, -52, 0.92), eyes: () => "sleepy", gaze: [0, 0], scale: 1 },
  excited: { ears: (e, i) => [e[0], e[1] * 0.2 + (i === 0 ? -10 : 10), e[2] * 1.1, e[3]], eyes: () => "sparkle", gaze: [0, -0.3], scale: 1.12 },
  laugh: { ears: tilt(20, -20), eyes: (i) => (i === 0 ? "squeeze" : "squeezeR"), gaze: [0, 0], scale: 1, blush: 0.65 },
  sad: { ears: tilt(-48, -62, 0.9), eyes: open, gaze: [0, 1.1], scale: 1, tear: true },
  pouty: { ears: tilt(-24, -36), eyes: () => "flat", gaze: [0, 0], scale: 1, blush: 0.95 },
  dizzy: { ears: tilt(38, -46), eyes: () => "spiral", gaze: [0, 0], scale: 1 },
};

const BERRY: Record<EyeName, readonly [string, string]> = {
  nanten: ["#C22F2A", "#DE4638"], kuromame: ["#1E1A1E", "#2E282E"], kohaku: ["#C9781E", "#EBA23C"],
  blueberry: ["#34458A", "#5266B0"], ume: ["#7A2A48", "#A23E64"], ice: ["#5E9FC4", "#9FD4EC"],
};
function eye(type: EyeName, x: number, y: number, r: number, mode: EyeMode, g: P): string {
  const [dark, light] = BERRY[type];
  if (mode === "happy") return `<path d="M${f1(x - r)} ${f1(y + 1)} Q${f1(x)} ${f1(y - r * 1.5)} ${f1(x + r)} ${f1(y + 1)}" fill="none" stroke="${dark}" stroke-width="${f1(r * 0.8)}" stroke-linecap="round"/>`;
  if (mode === "sleepy") return `<path d="M${f1(x - r)} ${f1(y - 0.5)} Q${f1(x)} ${f1(y + r * 1.2)} ${f1(x + r)} ${f1(y - 0.5)}" fill="none" stroke="${dark}" stroke-width="${f1(r * 0.7)}" stroke-linecap="round"/>`;
  if (mode === "flat") return `<path d="M${f1(x - r)} ${f1(y + 0.4)} Q${f1(x)} ${f1(y - 0.4)} ${f1(x + r)} ${f1(y + 0.6)}" fill="none" stroke="${dark}" stroke-width="${f1(r * 0.7)}" stroke-linecap="round"/>`;
  if (mode === "squeezeR") return `<path d="M${f1(x + r)} ${f1(y - r * 0.8)} L${f1(x - r * 0.7)} ${f1(y)} L${f1(x + r)} ${f1(y + r * 0.8)}" fill="none" stroke="${dark}" stroke-width="${f1(r * 0.6)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (mode === "squeeze") return `<path d="M${f1(x - r)} ${f1(y - r * 0.8)} L${f1(x + r * 0.7)} ${f1(y)} L${f1(x - r)} ${f1(y + r * 0.8)}" fill="none" stroke="${dark}" stroke-width="${f1(r * 0.6)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (mode === "spiral") { let d = ""; for (let k = 0; k <= 28; k++) { const a = k * 0.62, rr = (r * 1.15 * k) / 28; d += `${k ? "L" : "M"}${f1(x + Math.cos(a) * rr)} ${f1(y + Math.sin(a) * rr)} `; } return `<path d="${d.trim()}" fill="none" stroke="${dark}" stroke-width="${f1(r * 0.36)}" stroke-linecap="round" stroke-linejoin="round"/>`; }
  if (mode === "love") { const s = r * 1.25; return `<path d="M${f1(x)} ${f1(y + s * 0.9)} C${f1(x - s * 1.4)} ${f1(y - s * 0.1)} ${f1(x - s * 0.8)} ${f1(y - s * 1.25)} ${f1(x)} ${f1(y - s * 0.45)} C${f1(x + s * 0.8)} ${f1(y - s * 1.25)} ${f1(x + s * 1.4)} ${f1(y - s * 0.1)} ${f1(x)} ${f1(y + s * 0.9)}Z" fill="${light}"/><circle cx="${f1(x - s * 0.42)}" cy="${f1(y - s * 0.42)}" r="${f1(s * 0.2)}" fill="#fff"/>`; }
  x += g[0]; y += g[1];
  if (type === "ice") return `<path d="M${f1(x)} ${f1(y - r * 1.3)} Q${f1(x + r * 0.35)} ${f1(y - r * 0.35)} ${f1(x + r * 1.05)} ${f1(y)} Q${f1(x + r * 0.35)} ${f1(y + r * 0.35)} ${f1(x)} ${f1(y + r * 1.3)} Q${f1(x - r * 0.35)} ${f1(y + r * 0.35)} ${f1(x - r * 1.05)} ${f1(y)} Q${f1(x - r * 0.35)} ${f1(y - r * 0.35)} ${f1(x)} ${f1(y - r * 1.3)}Z" fill="${light}" stroke="${dark}" stroke-width=".9"/><circle cx="${f1(x - r * 0.22)}" cy="${f1(y - r * 0.4)}" r="${f1(r * 0.24)}" fill="#fff"/>`;
  if (type === "kuromame") return `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(r * 0.86)}" ry="${f1(r * 1.12)}" fill="${dark}"/><ellipse cx="${f1(x - r * 0.28)}" cy="${f1(y - r * 0.42)}" rx="${f1(r * 0.24)}" ry="${f1(r * 0.4)}" fill="#fff" opacity=".9"/>`;
  let s = `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${dark}"/><circle cx="${f1(x - r * 0.14)}" cy="${f1(y - r * 0.16)}" r="${f1(r * 0.78)}" fill="${light}"/>`;
  if (mode === "sparkle") return s + `<path d="${star4(x - r * 0.3, y - r * 0.3, r * 0.62)}" fill="#fff"/><circle cx="${f1(x + r * 0.4)}" cy="${f1(y + r * 0.4)}" r="${f1(r * 0.16)}" fill="#fff"/>`;
  if (type === "blueberry") s += `<path d="M${f1(x + r * 0.3)} ${f1(y - r * 0.95)} l${f1(r * 0.18)} ${f1(r * 0.28)} l${f1(r * 0.3)} ${f1(-r * 0.06)}" fill="none" stroke="${dark}" stroke-width=".8" stroke-linecap="round"/>`;
  return s + `<circle cx="${f1(x - r * 0.38)}" cy="${f1(y - r * 0.4)}" r="${f1(r * 0.3)}" fill="#fff"/>`;
}

interface Ctx { v: View; b: Body; eyes: readonly (readonly [number, number, number])[] }
interface Layers { clipped?: string; underEar?: string; front?: string }
const X = (c: Ctx, fx: number) => c.v.cx + fx * c.v.rx;
const T = (c: Ctx, fx: number) => topAt(c.b, X(c, fx));
const scaled = (x: number, y: number, k: number, inner: string) => `<g transform="translate(${f1(x)} ${f1(y)}) scale(${k}) translate(${f1(-x)} ${f1(-y)})">${inner}</g>`;
function flower(x: number, y: number, r: number, petal: string, centre: string, rot = 0): string {
  let s = `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${rot})">`;
  for (let k = 0; k < 5; k++) { const a = ((k * 72) * Math.PI) / 180 - Math.PI / 2; s += `<circle cx="${f1(Math.cos(a) * r * 0.62)}" cy="${f1(Math.sin(a) * r * 0.62)}" r="${f1(r * 0.55)}" fill="${petal}"/>`; }
  return s + `<circle r="${f1(r * 0.3)}" fill="${centre}"/></g>`;
}
const CHARMS: Record<CharmName, (c: Ctx) => Layers> = {
  camellia: (c) => ({ front: flower(X(c, 0.52), T(c, 0.52) + 3, 6, "#D23A4C", "#F2C94C", 12) }),
  sprig: (c) => {
    const x = X(c, 0.5), y = T(c, 0.5) + 3;
    return { front: `<path d="M${f1(x)} ${f1(y)} C${f1(x + 4)} ${f1(y - 5)} ${f1(x + 8)} ${f1(y - 8)} ${f1(x + 13)} ${f1(y - 10)} M${f1(x + 7)} ${f1(y - 6.5)} L${f1(x + 9)} ${f1(y - 1.5)}" fill="none" stroke="#6B4A3A" stroke-width="1.5" stroke-linecap="round"/>` + flower(x + 13, y - 10, 4, "#F4B6C4", "#D9707F") + flower(x + 9.4, y - 1, 3, "#F8CCD6", "#D9707F", 20) };
  },
  hydrangea: (c) => {
    const x = X(c, 0.5), y = T(c, 0.5) + 2, cols = ["#8FA6E2", "#A99BDB", "#B7C4EE", "#9C8FD6", "#8FB2E4", "#BBAEE8"];
    const florets = ([[0, 0], [4.2, -1.5], [-4, -1.8], [2.2, -5], [-2, -5.2], [0, 3.2]] as const).map(([dx, dy], i) => {
      const cx = x + dx, cy = y + dy;
      return [0, 1, 2, 3].map((k) => { const a = (k * Math.PI) / 2 + 0.5; return `<circle cx="${f1(cx + Math.cos(a) * 1.3)}" cy="${f1(cy + Math.sin(a) * 1.3)}" r="1.25" fill="${cols[i]}"/>`; }).join("") + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r=".5" fill="#F4F2FA"/>`;
    }).join("");
    return { front: scaled(x, y, 1.5, florets) };
  },
  mizuhiki: (c) => {
    const x = X(c, 0.16), y = T(c, 0.16) + 2;
    return { front: `<g transform="translate(${f1(x)} ${f1(y)}) scale(1.35)"><path d="M0 0 C-6 -7 -11 -1 -6 2.5 C-3 4.5 -1 2 0 0 C1 2 3 4.5 6 2.5 C11 -1 6 -7 0 0Z" fill="none" stroke="#C8333B" stroke-width="1.8" stroke-linejoin="round"/><path d="M0 0 C-4.5 -4 -7 -.5 -4.6 1.2 M0 0 C4.5 -4 7 -.5 4.6 1.2" fill="none" stroke="#F6EFE6" stroke-width="1.2" stroke-linecap="round"/><path d="M-.5 1 L-3.5 8 M.5 1 L3.5 8" stroke="#C8333B" stroke-width="1.5" stroke-linecap="round"/><circle r="1.6" fill="#C8333B"/></g>` };
  },
  suzu: ({ v }) => {
    const y1 = v.ground - v.H * 0.42, x0 = v.cx - v.rx * 0.9, x1 = v.cx + v.rx * 0.95, bx = v.cx + v.rx * 0.42, by = v.ground - v.H * 0.27;
    return { front: `<path d="M${f1(x0)} ${f1(y1)} Q${f1(v.cx + v.rx * 0.2)} ${f1(y1 + 9)} ${f1(x1)} ${f1(y1 - 2)}" fill="none" stroke="#C8333B" stroke-width="1.8" stroke-linecap="round"/><circle cx="${f1(bx)}" cy="${f1(by)}" r="4.4" fill="#E2B23C" stroke="#A97A1C" stroke-width=".9"/><path d="M${f1(bx - 2.6)} ${f1(by + 1)} H${f1(bx + 2.6)} M${f1(bx)} ${f1(by + 1)} V${f1(by + 3.6)}" stroke="#7A5614" stroke-width=".9" stroke-linecap="round"/><circle cx="${f1(bx - 1.4)}" cy="${f1(by - 1.6)}" r="1.1" fill="#FFF3C8"/>` };
  },
  beret: (c) => {
    const x = X(c, 0.22), y = T(c, 0.22) + 2.5;
    return { front: `<g transform="rotate(-10 ${f1(x)} ${f1(y)})"><ellipse cx="${f1(x)}" cy="${f1(y)}" rx="18" ry="7.4" fill="#B1474C"/><ellipse cx="${f1(x)}" cy="${f1(y + 3.2)}" rx="15.5" ry="2.4" fill="#8E363B"/><circle cx="${f1(x + 1)}" cy="${f1(y - 6.2)}" r="1.7" fill="#B1474C"/></g>` };
  },
  glasses: ({ eyes }) => {
    if (eyes.length < 2) return {};
    const [a, b] = eyes as [readonly [number, number, number], readonly [number, number, number]], r1 = a[2] + 2.8, r2 = b[2] + 2.4;
    return { front: `<g fill="#fff" fill-opacity=".12" stroke="#4A3A30" stroke-width="1.3"><circle cx="${f1(a[0])}" cy="${f1(a[1])}" r="${f1(r1)}"/><circle cx="${f1(b[0])}" cy="${f1(b[1])}" r="${f1(r2)}"/></g><path d="M${f1(a[0] + r1)} ${f1(a[1] - 1)} Q${f1((a[0] + b[0]) / 2)} ${f1(a[1] - 4)} ${f1(b[0] - r2)} ${f1(b[1] - 1)} M${f1(a[0] - r1)} ${f1(a[1] - 0.5)} L${f1(a[0] - r1 - 5)} ${f1(a[1] - 2.5)}" fill="none" stroke="#4A3A30" stroke-width="1.3" stroke-linecap="round"/>` };
  },
  headphones: (c) => {
    const xa = X(c, -0.62), xb = X(c, 0.9), top = T(c, 0) - 11;
    const band = `M${f1(xa)} ${f1(T(c, -0.62) + 9)} C${f1(xa - 2)} ${f1(top)} ${f1(xb + 2)} ${f1(top)} ${f1(xb)} ${f1(T(c, 0.9) + 9)}`;
    const ya = T(c, -0.62) + 11, yb = T(c, 0.9) + 11;
    return {
      underEar: `<path d="${band}" fill="none" stroke="#5E5A55" stroke-width="4.6" stroke-linecap="round"/><path d="${band}" fill="none" stroke="#EDE6DB" stroke-width="2.6" stroke-linecap="round"/>`,
      front: `<ellipse cx="${f1(xb + 1)}" cy="${f1(yb)}" rx="3.2" ry="5.4" fill="#7E9A86" stroke="#4E5E52" stroke-width="1"/><ellipse cx="${f1(xa)}" cy="${f1(ya)}" rx="5" ry="7" fill="#9BB5A2" stroke="#4E5E52" stroke-width="1.1"/><ellipse cx="${f1(xa - 1.2)}" cy="${f1(ya - 2)}" rx="1.4" ry="2.2" fill="#fff" opacity=".45"/>`,
    };
  },
  snowflake: (c) => {
    const x = X(c, 0.5), y = T(c, 0.5) + 4.5;
    let d = "";
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3, cs = Math.cos(a), sn = Math.sin(a), bx = x + cs * 2.8, by = y + sn * 2.8;
      d += `M${f1(x)} ${f1(y)} L${f1(x + cs * 4.6)} ${f1(y + sn * 4.6)} M${f1(bx)} ${f1(by)} L${f1(bx + Math.cos(a + 0.8) * 1.6)} ${f1(by + Math.sin(a + 0.8) * 1.6)} M${f1(bx)} ${f1(by)} L${f1(bx + Math.cos(a - 0.8) * 1.6)} ${f1(by + Math.sin(a - 0.8) * 1.6)} `;
    }
    return { front: scaled(x, y, 1.45, `<path d="${d.trim()}" stroke="#6FB3D6" stroke-width="1.3" stroke-linecap="round"/>`) };
  },
  ribbon: (c) => {
    const x = X(c, 0.42), y = T(c, 0.42) + 2;
    return { front: `<g transform="translate(${f1(x)} ${f1(y)}) rotate(-12) scale(1.3)"><path d="M0 0 C-3 -6 -10 -6 -9.5 -.5 C-9 4 -3 3.4 0 0Z M0 0 C3 -6 10 -6 9.5 -.5 C9 4 3 3.4 0 0Z" fill="#E88FA3"/><path d="M-.6 .6 L-3.6 7 M.6 .6 L3.4 7.2" stroke="#E88FA3" stroke-width="2" stroke-linecap="round"/><path d="M-6.5 -1.5 C-5 -3 -3 -2.4 -1.5 -.8 M6.5 -1.5 C5 -3 3 -2.4 1.5 -.8" fill="none" stroke="#C86E84" stroke-width=".9" stroke-linecap="round"/><circle r="2" fill="#C86E84"/></g>` };
  },
  star: (c) => {
    const x = X(c, 0.5), y = T(c, 0.5) + 2.5;
    let d = "";
    for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 - Math.PI / 2, r = k % 2 ? 2.6 : 6; d += `${k ? "L" : "M"}${f1(x + Math.cos(a) * r)} ${f1(y + Math.sin(a) * r)} `; }
    return { front: `<path d="${d}Z" fill="#F2C94C" stroke="#D9A72E" stroke-width="1.2" stroke-linejoin="round"/>` };
  },
  moon: (c) => {
    const x = X(c, 0.5), y = T(c, 0.5) + 1;
    return { front: `<path d="M${f1(x + 2)} ${f1(y - 7)} A7 7 0 1 0 ${f1(x + 6.5)} ${f1(y + 3.5)} A5.6 5.6 0 1 1 ${f1(x + 2)} ${f1(y - 7)}Z" fill="#F4D77A" stroke="#D8B451" stroke-width=".9"/>` };
  },
  kanzashi: (c) => {
    const x0 = X(c, -0.2), y0 = T(c, -0.2) - 7, x1 = X(c, 0.45), y1 = T(c, 0.45) + 5;
    return { front: `<path d="M${f1(x0)} ${f1(y0)} L${f1(x1)} ${f1(y1)}" stroke="#7A4E34" stroke-width="2.4" stroke-linecap="round"/>` + flower(x0, y0, 5, "#F2A3B3", "#F7E1A8", 18) + `<path d="M${f1(x0 + 1)} ${f1(y0 + 4)} V${f1(y0 + 11)} M${f1(x0 + 4)} ${f1(y0 + 3)} V${f1(y0 + 9)}" stroke="#C9A24A" stroke-width=".9"/><circle cx="${f1(x0 + 1)}" cy="${f1(y0 + 12)}" r="1.4" fill="#D23A4C"/><circle cx="${f1(x0 + 4)}" cy="${f1(y0 + 10)}" r="1.2" fill="#F2C94C"/>` };
  },
  omamori: ({ v }) => {
    const y1 = v.ground - v.H * 0.42, x0 = v.cx - v.rx * 0.9, x1 = v.cx + v.rx * 0.95, bx = v.cx + v.rx * 0.42, by = v.ground - v.H * 0.3;
    return { front: `<path d="M${f1(x0)} ${f1(y1)} Q${f1(v.cx + v.rx * 0.2)} ${f1(y1 + 9)} ${f1(x1)} ${f1(y1 - 2)}" fill="none" stroke="#3E5A8C" stroke-width="1.6" stroke-linecap="round"/><path d="M${f1(bx - 4)} ${f1(by)} L${f1(bx)} ${f1(by - 3)} L${f1(bx + 4)} ${f1(by)} V${f1(by + 8)} Q${f1(bx + 4)} ${f1(by + 9.6)} ${f1(bx + 2.4)} ${f1(by + 9.6)} H${f1(bx - 2.4)} Q${f1(bx - 4)} ${f1(by + 9.6)} ${f1(bx - 4)} ${f1(by + 8)}Z" fill="#C8333B"/><path d="M${f1(bx - 4)} ${f1(by + 2.4)} H${f1(bx + 4)}" stroke="#E9C46A" stroke-width="1.2"/><path d="M${f1(bx - 1.6)} ${f1(by + 4.8)} H${f1(bx + 1.6)} M${f1(bx)} ${f1(by + 4)} V${f1(by + 7.6)}" stroke="#F6E7C8" stroke-width=".8" stroke-linecap="round"/>` };
  },
  cherries: (c) => {
    const x = X(c, 0.52), y = T(c, 0.52) - 4;
    return { front: `<path d="M${f1(x + 1)} ${f1(y - 4)} Q${f1(x - 3)} ${f1(y + 1)} ${f1(x - 3.4)} ${f1(y + 6)} M${f1(x + 1)} ${f1(y - 4)} Q${f1(x + 4)} ${f1(y + 1)} ${f1(x + 4.4)} ${f1(y + 7)}" fill="none" stroke="#5C7A3A" stroke-width="1.2" stroke-linecap="round"/><path transform="translate(${f1(x + 1)} ${f1(y - 4)}) rotate(70)" d="M0 0 C2.4 -1.2 2.4 -5 0 -6.4 C-2.4 -5 -2.4 -1.2 0 0Z" fill="#4E7C3E"/><circle cx="${f1(x - 3.4)}" cy="${f1(y + 8.6)}" r="3.4" fill="#C8303C"/><circle cx="${f1(x + 4.4)}" cy="${f1(y + 9.6)}" r="3.4" fill="#D63A46"/><circle cx="${f1(x - 4.6)}" cy="${f1(y + 7.4)}" r=".9" fill="#fff" opacity=".8"/><circle cx="${f1(x + 3.2)}" cy="${f1(y + 8.4)}" r=".9" fill="#fff" opacity=".8"/>` };
  },
  sprout: (c) => {
    const x = X(c, 0.15), y = T(c, 0.15) + 1;
    return { front: `<path d="M${f1(x)} ${f1(y)} Q${f1(x - 0.6)} ${f1(y - 4)} ${f1(x)} ${f1(y - 7)}" fill="none" stroke="#5E8F3A" stroke-width="1.5" stroke-linecap="round"/><path d="M${f1(x)} ${f1(y - 6)} C${f1(x - 2)} ${f1(y - 11)} ${f1(x - 8)} ${f1(y - 10)} ${f1(x - 8)} ${f1(y - 7)} C${f1(x - 6)} ${f1(y - 5)} ${f1(x - 2)} ${f1(y - 5)} ${f1(x)} ${f1(y - 6)}Z M${f1(x)} ${f1(y - 6)} C${f1(x + 2)} ${f1(y - 12)} ${f1(x + 8)} ${f1(y - 11)} ${f1(x + 8.4)} ${f1(y - 8)} C${f1(x + 6)} ${f1(y - 5)} ${f1(x + 2)} ${f1(y - 5)} ${f1(x)} ${f1(y - 6)}Z" fill="#7DB65A"/>` };
  },
  clover: (c) => {
    const x = X(c, 0.5), y = T(c, 0.5) + 2.5;
    const leaves = [0, 1, 2, 3].map((k) => `<path transform="translate(${f1(x)} ${f1(y)}) rotate(${k * 90 + 45})" d="M0 0 C-3.6 -1.4 -3.8 -5.4 -1.6 -5.6 C-.6 -5.6 0 -4.8 0 -4 C0 -4.8 .6 -5.6 1.6 -5.6 C3.8 -5.4 3.6 -1.4 0 0Z" fill="#5E9E4E"/>`).join("");
    return { front: `<path d="M${f1(x)} ${f1(y)} Q${f1(x + 2)} ${f1(y + 4)} ${f1(x + 4)} ${f1(y + 6)}" fill="none" stroke="#4E7C3E" stroke-width="1.2" stroke-linecap="round"/>${leaves}<circle cx="${f1(x)}" cy="${f1(y)}" r="1" fill="#3E6B3A"/>` };
  },
  bandage: (c) => {
    const x = X(c, 0.84), y = T(c, 0.84) + c.v.H * 0.36;
    return { front: `<g transform="translate(${f1(x)} ${f1(y)}) rotate(-28)"><rect x="-6.5" y="-2.4" width="13" height="4.8" rx="2.4" fill="#E9B48A" stroke="#C98C5E" stroke-width=".6"/><rect x="-2.2" y="-2.4" width="4.4" height="4.8" fill="#F4D3B4"/><circle cx="-.9" cy="-.9" r=".4" fill="#C99A6E"/><circle cx=".9" cy=".9" r=".4" fill="#C99A6E"/><circle cx=".9" cy="-.9" r=".4" fill="#C99A6E"/><circle cx="-.9" cy=".9" r=".4" fill="#C99A6E"/></g>` };
  },
  mikan: (c) => {
    const x = X(c, 0.15), y = T(c, 0.15) - 4;
    return { front: scaled(x, y, 1.3, `<circle cx="${f1(x)}" cy="${f1(y)}" r="7" fill="#EE8A33"/><path d="M${f1(x - 6)} ${f1(y + 3)} Q${f1(x)} ${f1(y + 9)} ${f1(x + 6)} ${f1(y + 3)} Q${f1(x)} ${f1(y + 7)} ${f1(x - 6)} ${f1(y + 3)}Z" fill="#D27126"/><circle cx="${f1(x - 2.4)}" cy="${f1(y - 2.6)}" r="1.5" fill="#FFD9AE"/><path transform="translate(${f1(x + 1)} ${f1(y - 6)}) rotate(48)" d="M0 0 C3 -1.5 3 -6 0 -8 C-3 -6 -3 -1.5 0 0Z" fill="#3B6E3E"/>`) };
  },
};

const OUTFITS: Record<OutfitName, (c: Ctx) => Layers> = {
  scarf: ({ v }) => {
    const y = v.ground - v.H * 0.5, l = v.cx - v.rx * 1.2, r = v.cx + v.rx * 1.2, m = v.cx + v.rx * 0.1, x = v.cx + v.rx * 0.62, ty = y + 8;
    return {
      clipped: `<path d="M${f1(l)} ${f1(y - 2)} Q${f1(m)} ${f1(y + 8)} ${f1(r)} ${f1(y - 4)} L${f1(r)} ${f1(y + 4)} Q${f1(m)} ${f1(y + 16)} ${f1(l)} ${f1(y + 6)}Z" fill="#C4574E"/><path d="M${f1(l)} ${f1(y + 2)} Q${f1(m)} ${f1(y + 12)} ${f1(r)} ${f1(y)}" fill="none" stroke="#E9B9A8" stroke-width=".9" stroke-dasharray="2 2.4"/>`,
      front: `<path d="M${f1(x)} ${f1(ty - 1)} C${f1(x + 3)} ${f1(ty + 5)} ${f1(x + 2)} ${f1(ty + 12)} ${f1(x + 5)} ${f1(ty + 17)} L${f1(x + 11)} ${f1(ty + 15)} C${f1(x + 8)} ${f1(ty + 10)} ${f1(x + 8)} ${f1(ty + 4)} ${f1(x + 6)} ${f1(ty - 2)}Z" fill="#B44C44"/><path d="M${f1(x + 5)} ${f1(ty + 17)} l.4 2.4 M${f1(x + 8)} ${f1(ty + 16)} l.6 2.4 M${f1(x + 11)} ${f1(ty + 15)} l.8 2.2" stroke="#B44C44" stroke-width="1.2" stroke-linecap="round"/>`,
    };
  },
  hachimaki: ({ v, b }) => {
    const y0 = b.top + v.H * 0.2, l = v.cx - v.rx * 1.2, r = v.cx + v.rx * 1.2, m = v.cx;
    const kx = v.cx - v.rx * 0.9, ky = y0 + 6;
    return {
      clipped: `<path d="M${f1(l)} ${f1(y0)} Q${f1(m)} ${f1(y0 + 5)} ${f1(r)} ${f1(y0 - 3)} L${f1(r)} ${f1(y0 + 5)} Q${f1(m)} ${f1(y0 + 13)} ${f1(l)} ${f1(y0 + 8)}Z" fill="#3E5A8C"/>` +
        [0.1, 0.35, 0.6, -0.2, -0.5].map((k) => `<circle cx="${f1(v.cx + k * v.rx)}" cy="${f1(y0 + 5.6 - k * 3)}" r="1" fill="#F2EEE6"/>`).join(""),
      front: `<path d="M${f1(kx)} ${f1(ky)} C${f1(kx - 6)} ${f1(ky - 2)} ${f1(kx - 11)} ${f1(ky + 2)} ${f1(kx - 13)} ${f1(ky + 7)} L${f1(kx - 9)} ${f1(ky + 7)} C${f1(kx - 8)} ${f1(ky + 4)} ${f1(kx - 4)} ${f1(ky + 2)} ${f1(kx)} ${f1(ky + 2)}Z M${f1(kx)} ${f1(ky)} C${f1(kx - 5)} ${f1(ky - 6)} ${f1(kx - 10)} ${f1(ky - 7)} ${f1(kx - 14)} ${f1(ky - 4)} L${f1(kx - 11)} ${f1(ky - 1)} C${f1(kx - 8)} ${f1(ky - 3)} ${f1(kx - 4)} ${f1(ky - 2)} ${f1(kx)} ${f1(ky + 1)}Z" fill="#33496F"/><circle cx="${f1(kx)}" cy="${f1(ky + 1)}" r="2.6" fill="#3E5A8C"/>`,
    };
  },
  obi: ({ v }) => {
    const y0 = v.ground - v.H * 0.5, l = v.cx - v.rx * 1.2, r = v.cx + v.rx * 1.2, m = v.cx + v.rx * 0.1, bx = v.cx - v.rx * 0.96, by = y0 + 6;
    return {
      clipped: `<path d="M${f1(l)} ${f1(y0)} Q${f1(m)} ${f1(y0 + 8)} ${f1(r)} ${f1(y0 - 3)} L${f1(r)} ${f1(y0 + 8)} Q${f1(m)} ${f1(y0 + 19)} ${f1(l)} ${f1(y0 + 12)}Z" fill="#8C4A6B"/><path d="M${f1(l)} ${f1(y0 + 6)} Q${f1(m)} ${f1(y0 + 14)} ${f1(r)} ${f1(y0 + 2.5)}" fill="none" stroke="#E9C46A" stroke-width="1.3"/>`,
      front: `<ellipse cx="${f1(bx - 5)}" cy="${f1(by - 3)}" rx="6" ry="4" transform="rotate(-25 ${f1(bx - 5)} ${f1(by - 3)})" fill="#9C5679"/><ellipse cx="${f1(bx - 4)}" cy="${f1(by + 5)}" rx="5.4" ry="3.6" transform="rotate(20 ${f1(bx - 4)} ${f1(by + 5)})" fill="#9C5679"/><rect x="${f1(bx - 2.6)}" y="${f1(by - 2.6)}" width="5.2" height="6" rx="1.6" fill="#8C4A6B"/><path d="M${f1(bx - 2.4)} ${f1(by + 0.4)} H${f1(bx + 2.4)}" stroke="#E9C46A" stroke-width="1.1"/>`,
    };
  },
  bib: (c) => {
    const x = X(c, 0.42), y0 = c.v.ground - c.v.H * 0.4;
    const edge = `M${f1(x - 16)} ${f1(y0 + 1)} Q${f1(x)} ${f1(y0 + 6)} ${f1(x + 15)} ${f1(y0 - 3)}`;
    return { front: `<path d="${edge} Q${f1(x + 14)} ${f1(y0 + 10)} ${f1(x + 4)} ${f1(y0 + 16)} Q${f1(x - 2)} ${f1(y0 + 19)} ${f1(x - 8)} ${f1(y0 + 15)} Q${f1(x - 15)} ${f1(y0 + 10)} ${f1(x - 16)} ${f1(y0 + 1)}Z" fill="#C8504A"/><path d="${edge}" fill="none" stroke="#F6EFE6" stroke-width="2" stroke-linecap="round"/>${[[-7, 7], [1, 8], [8, 5], [-2, 13]].map(([dx, dy]) => `<circle cx="${f1(x + dx!)}" cy="${f1(y0 + dy!)}" r="1.3" fill="#F6EFE6" opacity=".85"/>`).join("")}` };
  },
  bowtie: (c) => {
    const x = X(c, 0.48), y = c.v.ground - c.v.H * 0.3;
    return { front: `<path d="M${f1(x)} ${f1(y)} L${f1(x - 7)} ${f1(y - 4.4)} Q${f1(x - 8.6)} ${f1(y)} ${f1(x - 7)} ${f1(y + 4.4)}Z M${f1(x)} ${f1(y)} L${f1(x + 7)} ${f1(y - 4.4)} Q${f1(x + 8.6)} ${f1(y)} ${f1(x + 7)} ${f1(y + 4.4)}Z" fill="#2F3A5A" stroke="#2F3A5A" stroke-width="1.2" stroke-linejoin="round"/><circle cx="${f1(x)}" cy="${f1(y)}" r="2" fill="#46557E"/>` };
  },
  kerchief: ({ v, b }) => {
    const edge = b.top + v.H * 0.3, l = v.cx - v.rx * 1.2, r = v.cx + v.rx * 1.2, kx = v.cx + v.rx * 0.9, ky = edge + 3;
    const dots = [[-0.6, 0.12], [-0.3, 0.05], [0, 0.13], [0.3, 0.06], [0.55, 0.16], [-0.45, 0.22], [0.15, 0.24]].map(([a, c]) => `<circle cx="${f1(v.cx + a! * v.rx)}" cy="${f1(b.top + c! * v.H)}" r="1.3" fill="#F6EFE6"/>`).join("");
    return {
      clipped: `<path d="M${f1(l)} 0 H${f1(r)} V${f1(edge - 2)} Q${f1(v.cx + v.rx * 0.2)} ${f1(edge + 7)} ${f1(l)} ${f1(edge + 2)}Z" fill="#D86A5C"/>${dots}`,
      front: `<path d="M${f1(kx)} ${f1(ky)} L${f1(kx + 7)} ${f1(ky + 2)} L${f1(kx + 4)} ${f1(ky + 7)}Z M${f1(kx)} ${f1(ky)} L${f1(kx + 2)} ${f1(ky + 9)} L${f1(kx - 3)} ${f1(ky + 6)}Z" fill="#C85B4E" stroke="#C85B4E" stroke-width="1.2" stroke-linejoin="round"/><circle cx="${f1(kx)}" cy="${f1(ky)}" r="2.2" fill="#D86A5C"/>`,
    };
  },
};

function topping(t: Topping, v: View, b: Body, rnd: () => number): string {
  const at = (fx: number, fy: number): P => [v.cx + fx * v.rx, b.top + fy * v.H];
  switch (t.kind) {
    case "cap": {
      const y0 = b.top + v.H * 0.3;
      let d = `M0 0 H120 V${f1(y0)}`;
      for (let x = 120, k = 0; x > 0; x -= 10, k++) d += ` Q${x - 5} ${f1(y0 + (k % 3 === 1 ? 11 : 3.5) * 1.3)} ${x - 10} ${f1(y0)}`;
      return `<path d="${d}Z" fill="${t.color}"/>`;
    }
    case "dust": {
      let s = "";
      for (let i = 0; i < 70; i++) s += `<circle cx="${f1(v.cx + (rnd() * 2 - 1) * v.rx)}" cy="${f1(b.top + rnd() ** 1.6 * v.H * 0.5)}" r="${f1(0.5 + rnd() * 0.7)}" fill="${t.color}" opacity=".75"/>`;
      return s;
    }
    case "petals":
      return ([[-0.5, 0.3, 20], [0.55, 0.6, -30], [-0.1, 0.15, 60]] as const).map(([a, c, r]) => { const [x, y] = at(a, c); return `<path transform="translate(${f1(x)} ${f1(y)}) rotate(${r})" d="M0 2.6 C2.6 1.4 2.6 -2 .9 -2.8 L0 -2 L-.9 -2.8 C-2.6 -2 -2.6 1.4 0 2.6Z" fill="#F2A3B3"/>`; }).join("");
    case "bubbles":
      return ([[0.5, 0.25, 2.2], [0.62, 0.42, 1.4], [-0.5, 0.5, 1.8], [-0.2, 0.2, 1.2]] as const).map(([a, c, r]) => { const [x, y] = at(a, c); return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="none" stroke="#7FB6D2" stroke-width=".9"/>`; }).join("");
    case "beans":
      return ([[-0.08, 0.06], [0.08, 0.1], [0, -0.02]] as const).map(([a, c]) => { const [x, y] = at(a, c); return `<ellipse cx="${f1(x)}" cy="${f1(y + 4)}" rx="2.6" ry="1.9" fill="#6E2A2E"/>`; }).join("");
    case "sparkles":
      return ([[0.45, 0.22, 2.6], [-0.5, 0.42, 2], [0.7, 0.55, 1.5], [-0.15, 0.14, 1.4], [0.2, 0.6, 1.2]] as const).map(([a, c, r]) => { const [x, y] = at(a, c); return `<path d="${star4(x, y, r)}" fill="${t.color}"/>`; }).join("");
    case "seeds":
      return ([[-0.3, 0.33], [0, 0.38], [0.3, 0.34], [0.55, 0.3], [-0.55, 0.3], [0.15, 0.2], [-0.15, 0.22]] as const).map(([a, c]) => { const [x, y] = at(a, c); return `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="1" ry="1.6" fill="#2A2224"/>`; }).join("");
  }
}

const SPRINKLES = ["#F2A3B3", "#F5D76E", "#8FC1E8", "#9BD3A0", "#C9A7E8"];
function pattern(p: PatternName, v: View, b: Body, accent: string, rnd: () => number): string {
  const l = v.cx - v.rx * 1.1, r = v.cx + v.rx * 1.1;
  switch (p) {
    case "mizutama": {
      let s = "";
      for (let row = 0, y = b.top + 4; y < v.ground; row++, y += 8.5) for (let x = l + (row % 2) * 5; x < r; x += 10) s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="2.2"/>`;
      return `<g fill="${accent}" opacity=".5">${s}</g>`;
    }
    case "shima": {
      let s = "";
      for (let y = b.top + 8; y < v.ground; y += 10) s += `<path d="M${f1(l)} ${f1(y)} Q${f1(v.cx - v.rx * 0.5)} ${f1(y - 2.4)} ${f1(v.cx)} ${f1(y)} T${f1(r)} ${f1(y)}"/>`;
      return `<g fill="none" stroke="${accent}" stroke-width="3.2" opacity=".38">${s}</g>`;
    }
    case "dipped": {
      const y0 = v.ground - v.H * 0.32;
      let d = `M${f1(l)} 120 V${f1(y0)}`;
      for (let x = l, k = 0; x < r; x += 9, k++) d += ` Q${f1(x + 4.5)} ${f1(y0 + (k % 3 === 1 ? -7 : 3))} ${f1(x + 9)} ${f1(y0)}`;
      return `<path d="${d} V120Z" fill="${mix(accent, "#3B2418", 0.35)}"/>`;
    }
    case "leafwrap": {
      const x0 = v.cx - v.rx * 1.3, x1 = v.cx - v.rx * 0.05;
      const veins = [0.25, 0.45, 0.65, 0.85].map((t) => `M${f1(x0 + (x1 - x0) * 0.2)} ${f1(v.ground - 2)} Q${f1(x0 + (x1 - x0) * t)} ${f1(b.top + v.H * (1 - t) * 0.8)} ${f1(x0 + (x1 - x0) * (t + 0.12))} ${f1(b.top + v.H * (0.9 - t) * 0.7)}`).join(" ");
      return `<path d="M${f1(x0)} ${f1(b.top - 5)} C${f1(v.cx - v.rx * 0.35)} ${f1(b.top)} ${f1(x1 + 6)} ${f1(v.ground - v.H * 0.45)} ${f1(x1)} ${f1(v.ground + 6)} L${f1(x0)} ${f1(v.ground + 6)}Z" fill="#8BAA5A"/><path d="${veins}" fill="none" stroke="#B9CF8C" stroke-width="1" opacity=".9"/><path d="M${f1(x0)} ${f1(b.top - 5)} C${f1(v.cx - v.rx * 0.35)} ${f1(b.top)} ${f1(x1 + 6)} ${f1(v.ground - v.H * 0.45)} ${f1(x1)} ${f1(v.ground + 6)}" fill="none" stroke="#6E8C44" stroke-width="1.4"/>`;
    }
    case "sprinkles": {
      let s = "";
      for (let i = 0; i < 24; i++) {
        const x = v.cx + (rnd() * 2 - 1) * v.rx * 0.9, y = b.top + 3 + rnd() * v.H * 0.7, a = rnd() * 180;
        s += `<path d="M-1.6 0 H1.6" transform="translate(${f1(x)} ${f1(y)}) rotate(${Math.round(a)})" stroke="${SPRINKLES[i % SPRINKLES.length]}"/>`;
      }
      return `<g stroke-width="1.7" stroke-linecap="round">${s}</g>`;
    }
    case "frost": {
      const ink = mix(accent, "#FFFFFF", 0.25);
      return ([[0.45, 0.18, 3.4], [-0.5, 0.36, 2.8], [0.72, 0.55, 2.2], [-0.15, 0.12, 2.4], [0.15, 0.5, 2], [-0.7, 0.62, 2]] as const).map(([a, c, r]) => {
        const x = v.cx + a * v.rx, y = b.top + c * v.H;
        return `<path d="M${f1(x - r)} ${f1(y)} H${f1(x + r)} M${f1(x - r / 2)} ${f1(y - r * 0.87)} L${f1(x + r / 2)} ${f1(y + r * 0.87)} M${f1(x + r / 2)} ${f1(y - r * 0.87)} L${f1(x - r / 2)} ${f1(y + r * 0.87)}" stroke="${ink}" stroke-width=".9" stroke-linecap="round"/>`;
      }).join("");
    }
    case "heart": {
      const x = v.cx - v.rx * 0.45, y = b.top + v.H * 0.48, s = 6;
      return `<path d="M${f1(x)} ${f1(y + s * 0.9)} C${f1(x - s * 1.4)} ${f1(y - s * 0.1)} ${f1(x - s * 0.8)} ${f1(y - s * 1.25)} ${f1(x)} ${f1(y - s * 0.45)} C${f1(x + s * 0.8)} ${f1(y - s * 1.25)} ${f1(x + s * 1.4)} ${f1(y - s * 0.1)} ${f1(x)} ${f1(y + s * 0.9)}Z" fill="${accent}" opacity=".75"/>`;
    }
  }
}

const tear = ([x, yy, r]: readonly [number, number, number]) =>
  `<path d="M${f1(x + 0.6)} ${f1(yy + r + 1.6)} Q${f1(x - 1.6)} ${f1(yy + r + 5)} ${f1(x + 0.6)} ${f1(yy + r + 6)} Q${f1(x + 2.8)} ${f1(yy + r + 5)} ${f1(x + 0.6)} ${f1(yy + r + 1.6)}Z" fill="#7DBCE0" stroke="#5E9FC4" stroke-width=".6" transform="translate(${f1(x)} ${f1(yy + r)}) scale(1.4) translate(${f1(-x)} ${f1(-(yy + r))})"/>`;
const mouth = ([x, yy]: P) => `<path d="M${f1(x - 2.6)} ${f1(yy)} q1.3 1.8 2.6 0 q1.3 1.8 2.6 0" fill="none" stroke="#6B5444" stroke-width="1.2" stroke-linecap="round"/>`;

/** What a mood floats over the head: thinking dots, stars, a dizzy ring, or a sleepy z. */
function marks(mood: MoodName, v: View, crown: number): string {
  if (mood === "thinking") return `<g fill="#C9D3DF">${[0, 1, 2].map((i) => `<circle cx="${f1(v.cx + v.rx * 0.55 + i * 5.5)}" cy="${f1(crown - 6)}" r="1.8" opacity="${f1(0.5 + i * 0.2)}"/>`).join("")}</g>`;
  if (mood === "excited") return `<path d="${star4(v.cx + v.rx * 0.62, crown - 6, 3.4)} ${star4(v.cx + v.rx * 0.88, crown + 3, 2.2)}" fill="#F2C94C"/>`;
  if (mood === "dizzy") return `<g fill="#F2C94C">${[0, 1, 2].map((i) => { const a = (i * 2 * Math.PI) / 3; return `<path d="${star4(v.cx + v.rx * 0.2 + Math.cos(a) * 13, crown - 8 + Math.sin(a) * 4, 2.2)}"/>`; }).join("")}</g><ellipse cx="${f1(v.cx + v.rx * 0.2)}" cy="${f1(crown - 8)}" rx="13" ry="4" fill="none" stroke="#C9D3DF" stroke-width=".8" stroke-dasharray="1.6 2"/>`;
  if (mood === "sleepy") return `<path d="M${f1(v.cx + v.rx * 0.55)} ${f1(crown - 11)} h5 l-5 6 h5 M${f1(v.cx + v.rx * 0.55 + 8)} ${f1(crown - 19)} h3.6 l-3.6 4.4 h3.6" fill="none" stroke="#BFC9D6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return "";
}

function idFor(y: AvatarTraits): string {
  return "yk" + Math.floor(stream(seedState(JSON.stringify(y), false), "id") * 2 ** 32).toString(36);
}

export function render(y: AvatarTraits, o: RenderOptions = {}): string {
  const f = FLAVOURS[y.flavour], v = V, b = body(v), mood = MOODS[y.mood], id = idFor(y);
  const ears = v.ears.map((e, i) => mood.ears(e, i));
  const leafColor = f.leaf === y.leaf ? f.leafColor : undefined;
  const accent = f.accent ?? mix(f.grain, "#000000", 0.15);

  const leaf = ([fx, angle, len, far]: Ear) => {
    const x = v.cx + fx * v.rx, L = LEAVES[y.leaf](len * 1.25);
    const fill = far ? mix(leafColor?.[0] ?? L.fill, "#000000", 0.22) : leafColor?.[0] ?? L.fill;
    const vein = far ? mix(leafColor?.[1] ?? L.veinFill, "#000000", 0.22) : leafColor?.[1] ?? L.veinFill;
    const tr = `transform="translate(${f1(x)} ${f1(topAt(b, x) + 4)}) rotate(${angle})"`;
    if (L.needles) return `<g ${tr}><path d="${L.d}" fill="none" stroke="${mix(fill, "#000000", 0.2)}" stroke-width="3.6" stroke-linecap="round"/><path d="${L.d}" fill="none" stroke="${fill}" stroke-width="2.4" stroke-linecap="round"/></g>`;
    return `<g ${tr}><path d="${L.d}" fill="${fill}"/><path d="${L.vein}" fill="none" stroke="${vein}" stroke-width="1.1" stroke-linecap="round" opacity=".85"/></g>`;
  };

  const face = (fx: number, fy: number): P => { const x = v.cx + fx * v.rx; return [x, topAt(b, x) + fy * v.H]; };
  const eyes = v.eyes.map(([fx, fy, r]) => { const [x, yy] = face(fx, fy); return [x, yy, r * 1.3] as const; });
  const ctx = { v, b, eyes };
  const charm = y.charm ? CHARMS[y.charm](ctx) : {};
  const outfit = y.outfit ? OUTFITS[y.outfit](ctx) : {};
  const rnd = mulberry(seedState(y.flavour + (y.pattern ?? ""), false));
  const tops = f.toppings ?? [];

  let g = ears.filter((e) => e[3]).map(leaf).join("");
  g += `<path d="${b.d}" fill="${f.body}"/><g clip-path="url(#${id}c)">`;
  g += tops.filter((t) => t.kind === "cap").map((t) => topping(t, v, b, rnd)).join("");
  if (y.pattern) g += pattern(y.pattern, v, b, accent, rnd);
  g += outfit.clipped ?? "";
  g += `<path d="${b.d}" fill="${f.shade}" fill-opacity=".85" mask="url(#${id}m)"/>`;
  for (let i = 0; i < 14; i++) g += `<circle cx="${f1(v.cx + (rnd() * 2 - 1) * v.rx * 0.8)}" cy="${f1(b.top + rnd() * v.H * 0.85)}" r="${f1(0.5 + rnd() * 0.5)}" fill="${f.grain}" opacity=".55"/>`;
  g += tops.filter((t) => t.kind !== "cap").map((t) => topping(t, v, b, rnd)).join("");
  g += (charm.clipped ?? "") + "</g>";
  g += (outfit.underEar ?? "") + (charm.underEar ?? "");
  g += ears.filter((e) => !e[3]).map(leaf).join("");

  if (y.blush || mood.blush) g += v.blush.map(([fx, fy]) => { const [x, yy] = face(fx, fy); return `<ellipse cx="${f1(x)}" cy="${f1(yy)}" rx="4.4" ry="2.5" fill="#F4A2A4" opacity="${mood.blush ?? 0.65}"/>`; }).join("");
  g += eyes.map(([x, yy, r], i) => eye(y.eye, x, yy, r * mood.scale, mood.eyes(i), mood.gaze)).join("");
  if (mood.tear) g += tear(eyes[0]!);
  if (y.mouth) g += mouth(face(...v.mouth));
  g += (outfit.front ?? "") + (charm.front ?? "");
  const extra = marks(y.mood, v, topAt(b, v.cx));

  const flip = y.facing === "left" ? ` transform="translate(120 0) scale(-1 1)"` : "";
  const shadow = `<ellipse cx="${v.cx}" cy="${f1(v.ground + 1.5)}" rx="${f1(v.rx * 0.95)}" ry="3.4" fill="#000" opacity=".3"/>`;
  const defs = `<defs><clipPath id="${id}c"><path d="${b.d}"/></clipPath><mask id="${id}m" maskUnits="userSpaceOnUse" x="-20" y="-20" width="160" height="160"><rect x="-20" y="-20" width="160" height="160" fill="#fff"/><path d="${b.d}" fill="#000" transform="translate(-5.5 -2.5)"/></mask></defs>`;
  const dims = o.size ? ` width="${o.size}" height="${o.size}"` : "";
  const title = o.title ? `<title>${esc(o.title)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -6 120 120"${dims}${o.title ? ` role="img"` : ` aria-hidden="true"`}>${title}${defs}<g${flip}>${shadow}${g}${extra}</g></svg>`;
}

// Shared with outline.ts, which draws the same avatar as line art.
export { CHARMS, LEAVES, MOODS, V, body, eye, f1, marks, mouth, tear, topAt };
export type { Ear, P };
