// Kiko's one palette. Light is washi paper with sumi ink; dark is warm charcoal with cream ink.
// Every fill is the ink at a few percent over the paper, so the whole interface moves together
// and the contrast setting scales it in one place. The accent is the Shima Enaga's blush unless
// the person picks another, and it only colors marks: links, mentions, your bubbles, the focus.

export type ThemeAppearance = "light" | "dark"
export type ThemeMode = ThemeAppearance | "system"

export type Palette = Readonly<{
  canvas: string
  sidebar: string
  text: string
  muted: string
  faint: string
  /** The primary action: the send button and the main button in a dialog. */
  action: string
  actionHover: string
  onAction: string
  danger: string
  gold: string
}>

export const PALETTES: Record<ThemeAppearance, Palette> = {
  light: {
    canvas: "#f8f5ef",
    sidebar: "#f2eee6",
    text: "#2a2622",
    muted: "#7a736a",
    faint: "#a8a196",
    action: "#2a2622",
    actionHover: "#3e3934",
    onAction: "#f8f5ef",
    danger: "#c2453a",
    gold: "#93670f",
  },
  dark: {
    canvas: "#1a1917",
    sidebar: "#151412",
    text: "#ece6dc",
    muted: "#9a9389",
    faint: "#6c665e",
    action: "#ece6dc",
    actionHover: "#d9d2c6",
    onAction: "#1a1917",
    danger: "#e5867a",
    gold: "#e1b866",
  },
}

/** The accents, each tuned once per appearance so it reads on paper and on charcoal. Named after the flock. */
export const ACCENTS = {
  blush: { label: "Blush", light: "#b4665a", dark: "#e2a99b" },
  matcha: { label: "Matcha", light: "#5f7a3c", dark: "#aec08a" },
  ramune: { label: "Ramune", light: "#3f6f98", dark: "#9fc3e0" },
  yuzu: { label: "Yuzu", light: "#94700f", dark: "#e3c26e" },
  lavender: { label: "Lavender", light: "#6f5c9e", dark: "#bcaee0" },
  sumi: { label: "Sumi", light: "#2a2622", dark: "#ece6dc" },
} as const satisfies Record<string, { label: string; light: string; dark: string }>

export type AccentId = keyof typeof ACCENTS
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[]
export const DEFAULT_ACCENT: AccentId = "blush"
export const isAccentId = (v: unknown): v is AccentId => typeof v === "string" && v in ACCENTS

/*
 * The neutrals: the ink at a share over whatever is beneath, so a fill always shows on any
 * surface it sits on. [token, dark %, light %]
 */
export const NEUTRALS: ReadonlyArray<readonly [token: string, dark: number, light: number]> = [
  ["--card", 3, 3],
  ["--bg-subtle", 4, 3.5],
  ["--input-bg", 5, 4],
  ["--hover-bg", 5, 4.5],
  ["--nav-hover-bg", 5, 4.5],
  ["--selected-bg", 9, 7],
  ["--nav-active-bg", 9, 7],
  ["--surface-raised", 11, 7],
  ["--assistant-bubble", 6, 5],
  ["--tint-subtle", 5, 4],
  ["--tint", 8, 6],
  ["--tint-strong", 12, 9],
  ["--hairline", 8, 9],
  ["--panel-edge", 10, 11],
  ["--scrollbar-thumb", 18, 18],
  ["--scrollbar-thumb-hover", 30, 30],
  ["--kit-border", 9, 10],
  ["--kit-input", 12, 13],
  ["--kit-input-fill", 4, 3.5],
  ["--kit-card", 3, 3],
  ["--kit-hover", 7, 6],
]

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** The CSS variables one appearance paints. `contrast` is a percent that scales every neutral. */
export function tokensFor(mode: ThemeAppearance, accentId: AccentId = DEFAULT_ACCENT, contrast = 100): Record<string, string> {
  const p = PALETTES[mode]
  const accent = ACCENTS[accentId][mode]
  // The percent is computed here, never with calc() inside color-mix, which some browsers drop.
  const ink = (share: number) => `color-mix(in oklab, ${p.text} ${Math.min(100, round((share * contrast) / 100, 2))}%, transparent)`
  const vars: Record<string, string> = {
    "--bg": p.canvas,
    "--bg-sidebar": p.sidebar,
    "--sidebar-solid": p.sidebar,
    "--text": p.text,
    "--text-muted": p.muted,
    "--text-faint": p.faint,
    "--accent": accent,
    "--accent-fill": p.action,
    "--accent-hover": p.actionHover,
    "--on-accent": p.onAction,
    "--danger": p.danger,
    "--gold": p.gold,
  }
  for (const [token, dark, light] of NEUTRALS) vars[token] = ink(mode === "dark" ? dark : light)
  // Menus and dialogs are opaque paper, one step off the canvas.
  vars["--menu-bg"] = mode === "dark" ? `color-mix(in oklab, ${p.text} 5%, ${p.canvas})` : `color-mix(in oklab, #ffffff 55%, ${p.canvas})`
  vars["--tooltip-bg"] = mode === "dark" ? `color-mix(in oklab, ${p.text} 14%, ${p.canvas})` : p.text
  vars["--tooltip-text"] = mode === "dark" ? p.text : p.canvas
  // Your bubble takes the accent, softly: a wash of it on the paper, with the ink on top.
  vars["--user-bubble"] = `color-mix(in oklab, ${accent} ${mode === "dark" ? 20 : 15}%, transparent)`
  vars["--user-bubble-deep"] = vars["--user-bubble"]!
  vars["--user-bubble-text"] = p.text
  vars["--accent-wash"] = `color-mix(in oklab, ${accent} ${mode === "dark" ? 14 : 11}%, transparent)`
  return vars
}

export const resolveAppearance = (mode: ThemeMode, systemDark: boolean): ThemeAppearance =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode
