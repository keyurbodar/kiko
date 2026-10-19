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

export const DARK_THEME_IDS = ["glacier", "slate", "graphite", "moss", "tide", "dusk", "plum"] as const
export type DarkThemeId = (typeof DARK_THEME_IDS)[number]
export type ThemeId = DarkThemeId | "snow"
export const THEME_IDS = [...DARK_THEME_IDS, "snow"] as const
export const DEFAULT_DARK_THEME: DarkThemeId = "glacier"
export const isDarkThemeId = (value: unknown): value is DarkThemeId => DARK_THEME_IDS.some((id) => id === value)

export const THEMES = {
  glacier: { label: "Glacier", accent: "#96c8eb", palette: { canvas: "#08131c", sidebar: "#101a24", text: "#e7f0f6", muted: "#a5b7c4", faint: "#a5b7c4", action: "#e7f0f6", actionHover: "#96c8eb", onAction: "#08131c", danger: "#ffb4ac", gold: "#e8c47b" } },
  slate: { label: "Slate", accent: "#becde1", palette: { canvas: "#0c0d10", sidebar: "#121418", text: "#e9ecf0", muted: "#9298a2", faint: "#9298a2", action: "#e9ecf0", actionHover: "#becde1", onAction: "#0c0d10", danger: "#ffb4ac", gold: "#e8c47b" } },
  graphite: { label: "Graphite", accent: "#dcdcdc", palette: { canvas: "#0c0c0c", sidebar: "#131313", text: "#ededed", muted: "#959595", faint: "#959595", action: "#ededed", actionHover: "#dcdcdc", onAction: "#0c0c0c", danger: "#ffb4ac", gold: "#e8c47b" } },
  moss: { label: "Moss", accent: "#86a38d", palette: { canvas: "#0a0e0c", sidebar: "#0f1512", text: "#e8efe9", muted: "#8fa196", faint: "#8fa196", action: "#e8efe9", actionHover: "#86a38d", onAction: "#0a0e0c", danger: "#ffb4ac", gold: "#e8c47b" } },
  tide: { label: "Tide", accent: "#78afc8", palette: { canvas: "#080c10", sidebar: "#0c1318", text: "#e6eff3", muted: "#8a9ea8", faint: "#8a9ea8", action: "#e6eff3", actionHover: "#78afc8", onAction: "#080c10", danger: "#ffb4ac", gold: "#e8c47b" } },
  dusk: { label: "Dusk", accent: "#e6aa82", palette: { canvas: "#0f0c0b", sidebar: "#181311", text: "#f1ebe6", muted: "#a59a92", faint: "#a59a92", action: "#f1ebe6", actionHover: "#e6aa82", onAction: "#0f0c0b", danger: "#ffb4ac", gold: "#e8c47b" } },
  plum: { label: "Plum", accent: "#afa0dc", palette: { canvas: "#0d0c11", sidebar: "#14121a", text: "#ece9f2", muted: "#9a95a6", faint: "#9a95a6", action: "#ece9f2", actionHover: "#afa0dc", onAction: "#0d0c11", danger: "#ffb4ac", gold: "#e8c47b" } },
  snow: { label: "Snow", accent: "#505f78", palette: { canvas: "#eef0f3", sidebar: "#fafbfc", text: "#16191e", muted: "#5b616b", faint: "#5b616b", action: "#16191e", actionHover: "#505f78", onAction: "#eef0f3", danger: "#b32632", gold: "#805500" } },
} as const satisfies Record<ThemeId, { label: string; accent: string; palette: Palette }>

export function paletteFor(mode: ThemeAppearance, darkTheme: DarkThemeId = DEFAULT_DARK_THEME): Palette {
  return THEMES[mode === "light" ? "snow" : darkTheme].palette
}
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

export function tokensFor(mode: ThemeAppearance, darkTheme: DarkThemeId = DEFAULT_DARK_THEME, contrast = 100, imported?: { palette: Palette; accent: string }): Record<string, string> {
  const p = imported?.palette ?? paletteFor(mode, darkTheme)
  const accent = imported?.accent ?? THEMES[mode === "light" ? "snow" : darkTheme].accent
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
  vars["--surface"] = p.sidebar
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
