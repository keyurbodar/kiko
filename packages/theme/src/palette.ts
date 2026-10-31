export type ThemeAppearance = "light" | "dark"
export type ThemeMode = ThemeAppearance | "system"

export type Palette = Readonly<{
  chrome: string
  sidebar: string
  editor: string
  base: string
  accent: string
  onPrimary: string
  focus: string
  success: string
  warn: string
  danger: string
  red: string
  orange: string
  yellow: string
  green: string
  cyan: string
  blue: string
  magenta: string
  purple: string
}>

export const PALETTE_KEYS = [
  "chrome",
  "sidebar",
  "editor",
  "base",
  "accent",
  "onPrimary",
  "focus",
  "success",
  "warn",
  "danger",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "magenta",
  "purple",
] as const satisfies readonly (keyof Palette)[]

export const DARK_THEME_IDS = ["dark", "dark-high-contrast", "dark-colorblind"] as const
export const LIGHT_THEME_IDS = ["light", "light-high-contrast", "light-colorblind"] as const
export type DarkThemeId = (typeof DARK_THEME_IDS)[number]
export type LightThemeId = (typeof LIGHT_THEME_IDS)[number]
export type ThemeId = DarkThemeId | LightThemeId
export const THEME_IDS = [...DARK_THEME_IDS, ...LIGHT_THEME_IDS] as const
export const DEFAULT_DARK_THEME: DarkThemeId = "dark"
export const DEFAULT_LIGHT_THEME: LightThemeId = "light"
export const isDarkThemeId = (value: unknown): value is DarkThemeId => DARK_THEME_IDS.some((id) => id === value)
export const isLightThemeId = (value: unknown): value is LightThemeId => LIGHT_THEME_IDS.some((id) => id === value)
export const appearanceOfTheme = (id: ThemeId): ThemeAppearance => (isDarkThemeId(id) ? "dark" : "light")

type Ladder = "standard" | "high-contrast"
type Theme = Readonly<{ label: string; ladder: Ladder; palette: Palette }>

export const THEMES = {
  dark: {
    label: "Dark",
    ladder: "standard",
    palette: {
      chrome: "#141414",
      sidebar: "#181818",
      editor: "#181818",
      base: "#f0f0f0",
      accent: "#599ce7",
      onPrimary: "#191c22",
      focus: "#f0f0f0",
      success: "#3fa266",
      warn: "#f1b467",
      danger: "#e34671",
      red: "#fc6b83",
      orange: "#d08770",
      yellow: "#f1b467",
      green: "#3fa266",
      cyan: "#81a1c1",
      blue: "#7bafe9",
      magenta: "#b48ead",
      purple: "#9386f2",
    },
  },
  "dark-high-contrast": {
    label: "Dark High Contrast",
    ladder: "high-contrast",
    palette: {
      chrome: "#0a0a0a",
      sidebar: "#0a0a0a",
      editor: "#0a0a0a",
      base: "#f0f0f0",
      accent: "#6cb6ff",
      onPrimary: "#191c22",
      focus: "#ffcc00",
      success: "#50d080",
      warn: "#ffd866",
      danger: "#ff6b6b",
      red: "#ff6b6b",
      orange: "#ffb070",
      yellow: "#ffd866",
      green: "#50d080",
      cyan: "#6cb6ff",
      blue: "#7bafe9",
      magenta: "#d9a0d9",
      purple: "#9386f2",
    },
  },
  "dark-colorblind": {
    label: "Dark Colorblind",
    ladder: "standard",
    palette: {
      chrome: "#141414",
      sidebar: "#101010",
      editor: "#191919",
      base: "#f5f5f5",
      accent: "#79b2fd",
      onPrimary: "#f5f5f5",
      focus: "#1f87fc",
      success: "#79b2fd",
      warn: "#f59725",
      danger: "#ff905e",
      red: "#ff6e6c",
      orange: "#ff905e",
      yellow: "#f59725",
      green: "#32c878",
      cyan: "#5bc6b3",
      blue: "#79b2fd",
      magenta: "#ff7ab2",
      purple: "#b49cfe",
    },
  },
  light: {
    label: "Light",
    ladder: "standard",
    palette: {
      chrome: "#f5f5f5",
      sidebar: "#f5f5f5",
      editor: "#ffffff",
      base: "#1c1c1c",
      accent: "#0b6dd3",
      onPrimary: "#ffffff",
      focus: "#1680f3",
      success: "#00854a",
      warn: "#aa6300",
      danger: "#cd2834",
      red: "#cd2834",
      orange: "#c14c00",
      yellow: "#aa6300",
      green: "#00854a",
      cyan: "#008273",
      blue: "#0b6dd3",
      magenta: "#c62378",
      purple: "#7547d0",
    },
  },
  "light-high-contrast": {
    label: "Light High Contrast",
    ladder: "high-contrast",
    palette: {
      chrome: "#fcfcfc",
      sidebar: "#fcfcfc",
      editor: "#fcfcfc",
      base: "#0f0f0f",
      accent: "#0756aa",
      onPrimary: "#fcfcfc",
      focus: "#0c56a8",
      success: "#006537",
      warn: "#814a00",
      danger: "#a91f29",
      red: "#a91f29",
      orange: "#973a00",
      yellow: "#814a00",
      green: "#006537",
      cyan: "#006357",
      blue: "#0756aa",
      magenta: "#a41b62",
      purple: "#673db6",
    },
  },
  "light-colorblind": {
    label: "Light Colorblind",
    ladder: "standard",
    palette: {
      chrome: "#fcfcfc",
      sidebar: "#f5f5f5",
      editor: "#ffffff",
      base: "#1c1c1c",
      accent: "#0b6dd3",
      onPrimary: "#ffffff",
      focus: "#1680f3",
      success: "#0b6dd3",
      warn: "#aa6300",
      danger: "#c14c00",
      red: "#cd2834",
      orange: "#c14c00",
      yellow: "#aa6300",
      green: "#00854a",
      cyan: "#008273",
      blue: "#0b6dd3",
      magenta: "#c62378",
      purple: "#7547d0",
    },
  },
} as const satisfies Record<ThemeId, Theme>

export function paletteFor(appearance: ThemeAppearance, id?: ThemeId): Palette {
  const theme = id && appearanceOfTheme(id) === appearance ? id : appearance === "dark" ? "dark" : "light"
  return THEMES[theme].palette
}
export const PALETTES: Record<ThemeAppearance, Palette> = { light: paletteFor("light"), dark: paletteFor("dark") }

const LADDERS = {
  standard: {
    text: [100, 74, 60, 36],
    icon: [100, 66, 52, 28],
    bg: [20, 14, 8, 6, 4],
    stroke: [20, 12, 8, 4],
  },
  "high-contrast": {
    text: [100, 84, 72, 60],
    icon: [100, 76, 64, 52],
    bg: [36, 24, 14, 8, 5],
    stroke: [48, 36, 28, 20],
  },
} as const satisfies Record<Ladder, Record<"text" | "icon" | "bg" | "stroke", readonly number[]>>

const TIERS = ["primary", "secondary", "tertiary", "quaternary", "quinary"] as const
const HUES = ["red", "orange", "yellow", "green", "cyan", "blue", "magenta", "purple"] as const
const TONES = { accent: "accent", danger: "danger", warning: "warn", success: "success" } as const

const round = (n: number) => Math.round(n * 100) / 100

type Ink = Readonly<{
  p: Palette
  dark: boolean
  share: (n: number) => number
  wash: (color: string, n: number) => string
  over: (color: string, n: number, under: string) => string
}>

function ladderTokens(ink: Ink, ladder: Ladder): [string, string][] {
  const l = LADDERS[ladder]
  const base = ink.p.base
  const tier = (role: string, shares: readonly number[]) =>
    shares.map((n, i): [string, string] => [`--${role}-${TIERS[i]}`, i === 0 && n === 100 ? base : ink.wash(base, n)])
  return [
    ...tier("text", l.text),
    ...tier("icon", l.icon),
    ...tier("bg", l.bg),
    ...tier("stroke", l.stroke),
    ["--bg-active", ink.wash(base, 16)],
    ["--bg-focused", ink.wash(base, 22)],
  ]
}

function surfaceTokens({ p, dark, wash, over }: Ink): [string, string][] {
  return [
    ["--bg-chrome", p.chrome],
    ["--bg-sidebar", p.sidebar],
    ["--bg-editor", p.editor],
    ["--bg-elevated", p.editor],
    ["--bg-input", p.editor],
    ["--bg-input-field", wash(p.base, 3)],
    ["--bg-card", wash(p.base, 6)],
    ["--bg-tertiary-opaque", over(p.base, 8, p.chrome)],
    ["--bg-quaternary-opaque", over(p.base, 6, p.chrome)],
    ["--bg-tertiary-opaque-elevated", over(p.base, 8, p.editor)],
    ["--bg-quaternary-opaque-elevated", over(p.base, 6, p.editor)],
    ["--bg-neutral", p.base],
    ["--bg-neutral-hover", `color-mix(in oklab, ${p.chrome} 10%, ${p.base})`],
    ["--bg-scrim", dark ? "#00000099" : "#00000066"],
    ["--text-invert", p.editor],
    ["--text-on-accent", p.onPrimary],
    ["--icon-on-accent", p.onPrimary],
    ["--text-link", p.blue],
    ["--stroke-focused", wash(p.focus, 15)],
    ["--stroke-accent", wash(p.accent, 56)],
    ["--focus-ring", p.accent],
    ["--selection-bg", wash(p.base, 14)],
    ["--editor-selection-bg", wash(p.accent, 42)],
    ["--scrollbar-thumb", wash(p.base, 14)],
    ["--scrollbar-thumb-hover", wash(p.base, 22)],
    ["--scrollbar-thumb-active", wash(p.base, 26)],
    ["--diff-added-line", wash(p.success, 20)],
    ["--diff-added-text", wash(p.success, 13)],
    ["--diff-removed-line", wash(p.danger, 20)],
    ["--diff-removed-text", wash(p.danger, 13)],
  ]
}

function hoverOf(tone: keyof typeof TONES, fill: string, base: string): string {
  if (tone === "danger") return `color-mix(in srgb, ${fill} 85%, black)`
  if (tone === "success") return `color-mix(in srgb, ${fill} 85%, white)`
  return `color-mix(in oklab, ${base} 10%, ${fill})`
}

function toneTokens({ p, wash }: Ink): [string, string][] {
  const tones = Object.entries(TONES).flatMap(([tone, key]): [string, string][] => {
    const fill = p[key]
    return [
      [`--bg-${tone}`, fill],
      [`--bg-${tone}-hover`, hoverOf(tone as keyof typeof TONES, fill, p.base)],
      [`--bg-${tone}-secondary`, wash(fill, 24)],
      [`--bg-${tone}-tertiary`, wash(fill, 12)],
      [`--bg-${tone}-quaternary`, wash(fill, 8)],
      [`--bg-${tone}-soft`, wash(fill, 10)],
      [`--bg-${tone}-soft-hover`, wash(fill, 18)],
      [`--text-${tone}`, fill],
      [`--icon-${tone}`, fill],
      [`--stroke-${tone}`, wash(fill, 56)],
    ]
  })
  const hues = HUES.flatMap((hue): [string, string][] => [
    [`--text-${hue}`, p[hue]],
    [`--bg-${hue}`, p[hue]],
    [`--bg-${hue}-tertiary`, wash(p[hue], 12)],
    [`--stroke-${hue}`, wash(p[hue], 32)],
  ])
  return [...tones, ...hues]
}

function shadowTokens({ dark, p }: Ink): [string, string][] {
  const [primary, secondary, tertiary] = dark
    ? ["#00000033", "#0000001f", "#0000000f"]
    : ["#0000000f", "#00000009", "#00000005"]
  const hairline = `color-mix(in oklab, ${p.base} 8%, transparent)`
  return [
    ["--shadow-primary", primary],
    ["--shadow-secondary", secondary],
    ["--shadow-tertiary", tertiary],
    ["--box-shadow-sm", `0 2px 8px 0 ${secondary}`],
    ["--box-shadow-base", `0 0 0 1px ${hairline}, 0 0 4px 0 ${secondary}, 0 8px 24px -2px ${secondary}`],
    [
      "--box-shadow-popup",
      dark
        ? "0 10px 15px -3px #00000066, 0 4px 6px -2px #0000004d"
        : "0 10px 15px -3px #0000001a, 0 4px 6px -2px #0000000d",
    ],
    ["--box-shadow-lg", `0 0 4px 0 rgb(255 255 255 / 0.05) inset, 0 0 3px 0 ${secondary}, 0 16px 24px 0 ${tertiary}`],
    [
      "--box-shadow-dialog",
      `0 0 0 1px ${hairline}, ${dark ? "0 0 2px 0 #00000066, 0 6px 16px 0 #00000066" : "0 0 2px 0 #0000000f, 0 6px 16px 0 #0000000f"}`,
    ],
    [
      "--box-shadow-command",
      dark
        ? "0 25px 50px -12px #00000080, 0 12px 24px -8px #00000066"
        : "0 25px 50px -12px #00000040, 0 12px 24px -8px #00000026",
    ],
  ]
}

export const SYNTAX_KEYS = ["keyword", "string", "func", "comment"] as const
export type Syntax = Record<(typeof SYNTAX_KEYS)[number], string>

const SYNTAX = {
  dark: {
    foreground: "#d6d6dd",
    keyword: "#82d2ce",
    string: "#e394dc",
    function: "#efb080",
    comment: "#6e7781",
    constant: "#f8c762",
    number: "#ebc88d",
    type: "#f8c762",
    punctuation: "#d6d6dd",
  },
  light: {
    foreground: "#141414eb",
    keyword: "#b3003f",
    string: "#8f84e0",
    function: "#db704b",
    comment: "#141414ad",
    constant: "#206595",
    number: "#b8448b",
    type: "#206595",
    punctuation: "#141414ad",
  },
} as const satisfies Record<ThemeAppearance, Record<string, string>>

function syntaxTokens(appearance: ThemeAppearance, own?: Syntax): [string, string][] {
  const base = SYNTAX[appearance]
  const colours = own
    ? { ...base, keyword: own.keyword, string: own.string, function: own.func, comment: own.comment }
    : base
  return Object.entries(colours).map(([role, colour]): [string, string] => [`--syntax-${role}`, colour])
}

export function tokensFor(
  appearance: ThemeAppearance,
  id?: ThemeId,
  contrast = 100,
  imported?: { palette: Palette; syntax?: Syntax },
): Record<string, string> {
  const themeId = id && appearanceOfTheme(id) === appearance ? id : appearance === "dark" ? "dark" : "light"
  const p = imported?.palette ?? THEMES[themeId].palette
  const ladder: Ladder = imported ? "standard" : THEMES[themeId].ladder
  const share = (n: number) => Math.min(100, round((n * contrast) / 100))
  const ink: Ink = {
    p,
    dark: appearance === "dark",
    share,
    wash: (color, n) => `color-mix(in oklab, ${color} ${share(n)}%, transparent)`,
    over: (color, n, under) => `color-mix(in oklab, ${color} ${share(n)}%, ${under})`,
  }
  return Object.fromEntries([
    ...surfaceTokens(ink),
    ...ladderTokens(ink, ladder),
    ...toneTokens(ink),
    ...shadowTokens(ink),
    ...syntaxTokens(appearance, imported?.syntax),
  ])
}

export const resolveAppearance = (mode: ThemeMode, systemDark: boolean): ThemeAppearance =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode
