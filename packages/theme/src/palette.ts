
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

export const PALETTES: Record<ThemeAppearance, Palette> = {
  light: {
    canvas: "#fcfcfc",
    sidebar: "#fafafa",
    text: "#27272a",
    muted: "#71717a",
    faint: "#a1a1aa",
    action: "#27272a",
    actionHover: "#3f3f46",
    onAction: "#ffffff",
    danger: "#c2453a",
    gold: "#93670f",
  },
  dark: {
    canvas: "#171717",
    sidebar: "#121212",
    text: "#ececec",
    muted: "#a3a3a3",
    faint: "#6b6b6b",
    action: "#ececec",
    actionHover: "#d4d4d4",
    onAction: "#171717",
    danger: "#e5867a",
    gold: "#e1b866",
  },
}

export const ACCENTS = {
  azure: { label: "Azure", light: "#1b4ed8", dark: "#346bf1" },
  blush: { label: "Blush", light: "#b4665a", dark: "#e2a99b" },
  matcha: { label: "Matcha", light: "#5f7a3c", dark: "#aec08a" },
  ramune: { label: "Ramune", light: "#3f6f98", dark: "#9fc3e0" },
  yuzu: { label: "Yuzu", light: "#94700f", dark: "#e3c26e" },
  lavender: { label: "Lavender", light: "#6f5c9e", dark: "#bcaee0" },
  sumi: { label: "Sumi", light: "#2a2622", dark: "#ece6dc" },
} as const satisfies Record<string, { label: string; light: string; dark: string }>

export type AccentId = keyof typeof ACCENTS
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[]
export const DEFAULT_ACCENT: AccentId = "azure"
export const isAccentId = (v: unknown): v is AccentId => typeof v === "string" && v in ACCENTS

export const NEUTRALS: ReadonlyArray<readonly [token: string, dark: number, light: number]> = [
  ["--card", 4.5, 4],
  ["--muted", 3, 3.5],
  ["--secondary", 4, 4],
  ["--accent", 4, 4.5],
  ["--sidebar-row-hover", 4, 4.5],
  ["--accent-strong", 8, 7],
  ["--sidebar-row-active", 8, 7],
  ["--message-assistant", 5, 5],
  ["--control", 7, 6],
  ["--control-strong", 11, 9],
  ["--border", 8, 10],
  ["--input", 10, 14],
  ["--scrollbar-thumb", 18, 18],
  ["--scrollbar-thumb-hover", 30, 30],
]

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

export function tokensFor(mode: ThemeAppearance, accentId: AccentId = DEFAULT_ACCENT, contrast = 100, imported?: { palette: Palette; accent: string }): Record<string, string> {
  const p = imported?.palette ?? PALETTES[mode]
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
  vars["--popover"] = mode === "dark" ? `color-mix(in oklab, ${p.text} 5%, ${p.canvas})` : `color-mix(in oklab, #ffffff 55%, ${p.canvas})`
  vars["--tooltip"] = mode === "dark" ? `color-mix(in oklab, ${p.text} 14%, ${p.canvas})` : p.text
  vars["--tooltip-foreground"] = mode === "dark" ? p.text : p.canvas
  // Unify's layering: the human's bubble is a lifted neutral with only a hint of the accent.
  vars["--message-user"] = `color-mix(in oklab, ${accent} ${mode === "dark" ? 10 : 8}%, ${ink(mode === "dark" ? 9 : 6)})`
  vars["--message-user-deep"] = vars["--message-user"]!
  vars["--message-user-foreground"] = p.text
  vars["--ring-wash"] = `color-mix(in oklab, ${accent} ${mode === "dark" ? 14 : 11}%, transparent)`
  return vars
}

export const resolveAppearance = (mode: ThemeMode, systemDark: boolean): ThemeAppearance =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode
