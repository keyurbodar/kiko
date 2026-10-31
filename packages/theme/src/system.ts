const RADIUS = {
  none: 0,
  xs: 2,
  sm: 4,
  base: 6,
  lg: 8,
  xl: 12,
  "2xl": 14,
  "3xl": 16,
  "4xl": 18,
  composer: 20,
  full: 9999,
} as const

const HEIGHT = { sm: 20, md: 24, lg: 28, xl: 32 } as const

const LAYOUT = {
  "sidebar-width": 280,
  "sidebar-width-collapsed": 48,
  "top-bar-height": 40,
  "sidebar-inset": 8,
  "sidebar-row": 32,
  "sidebar-row-tall": 48,
  "sidebar-group-label": 30,
  "sidebar-group-gap": 12,
  "conversation-text-inset": 10,
  "conversation-block-gap": 10,
} as const

type Face = "sans" | "serif" | "mono"
type Type = Readonly<{ size: number; line: number; tracking: number; face: Face; scales: boolean }>

const BASE = 14

const TYPE = {
  xs: { size: 11, line: 14, tracking: 0.07, face: "sans", scales: true },
  sm: { size: 12, line: 16, tracking: 0, face: "sans", scales: true },
  base: { size: 13, line: 18, tracking: -0.08, face: "sans", scales: true },
  lg: { size: 14, line: 22, tracking: -0.15, face: "sans", scales: true },
  xl: { size: 17, line: 21, tracking: 0.08, face: "sans", scales: false },
  "2xl": { size: 20, line: 22, tracking: -0.46, face: "sans", scales: false },
  "3xl": { size: 22, line: 26, tracking: -0.26, face: "sans", scales: false },
  code: { size: 12, line: 18, tracking: 0, face: "mono", scales: true },
  "display-sm": { size: 18, line: 24, tracking: -0.1, face: "serif", scales: false },
  display: { size: 24, line: 30, tracking: -0.3, face: "serif", scales: false },
  "display-lg": { size: 30, line: 36, tracking: -0.5, face: "serif", scales: false },
  "display-xl": { size: 36, line: 42, tracking: -0.7, face: "serif", scales: false },
} as const satisfies Record<string, Type>

type TypeName = keyof typeof TYPE

const DURATION = {
  instant: 50,
  fast: 100,
  normal: 150,
  slow: 200,
  slower: 300,
  drawer: 500,
  "1s": 1000,
  "2s": 2000,
} as const

const EASE = {
  sharp: "cubic-bezier(0.165, 0.84, 0.44, 1)",
  heavy: "cubic-bezier(0.645, 0.045, 0.355, 1)",
  drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  "out-quint": "cubic-bezier(0.23, 1, 0.32, 1)",
  "out-cubic": "cubic-bezier(0.215, 0.61, 0.355, 1)",
} as const

const LAYER = { dropdown: 1600, modal: 3000, popover: 4000, toast: 5000, tooltip: 100000 } as const

export const SANS_STACK =
  '"Geist Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"'
const SERIF_STACK = '"Geist Serif", ui-serif, Georgia, "Times New Roman", serif'
export const MONO_STACK =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, "Roboto Mono", Menlo, Monaco, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace'

const round = (n: number) => Math.round(n * 100) / 100

export function typeVars(base: number): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, t] of Object.entries(TYPE) as [TypeName, Type][]) {
    const size = t.scales ? round(t.size + base - BASE) : t.size
    vars[`--font-size-${name}`] = `${size}px`
    vars[`--line-height-${name}`] = `${round((t.line / t.size) * size)}px`
  }
  return vars
}

const FACES: Record<Face, string> = {
  sans: "var(--font-family-sans)",
  serif: "var(--font-family-serif)",
  mono: "var(--font-family-mono)",
}

export function systemCss(): string {
  const px = (n: number) => `${n}px`
  const root = [
    ...Object.entries(typeVars(BASE)).map(([k, v]) => `  ${k}: ${v};`),
    ...(Object.entries(TYPE) as [TypeName, Type][]).map(([k, t]) => `  --letter-spacing-${k}: ${px(t.tracking)};`),
    ...Object.entries(DURATION).map(([k, v]) => `  --duration-${k}: ${v}ms;`),
    ...Object.entries(LAYER).map(([k, v]) => `  --layer-${k}: ${v};`),
    `  --font-family-sans: ${SANS_STACK};`,
    `  --font-family-serif: ${SERIF_STACK};`,
    `  --font-family-mono: ${MONO_STACK};`,
    "  --press-scale: 0.98;",
  ]
  const fixed = [
    ...Object.entries(RADIUS).map(([k, v]) => `  --radius-${k}: ${px(v)};`),
    ...Object.entries(HEIGHT).map(([k, v]) => `  --spacing-control-${k}: ${px(v)};`),
    ...Object.entries(LAYOUT).map(([k, v]) => `  --spacing-${k}: ${px(v)};`),
    ...Object.entries(EASE).map(([k, v]) => `  --ease-${k}: ${v};`),
  ]
  const live = (Object.entries(TYPE) as [TypeName, Type][]).flatMap(([name]) => [
    `  --text-${name}: var(--font-size-${name});`,
    `  --text-${name}--line-height: var(--line-height-${name});`,
    `  --text-${name}--letter-spacing: var(--letter-spacing-${name});`,
  ])
  const utilities = (Object.entries(TYPE) as [TypeName, Type][]).map(
    ([name, t]) =>
      `@utility type-${name} {\n  font-family: ${FACES[t.face]};\n  font-size: var(--font-size-${name});\n  line-height: var(--line-height-${name});\n  letter-spacing: var(--letter-spacing-${name});${t.face === "serif" ? "\n  font-weight: 400;" : ""}\n}`,
  )
  return [
    "/* system:start */",
    `:root {\n${root.join("\n")}\n}`,
    "",
    `@theme static {\n${fixed.join("\n")}\n}`,
    "",
    `@theme inline {\n${live.join("\n")}\n}`,
    "",
    ...utilities.flatMap((u) => [u, ""]),
    "/* system:end */",
  ].join("\n")
}
