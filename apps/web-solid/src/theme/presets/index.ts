// The built-in themes, shown as swatches in settings and the palette. `kat.css` already is
// plum in both appearances, so plum is empty. Every other preset turns the brand hue and
// scales its chroma, which keeps it working in dark and light alike. A test parses every
// preset with `parseTheme`, so a bad value here fails the build.

import type { Theme } from "../schema"

type Swatch = { id: string; label: string; hue: number; chroma: number }

/** The swatch row, in display order. The first is the default. */
export const SWATCHES: readonly Swatch[] = [
  { id: "plum", label: "plum", hue: 340, chroma: 1 },
  { id: "ember", label: "ember", hue: 35, chroma: 1 },
  { id: "lilac", label: "lilac", hue: 295, chroma: 1 },
  { id: "sakura", label: "sakura", hue: 5, chroma: 1 },
  { id: "sage", label: "sage", hue: 150, chroma: 0.85 },
  { id: "teal", label: "teal", hue: 200, chroma: 0.9 },
  { id: "bluebird", label: "bluebird", hue: 245, chroma: 1 },
  { id: "graphite", label: "graphite", hue: 255, chroma: 0.35 },
  { id: "mono", label: "mono", hue: 0, chroma: 0 },
]

export const DEFAULT_PRESET = "plum"

function tinted({ label, hue, chroma }: Swatch): Theme {
  return { version: 1, name: label, colors: { hue, userHue: hue, chroma } }
}

/** Black and white. The own bubble is the brightest thing in dark and the darkest in light. */
const mono: Theme = {
  version: 1,
  name: "mono",
  colors: { chroma: 0 },
  tokens: { "--l-brand-user": 0.9, "--l-brand-fill": 0.9, "--l-brand-mark": 0.92, "--l-brand-hover": 0.98, "--l-brand-on": 0.17 },
  variants: {
    light: {
      tokens: { "--l-brand-user": 0.22, "--l-brand-fill": 0.22, "--l-brand-mark": 0.25, "--l-brand-hover": 0.1, "--l-brand-on": 0.985 },
    },
  },
}

export const PRESETS: Record<string, Theme> = Object.fromEntries(
  SWATCHES.map((s) => [s.id, s.id === "plum" ? { version: 1, name: "plum" } : s.id === "mono" ? mono : tinted(s)]),
)

export const presetFor = (id: string): Theme | undefined => PRESETS[id]

/** The colour a swatch shows: the kiko bird's own body in that theme, so a swatch reads as the mascot. */
export function swatchColor(id: string): string {
  const s = SWATCHES.find((x) => x.id === id)
  if (!s) return "transparent"
  return `oklch(0.78 ${(0.095 * s.chroma).toFixed(3)} ${s.hue})`
}
