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

export const PALETTE_KEYS = [
  "canvas",
  "sidebar",
  "text",
  "muted",
  "faint",
  "action",
  "actionHover",
  "onAction",
  "danger",
  "gold",
] as const satisfies readonly (keyof Palette)[]

export const DARK_THEME_IDS = ["kiko", "glacier", "slate", "graphite", "moss", "tide", "dusk", "plum"] as const
export type DarkThemeId = (typeof DARK_THEME_IDS)[number]
export type ThemeId = DarkThemeId | "snow"
export const THEME_IDS = [...DARK_THEME_IDS, "snow"] as const
export const DEFAULT_DARK_THEME: DarkThemeId = "kiko"
export const isDarkThemeId = (value: unknown): value is DarkThemeId => DARK_THEME_IDS.some((id) => id === value)

export const THEMES = {
  kiko: {
    label: "Kiko",
    accent: "#6aabf1",
    palette: {
      canvas: "#191919",
      sidebar: "#1f1f1f",
      text: "#efefef",
      muted: "#9c9c9c",
      faint: "#757575",
      action: "#efefef",
      actionHover: "#d7d7d7",
      onAction: "#191919",
      danger: "#f17778",
      gold: "#e49c06",
    },
  },
  glacier: {
    label: "Glacier",
    accent: "#96c8eb",
    palette: {
      canvas: "#08131c",
      sidebar: "#101a24",
      text: "#e7f0f6",
      muted: "#a5b7c4",
      faint: "#8798a4",
      action: "#e7f0f6",
      actionHover: "#96c8eb",
      onAction: "#08131c",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  slate: {
    label: "Slate",
    accent: "#becde1",
    palette: {
      canvas: "#0c0d10",
      sidebar: "#121418",
      text: "#e9ecf0",
      muted: "#9298a2",
      faint: "#787d86",
      action: "#e9ecf0",
      actionHover: "#becde1",
      onAction: "#0c0d10",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  graphite: {
    label: "Graphite",
    accent: "#dcdcdc",
    palette: {
      canvas: "#0c0c0c",
      sidebar: "#131313",
      text: "#ededed",
      muted: "#959595",
      faint: "#7b7b7b",
      action: "#ededed",
      actionHover: "#dcdcdc",
      onAction: "#0c0c0c",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  moss: {
    label: "Moss",
    accent: "#86a38d",
    palette: {
      canvas: "#0a0e0c",
      sidebar: "#0f1512",
      text: "#e8efe9",
      muted: "#8fa196",
      faint: "#76857c",
      action: "#e8efe9",
      actionHover: "#86a38d",
      onAction: "#0a0e0c",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  tide: {
    label: "Tide",
    accent: "#78afc8",
    palette: {
      canvas: "#080c10",
      sidebar: "#0c1318",
      text: "#e6eff3",
      muted: "#8a9ea8",
      faint: "#71828b",
      action: "#e6eff3",
      actionHover: "#78afc8",
      onAction: "#080c10",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  dusk: {
    label: "Dusk",
    accent: "#e6aa82",
    palette: {
      canvas: "#0f0c0b",
      sidebar: "#181311",
      text: "#f1ebe6",
      muted: "#a59a92",
      faint: "#887f78",
      action: "#f1ebe6",
      actionHover: "#e6aa82",
      onAction: "#0f0c0b",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  plum: {
    label: "Plum",
    accent: "#afa0dc",
    palette: {
      canvas: "#0d0c11",
      sidebar: "#14121a",
      text: "#ece9f2",
      muted: "#9a95a6",
      faint: "#7f7b8a",
      action: "#ece9f2",
      actionHover: "#afa0dc",
      onAction: "#0d0c11",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  snow: {
    label: "Paper",
    accent: "#1757ac",
    palette: {
      canvas: "#fbfbfa",
      sidebar: "#f4f4f3",
      text: "#1f1f1f",
      muted: "#4a4a4a",
      faint: "#6b6b6b",
      action: "#191919",
      actionHover: "#3c3c3c",
      onAction: "#ffffff",
      danger: "#a42528",
      gold: "#794c02",
    },
  },
} as const satisfies Record<ThemeId, { label: string; accent: string; palette: Palette }>

export function paletteFor(mode: ThemeAppearance, darkTheme: DarkThemeId = DEFAULT_DARK_THEME): Palette {
  return THEMES[mode === "light" ? "snow" : darkTheme].palette
}
export const PALETTES: Record<ThemeAppearance, Palette> = { light: paletteFor("light"), dark: paletteFor("dark") }

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

type Ink = Readonly<{
  p: Palette
  accent: string
  dark: boolean
  wash: (share: number) => string
  veil: (share: number) => string
  clear: (share: number) => string
}>

const ROLES: ReadonlyArray<readonly [token: string, value: (ink: Ink) => string]> = [
  ["--bg", ({ p }) => p.canvas],
  ["--side", ({ p }) => p.sidebar],
  ["--panel", ({ wash, dark }) => wash(dark ? 2.61 : 2.35)],
  ["--raise", ({ wash, dark }) => (dark ? wash(7) : "#ffffff")],
  ["--hover", ({ veil, dark }) => veil(dark ? 7.5 : 4.5)],
  ["--active", ({ veil, dark }) => veil(dark ? 15 : 8)],
  ["--fill", ({ veil, dark }) => veil(dark ? 10 : 6)],
  ["--fill-field", ({ veil, dark }) => veil(dark ? 5 : 2.5)],
  ["--fill-hover", ({ veil, dark }) => veil(dark ? 7.5 : 4.5)],
  ["--fill-control", ({ veil, dark }) => veil(dark ? 10 : 6)],
  ["--fill-control-hover", ({ veil, dark }) => veil(dark ? 14 : 9)],
  ["--fill-selected", ({ veil, dark }) => veil(dark ? 15 : 8)],
  ["--fill-pressed", ({ veil, dark }) => veil(dark ? 20 : 11)],
  ["--ghost", ({ clear, dark }) => clear(dark ? 7.45 : 5.1)],
  ["--field-ring", ({ clear, dark }) => (dark ? "transparent" : clear(10))],
  ["--me", ({ wash, dark }) => wash(dark ? 10 : 6.2)],
  ["--kiko-bubble", ({ wash, dark }) => (dark ? wash(5.65) : "#ffffff")],
  ["--line", ({ veil, dark }) => veil(dark ? 10 : 8)],
  ["--line2", ({ veil, dark }) => veil(dark ? 20 : 15)],
  ["--line3", ({ veil, dark }) => veil(dark ? 40 : 32)],
  ["--fg", ({ p }) => p.text],
  ["--fg2", ({ p }) => p.muted],
  ["--fg3", ({ p }) => p.faint],
  ["--fg4", ({ wash }) => wash(35)],
  ["--on-fg", ({ p }) => p.onAction],
  ["--ok", ({ dark }) => (dark ? "#53c556" : "#006c10")],
  ["--bad", ({ p }) => p.danger],
  ["--warn", ({ p }) => p.gold],
  ["--info", ({ accent }) => accent],
  ["--accent-fill", ({ accent }) => `oklch(from ${accent} 0.59 min(calc(c * 1.4), 0.17) h)`],
  ["--on-accent", () => "#ffffff"],
  ["--accent-edge", () => "color-mix(in srgb, var(--accent-fill) 22%, transparent)"],
  ["--leaf", ({ dark }) => (dark ? "#7fd19c" : "#2f9e5b")],
  ["--info-wash", () => "color-mix(in srgb, var(--accent-fill) 12%, transparent)"],
  ["--bad-wash", ({ p }) => `color-mix(in srgb, ${p.danger} 12%, transparent)`],
  ["--scrollbar-thumb", ({ clear }) => clear(18)],
  ["--scrollbar-thumb-hover", ({ clear }) => clear(30)],
  ["--card-shadow", ({ dark }) => (dark ? "none" : "0 0 0 1px rgb(0 0 0 / 6%), 0 4px 24px rgb(0 0 0 / 4%)")],
]

export function tokensFor(
  mode: ThemeAppearance,
  darkTheme: DarkThemeId = DEFAULT_DARK_THEME,
  contrast = 100,
  imported?: { palette: Palette; accent: string },
): Record<string, string> {
  const p = imported?.palette ?? paletteFor(mode, darkTheme)
  const accent = imported?.accent ?? THEMES[mode === "light" ? "snow" : darkTheme].accent
  const share = (n: number) => Math.min(100, round((n * contrast) / 100, 2))
  const ink: Ink = {
    p,
    accent,
    dark: mode === "dark",
    wash: (n) => `color-mix(in srgb, ${mode === "dark" ? "#ffffff" : "#000000"} ${share(n)}%, ${p.canvas})`,
    veil: (n) => `color-mix(in srgb, ${mode === "dark" ? "#ffffff" : "#000000"} ${share(n)}%, transparent)`,
    clear: (n) => `color-mix(in oklab, ${p.text} ${share(n)}%, transparent)`,
  }
  return Object.fromEntries(ROLES.map(([token, value]) => [token, value(ink)]))
}

export const resolveAppearance = (mode: ThemeMode, systemDark: boolean): ThemeAppearance =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode
