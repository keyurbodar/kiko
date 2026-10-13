// The interface and font settings, after t3code's appearance page (MIT, apps/web/src/components/
// settings/SettingsPanels.tsx `AppearanceSettingsPanel`) and appearanceFonts.ts. They travel with the
// look (look.ts), so another device shows the same, and they become css variables the theme paints,
// so the first paint and the boot screen already wear them. A family is a name the person types: it
// is never downloaded, and a name that is not installed falls back to the system stack.

export type ChatWidth = "comfortable" | "wide" | "full"

export type Display = Readonly<{
  /** Percent. Scales every border, hairline, and fill. */
  contrast: number
  chatWidth: ChatWidth
  /** A family name, or empty for the system interface font. */
  interfaceFont: string
  /** A family name, or empty for the system mono font. */
  codeFont: string
  /** Px of the interface text. The type scale is derived from it, so chat text stays one step above. */
  baseSize: number
  /** Thinner grayscale smoothing instead of the system's. */
  smoothing: boolean
}>

export const CONTRAST = { min: 80, max: 150, step: 5, default: 100 } as const
export const BASE_SIZE = { min: 12, max: 16, default: 13 } as const

const NAME_MAX = 80

export const DEFAULT_DISPLAY: Display = {
  contrast: 100,
  chatWidth: "comfortable",
  interfaceFont: "",
  codeFont: "",
  baseSize: BASE_SIZE.default,
  smoothing: true,
}

/** t3code's lanes (index.css `--chat-content-max-width`): 46rem, 72rem, and the whole pane. */
export const CHAT_WIDTHS: Record<ChatWidth, { label: string; width: string }> = {
  comfortable: { label: "Comfortable", width: "736px" },
  wide: { label: "Wide", width: "1152px" },
  full: { label: "Full", width: "100%" },
}

export const SANS_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
// Concrete names first: some engines alias `ui-monospace` to the proportional UI font.
export const MONO_STACK = '"SF Mono", Menlo, Consolas, "Liberation Mono", ui-monospace, monospace'

/** The css font-family list for a typed name, the name first and the stack after it. */
export function fontFamily(name: string, stack: string): string {
  const names = name
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (/^[\p{L}\p{N}-]+$/u.test(n) ? n : `"${n}"`))
  return names.length ? `${names.join(", ")}, ${stack}` : stack
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const oneOf = <T extends string>(table: Record<T, unknown>, v: unknown, fallback: T): T => (typeof v === "string" && v in table ? (v as T) : fallback)

// Looks saved before the font settings took names kept a preset key here. They read as the default font.
const PRESET_KEYS = new Set(["yuki", "system", "rounded", "serif", "mono", "fantasque", "interface"])
const familyName = (v: unknown): string => {
  if (typeof v !== "string" || PRESET_KEYS.has(v)) return ""
  return v.replace(/["';\\{}<>]/g, "").trim().slice(0, NAME_MAX)
}

/** Display settings read from a stored look. Anything missing or malformed is its default. */
export function readDisplay(value: unknown): Display {
  if (!isObject(value)) return DEFAULT_DISPLAY
  const c = typeof value.contrast === "number" && Number.isFinite(value.contrast) ? value.contrast : CONTRAST.default
  const size = typeof value.baseSize === "number" && Number.isFinite(value.baseSize) ? Math.round(value.baseSize) : BASE_SIZE.default
  return {
    contrast: Math.round(Math.min(CONTRAST.max, Math.max(CONTRAST.min, c)) / CONTRAST.step) * CONTRAST.step,
    chatWidth: oneOf(CHAT_WIDTHS, value.chatWidth, DEFAULT_DISPLAY.chatWidth),
    interfaceFont: familyName(value.interfaceFont),
    codeFont: familyName(value.codeFont),
    baseSize: Math.min(BASE_SIZE.max, Math.max(BASE_SIZE.min, size)),
    smoothing: typeof value.smoothing === "boolean" ? value.smoothing : DEFAULT_DISPLAY.smoothing,
  }
}

/** The css variables these settings set. Contrast is applied where the neutrals are mixed (palette.ts). */
export function displayVars(display: Display): Record<string, string> {
  const b = display.baseSize
  return {
    "--font-xs": `${b - 2}px`,
    "--font-sm": `${b - 1}px`,
    "--font-md": `${b}px`,
    "--font-base": `${b + 1}px`,
    "--content-max-w": CHAT_WIDTHS[display.chatWidth].width,
    "--font-family-sans": fontFamily(display.interfaceFont, SANS_STACK),
    "--font-family-mono": fontFamily(display.codeFont, MONO_STACK),
    "--font-smoothing": display.smoothing ? "antialiased" : "auto",
  }
}
