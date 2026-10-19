
export type ChatWidth = "comfortable" | "wide" | "full"

export type Display = Readonly<{
  contrast: number
  chatWidth: ChatWidth
  interfaceFont: string
  codeFont: string
  baseSize: number
  smoothing: boolean
}>

export const CONTRAST = { min: 80, max: 150, step: 5, default: 100 } as const
export const BASE_SIZE = { min: 12, max: 16, default: 14 } as const

const NAME_MAX = 80

export const DEFAULT_DISPLAY: Display = {
  contrast: 100,
  chatWidth: "comfortable",
  interfaceFont: "",
  codeFont: "",
  baseSize: BASE_SIZE.default,
  smoothing: true,
}

export const CHAT_WIDTHS: Record<ChatWidth, { label: string; width: string }> = {
  comfortable: { label: "Comfortable", width: "736px" },
  wide: { label: "Wide", width: "1152px" },
  full: { label: "Full", width: "100%" },
}

// Empty font preferences follow the device, including headings.
export const SANS_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
export const DISPLAY_STACK = SANS_STACK
export const MONO_STACK = '"SF Mono", Menlo, Consolas, "Liberation Mono", ui-monospace, monospace'

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

const PRESET_KEYS = new Set(["kiko", "system", "rounded", "serif", "mono", "fantasque", "interface"])
const familyName = (v: unknown): string => {
  if (typeof v !== "string" || PRESET_KEYS.has(v)) return ""
  return v.replace(/["';\\{}<>]/g, "").trim().slice(0, NAME_MAX)
}

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

export function displayVars(display: Display): Record<string, string> {
  const b = display.baseSize
  return {
    "--font-xs": `${b - 2}px`,
    "--font-sm": `${b - 1}px`,
    "--font-md": `${b}px`,
    "--font-base": `${b + 1}px`,
    "--chat-content-max-width": CHAT_WIDTHS[display.chatWidth].width,
    "--font-family-sans": fontFamily(display.interfaceFont, SANS_STACK),
    // A font the person chose sets the headings too, so their choice never sits beside Kiko's.
    "--font-family-display": display.interfaceFont ? fontFamily(display.interfaceFont, SANS_STACK) : DISPLAY_STACK,
    "--font-family-mono": fontFamily(display.codeFont, MONO_STACK),
    "--font-smoothing": display.smoothing ? "antialiased" : "auto",
  }
}
