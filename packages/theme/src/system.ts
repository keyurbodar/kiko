const RADIUS = {
  tail: 6,
  check: 5,
  control: 9,
  row: 10,
  tile: 12,
  pop: 14,
  card: 16,
  bubble: 18,
  sheet: 20,
  composer: 22,
} as const

const SIZE = {
  "nav-tab": 34,
  "chat-row": 50,
  mascot: 32,
  avatar: 30,
  "section-label": 28,
  step: 28,
  control: 32,
  "control-big": 48,
  icon: 28,
  chip: 26,
  tab: 28,
  "composer-min": 96,
  sidebar: 296,
} as const

const CONTAINER = { chat: 820, page: 1040 } as const

type Face = "sans" | "display" | "mono"
type Type = Readonly<{ size: number; line: number; weight: number; face: Face; scales: boolean }>

const BASE = 14

const TYPE = {
  page: { size: 40, line: 44, weight: 400, face: "display", scales: false },
  section: { size: 26, line: 32, weight: 400, face: "display", scales: false },
  wordmark: { size: 24, line: 28, weight: 400, face: "display", scales: false },
  msg: { size: 15, line: 24, weight: 400, face: "sans", scales: true },
  ui: { size: 14, line: 20, weight: 400, face: "sans", scales: true },
  row: { size: 13.5, line: 18, weight: 600, face: "sans", scales: true },
  label: { size: 12.5, line: 16, weight: 400, face: "sans", scales: true },
  hint: { size: 11.5, line: 14, weight: 400, face: "sans", scales: true },
  code: { size: 13, line: 21, weight: 400, face: "mono", scales: true },
} as const satisfies Record<string, Type>

type TypeName = keyof typeof TYPE

const MOTION = {
  hover: 120,
  pop: 200,
  step: 400,
  shimmer: 2200,
  hop: 1200,
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const

const round = (n: number) => Math.round(n * 100) / 100

export function typeVars(base: number): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, t] of Object.entries(TYPE) as [TypeName, Type][]) {
    const size = t.scales ? round(t.size + base - BASE) : t.size
    vars[`--type-${name}`] = `${size}px`
    vars[`--type-${name}-line`] = String(round(t.line / t.size))
  }
  return vars
}

const FACES: Record<Face, string> = {
  sans: "var(--font-family-sans)",
  display: "var(--font-family-display)",
  mono: "var(--font-family-mono)",
}

export function systemCss(): string {
  const px = (n: number) => `${n}px`
  const fixed = [
    ...Object.entries(RADIUS).map(([k, v]) => `  --radius-${k}: ${px(v)};`),
    ...Object.entries(SIZE).map(([k, v]) => `  --spacing-${k}: ${px(v)};`),
    ...Object.entries(CONTAINER).map(([k, v]) => `  --container-${k}: ${px(v)};`),
    `  --ease-kiko: ${MOTION.ease};`,
  ]
  const live = Object.keys(TYPE).flatMap((name) => [
    `  --text-${name}: var(--type-${name});`,
    `  --text-${name}--line-height: var(--type-${name}-line);`,
  ])
  const utilities = (Object.entries(TYPE) as [TypeName, Type][]).map(
    ([name, t]) =>
      `@utility type-${name} {\n  font-family: ${FACES[t.face]};\n  font-size: var(--type-${name});\n  line-height: var(--type-${name}-line);\n  font-weight: ${t.weight};${t.face === "display" ? "\n  font-variation-settings: var(--display-variation);" : ""}\n}`,
  )
  const root = [
    ...Object.entries(typeVars(BASE)).map(([k, v]) => `  ${k}: ${v};`),
    `  --dur-hover: ${MOTION.hover}ms;`,
    `  --dur-pop: ${MOTION.pop}ms;`,
    `  --dur-step: ${MOTION.step}ms;`,
    `  --dur-shimmer: ${MOTION.shimmer}ms;`,
    `  --dur-hop: ${MOTION.hop}ms;`,
  ]
  return [
    "/* system:start */",
    `:root {\n${root.join("\n")}\n}`,
    "",
    `@theme {\n${fixed.join("\n")}\n}`,
    "",
    `@theme inline {\n${live.join("\n")}\n}`,
    "",
    ...utilities.flatMap((u) => [u, ""]),
    "/* system:end */",
  ].join("\n")
}
