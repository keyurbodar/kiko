import { typeVars } from "./system"
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
  comfortable: { label: "Comfortable", width: "820px" },
  wide: { label: "Wide", width: "1152px" },
  full: { label: "Full", width: "100%" },
}

const SANS_STACK = '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
const MONO_STACK = '"JetBrains Mono", "SF Mono", Menlo, Consolas, ui-monospace, monospace'

function quoteFamily(name: string): string {
  const bare = name.trim()
  if (bare.length === 0) return ""
  if (/^(['"]).*\1$/.test(bare)) return bare
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare
  return `"${bare.replaceAll('"', "")}"`
}

export function cssFontFamilies(input: string): string | null {
  const families = input
    .split(",")
    .map(quoteFamily)
    .filter((name) => name.length > 0)
  return families.length > 0 ? families.join(", ") : null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const oneOf = <T extends string>(table: Record<T, unknown>, v: unknown, fallback: T): T =>
  typeof v === "string" && v in table ? (v as T) : fallback

const PRESET_KEYS = new Set(["kiko", "system", "rounded", "serif", "mono", "fantasque", "interface"])
const familyName = (v: unknown): string => {
  if (typeof v !== "string" || PRESET_KEYS.has(v)) return ""
  return v
    .replace(/["';\\{}<>]/g, "")
    .trim()
    .slice(0, NAME_MAX)
}

export function readDisplay(value: unknown): Display {
  if (!isObject(value)) return DEFAULT_DISPLAY
  const c = typeof value.contrast === "number" && Number.isFinite(value.contrast) ? value.contrast : CONTRAST.default
  const size =
    typeof value.baseSize === "number" && Number.isFinite(value.baseSize)
      ? Math.round(value.baseSize)
      : BASE_SIZE.default
  return {
    contrast: Math.round(Math.min(CONTRAST.max, Math.max(CONTRAST.min, c)) / CONTRAST.step) * CONTRAST.step,
    chatWidth: oneOf(CHAT_WIDTHS, value.chatWidth, DEFAULT_DISPLAY.chatWidth),
    interfaceFont: familyName(value.interfaceFont),
    codeFont: familyName(value.codeFont),
    baseSize: Math.min(BASE_SIZE.max, Math.max(BASE_SIZE.min, size)),
    smoothing: typeof value.smoothing === "boolean" ? value.smoothing : DEFAULT_DISPLAY.smoothing,
  }
}

function fontVars(display: Display): Record<string, string> {
  const vars: Record<string, string> = {}
  const sans = cssFontFamilies(display.interfaceFont)
  const mono = cssFontFamilies(display.codeFont)
  if (sans !== null) vars["--font-family-sans"] = `${sans}, ${SANS_STACK}`
  if (mono !== null) vars["--font-family-mono"] = `${mono}, ${MONO_STACK}`
  return vars
}

export function displayVars(display: Display): Record<string, string> {
  const b = display.baseSize
  return {
    ...fontVars(display),
    ...typeVars(b),
    "--chat-content-max-width": CHAT_WIDTHS[display.chatWidth].width,
    "--font-smoothing": display.smoothing ? "antialiased" : "auto",
  }
}
