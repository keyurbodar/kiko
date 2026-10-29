import { chipTokens } from "./chips"

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
    accent: "#f0bb3b",
    palette: {
      canvas: "#121212",
      sidebar: "#161616",
      text: "#ededed",
      muted: "#a6a6a6",
      faint: "#878787",
      action: "#ededed",
      actionHover: "#ffffff",
      onAction: "#141414",
      danger: "#ef6a6a",
      gold: "#f27636",
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
      faint: "#a5b7c4",
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
      faint: "#9298a2",
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
      faint: "#959595",
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
      faint: "#8fa196",
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
      faint: "#8a9ea8",
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
      faint: "#a59a92",
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
      faint: "#9a95a6",
      action: "#ece9f2",
      actionHover: "#afa0dc",
      onAction: "#0d0c11",
      danger: "#ffb4ac",
      gold: "#e8c47b",
    },
  },
  snow: {
    label: "Paper",
    accent: "#9a5600",
    palette: {
      canvas: "#ffffff",
      sidebar: "#f7f7f6",
      text: "#1b1b1b",
      muted: "#5c5c5c",
      faint: "#808080",
      action: "#1b1b1b",
      actionHover: "#000000",
      onAction: "#ffffff",
      danger: "#d6453f",
      gold: "#bb4717",
    },
  },
} as const satisfies Record<ThemeId, { label: string; accent: string; palette: Palette }>

export function paletteFor(mode: ThemeAppearance, darkTheme: DarkThemeId = DEFAULT_DARK_THEME): Palette {
  return THEMES[mode === "light" ? "snow" : darkTheme].palette
}
export const PALETTES: Record<ThemeAppearance, Palette> = { light: paletteFor("light"), dark: paletteFor("dark") }

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

const linear = (hex: string) => {
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255].map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  )
}

const luminance = (hex: string) => {
  const [r, g, b] = linear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

type Ink = Readonly<{
  p: Palette
  accent: string
  dark: boolean
  solid: (share: number) => string
  clear: (share: number) => string
}>

const ROLES: ReadonlyArray<readonly [token: string, value: (ink: Ink) => string]> = [
  ["--bg", ({ p }) => p.canvas],
  ["--side", ({ p }) => p.sidebar],
  ["--panel", ({ solid, dark }) => solid(dark ? 2.9 : 1.6)],
  ["--raise", ({ solid, dark }) => solid(dark ? 5.8 : 2.4)],
  ["--hover", ({ solid, dark }) => solid(dark ? 8 : 4)],
  ["--active", ({ solid, dark }) => solid(dark ? 11.3 : 6.5)],
  ["--fill", ({ clear, dark }) => clear(dark ? 8.2 : 8)],
  ["--fill-field", ({ clear, dark }) => clear(dark ? 4.6 : 2.4)],
  ["--fill-hover", ({ clear, dark }) => clear(dark ? 6.4 : 4)],
  ["--fill-control", ({ clear, dark }) => clear(dark ? 9.1 : 6.5)],
  ["--fill-control-hover", ({ clear, dark }) => clear(dark ? 12.8 : 12)],
  ["--fill-selected", ({ clear, dark }) => clear(dark ? 9.1 : 6.5)],
  ["--fill-pressed", ({ clear, dark }) => clear(dark ? 12.8 : 12)],
  ["--ghost", ({ clear, dark }) => clear(dark ? 8.2 : 8)],
  ["--field-ring", ({ clear, dark }) => (dark ? "transparent" : clear(8))],
  ["--me", ({ solid, dark }) => solid(dark ? 11.8 : 5.5)],
  ["--kiko-bubble", ({ solid, dark }) => solid(dark ? 5.8 : 3)],
  ["--line", ({ solid, dark }) => solid(dark ? 10.2 : 8)],
  ["--line2", ({ solid, dark }) => solid(dark ? 12.8 : 12)],
  ["--line3", ({ clear }) => clear(20)],
  ["--fg", ({ p }) => p.text],
  ["--fg2", ({ p }) => p.muted],
  ["--fg3", ({ p }) => p.faint],
  ["--fg4", ({ solid, dark }) => solid(dark ? 39.2 : 40)],
  ["--on-fg", ({ p }) => p.onAction],
  ["--ok", ({ dark }) => (dark ? "#5cc489" : "#1f9d55")],
  ["--bad", ({ p }) => p.danger],
  ["--warn", ({ p }) => p.gold],
  ["--info", ({ accent }) => accent],
  ["--accent-fill", ({ accent }) => accent],
  ["--accent-fill-hover", ({ accent, p }) => `color-mix(in oklab, ${accent} 88%, ${p.text})`],
  [
    "--on-accent",
    ({ accent, dark }) => {
      const ink = dark ? "#141414" : "#1b1b1b"
      return contrast(accent, ink) >= contrast(accent, "#ffffff") ? ink : "#ffffff"
    },
  ],
  ["--accent-edge", () => "color-mix(in srgb, var(--accent-fill) 22%, transparent)"],
  ["--leaf", ({ dark }) => (dark ? "#7fd19c" : "#2f9e5b")],
  ["--info-wash", ({ accent, dark }) => `color-mix(in oklab, ${accent} ${dark ? 14 : 11}%, transparent)`],
  ["--bad-wash", ({ p }) => `color-mix(in oklab, ${p.danger} 12%, transparent)`],
  ["--scrollbar-thumb", ({ clear }) => clear(18)],
  ["--scrollbar-thumb-hover", ({ clear }) => clear(30)],
  [
    "--card-shadow",
    ({ clear, dark }) =>
      dark
        ? "inset 0 1px 0 rgb(255 255 255 / 3%)"
        : `0 0 0 1px ${clear(6)}, 0 1px 2px rgb(0 0 0 / 4%), 0 8px 24px -16px rgb(0 0 0 / 18%)`,
  ],
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
    solid: (n) => `color-mix(in oklab, ${p.text} ${share(n)}%, ${p.canvas})`,
    clear: (n) => `color-mix(in oklab, ${p.text} ${share(n)}%, transparent)`,
  }
  return {
    ...Object.fromEntries(ROLES.map(([token, value]) => [token, value(ink)])),
    ...chipTokens(mode, p),
  }
}

export const resolveAppearance = (mode: ThemeMode, systemDark: boolean): ThemeAppearance =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode
