import { hexOf, oklchOf } from "./color"

export type ThemeAppearance = "light" | "dark"
export type ThemeMode = ThemeAppearance | "system"

export type Palette = Readonly<{
  canvas: string
  sidebar: string
  text: string
  muted: string
  faint: string
  action: string
  actionHover: string
  onAction: string
  danger: string
  gold: string
}>

export const PALETTE_KEYS = ["canvas", "sidebar", "text", "muted", "faint", "action", "actionHover", "onAction", "danger", "gold"] as const satisfies readonly (keyof Palette)[]

export const ACCENTS = {
  mikan: { label: "Mikan", light: "#c26900", dark: "#f6a14f" },
  yuzu: { label: "Yuzu", light: "#946b00", dark: "#ffc94f" },
  azure: { label: "Azure", light: "#1b4ed8", dark: "#346bf1" },
  blush: { label: "Blush", light: "#b4665a", dark: "#e2a99b" },
  matcha: { label: "Matcha", light: "#5f7a3c", dark: "#aec08a" },
  ramune: { label: "Ramune", light: "#3f6f98", dark: "#9fc3e0" },
  lavender: { label: "Lavender", light: "#6f5c9e", dark: "#bcaee0" },
  sumi: { label: "Sumi", light: "#2a2622", dark: "#ece6dc" },
} as const satisfies Record<string, { label: string; light: string; dark: string }>

export type AccentId = keyof typeof ACCENTS
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[]
export const DEFAULT_ACCENT: AccentId = "mikan"
export const isAccentId = (v: unknown): v is AccentId => typeof v === "string" && v in ACCENTS

/*
 * Paper and ink from the accent, the way Material 3 takes its neutral tones from a seed: every role
 * keeps a fixed lightness, and takes the accent's hue with a little chroma. A vivid accent tints the
 * whole app; a grey one, such as sumi, leaves it near neutral. The lightness of each role is what the
 * contrast tests hold, so any accent's paper reads. Red and amber stay fixed: an error is never the accent.
 */
type Tone = readonly [lightness: number, chroma: number]
const TONES: Record<ThemeAppearance, Record<"canvas" | "sidebar" | "text" | "muted" | "faint" | "actionHover", Tone>> = {
  light: { canvas: [0.981, 0.018], sidebar: [0.961, 0.027], text: [0.242, 0.019], muted: [0.49, 0.03], faint: [0.641, 0.033], actionHover: [0.33, 0.022] },
  dark: { canvas: [0.19, 0.012], sidebar: [0.166, 0.01], text: [0.967, 0.018], muted: [0.761, 0.03], faint: [0.542, 0.03], actionHover: [0.915, 0.02] },
}
const FIXED: Record<ThemeAppearance, Pick<Palette, "danger" | "gold">> = {
  light: { danger: "#c2410c", gold: "#8a5a00" },
  dark: { danger: "#ff9a6b", gold: "#ffc94f" },
}

/** The palette an accent seeds. Chroma follows the accent's own, up to the full tint at a chroma of 0.12. */
export function paletteFor(mode: ThemeAppearance, accentId: AccentId = DEFAULT_ACCENT): Palette {
  const seed = oklchOf(ACCENTS[accentId][mode])
  const tint = Math.min(1, Math.max(0.25, seed.c / 0.12))
  const tone = (role: keyof (typeof TONES)["light"]) => hexOf({ l: TONES[mode][role][0], c: TONES[mode][role][1] * tint, h: seed.h })
  const text = tone("text")
  const canvas = tone("canvas")
  return { canvas, sidebar: tone("sidebar"), text, muted: tone("muted"), faint: tone("faint"), action: text, actionHover: tone("actionHover"), onAction: canvas, ...FIXED[mode] }
}

/** The default accent's palettes: what the page paints before a look is known. */
export const PALETTES: Record<ThemeAppearance, Palette> = { light: paletteFor("light"), dark: paletteFor("dark") }

export const NEUTRALS: ReadonlyArray<readonly [token: string, dark: number, light: number]> = [
  ["--card", 6, 7],
  ["--muted", 3, 3.5],
  ["--secondary", 4, 4],
  ["--accent", 4, 4.5],
  ["--sidebar-row-hover", 4, 4.5],
  ["--accent-strong", 8, 7],
  ["--sidebar-row-active", 8, 7],
  ["--control", 7, 6],
  ["--control-strong", 11, 9],
  ["--border", 6, 9],
  ["--input", 8, 13],
  ["--scrollbar-thumb", 18, 18],
  ["--scrollbar-thumb-hover", 30, 30],
]

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

export function tokensFor(mode: ThemeAppearance, accentId: AccentId = DEFAULT_ACCENT, contrast = 100, imported?: { palette: Palette; accent: string }): Record<string, string> {
  const p = imported?.palette ?? paletteFor(mode, accentId)
  const accent = imported?.accent ?? ACCENTS[accentId][mode]
  const ink = (share: number) => `color-mix(in oklab, ${p.text} ${Math.min(100, round((share * contrast) / 100, 2))}%, transparent)`
  const vars: Record<string, string> = {
    "--background": p.canvas,
    "--sidebar": p.sidebar,
    "--foreground": p.text,
    "--muted-foreground": p.muted,
    "--secondary-label": p.faint,
    "--ring": accent,
    "--primary": p.action,
    "--primary-hover": p.actionHover,
    "--primary-foreground": p.onAction,
    "--error": p.danger,
    "--warning": p.gold,
    "--success": mode === "dark" ? "oklch(0.7937 0.12 150)" : "oklch(0.52 0.12 150)",
  }
  for (const [token, dark, light] of NEUTRALS) vars[token] = ink(mode === "dark" ? dark : light)
  // One solid raised surface: an agent's bubble, a card, a menu, the composer. Near white on paper, a lifted night in dark.
  vars["--surface"] = mode === "dark" ? `color-mix(in oklab, ${p.text} 7%, ${p.canvas})` : `color-mix(in oklab, ${p.canvas} 25%, #ffffff)`
  vars["--popover"] = vars["--surface"]!
  vars["--message-assistant"] = vars["--surface"]!
  vars["--tooltip"] = mode === "dark" ? `color-mix(in oklab, ${p.text} 14%, ${p.canvas})` : p.text
  vars["--tooltip-foreground"] = mode === "dark" ? p.text : p.canvas
  // Your bubble is a solid pastel of the accent: honey on paper, a deep glow at night.
  vars["--message-user"] = mode === "dark" ? `oklch(from ${accent} 0.32 calc(c * 0.42) h)` : `oklch(from ${accent} 0.93 calc(c * 0.6) h)`
  vars["--message-user-deep"] = vars["--message-user"]!
  vars["--message-user-foreground"] = p.text
  vars["--ring-wash"] = `color-mix(in oklab, ${accent} ${mode === "dark" ? 14 : 11}%, transparent)`
  return vars
}

export const resolveAppearance = (mode: ThemeMode, systemDark: boolean): ThemeAppearance =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode
