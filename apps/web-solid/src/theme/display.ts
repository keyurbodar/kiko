// The interface and font settings, after t3code's appearance page (MIT, apps/web/src/components/
// settings/SettingsPanels.tsx `AppearanceSettingsPanel`): contrast, text size, chat width, the
// interface and code fonts, and font smoothing. They travel with the look (look.ts), so another
// device shows the same, and they become css variables the theme paints, so the first paint and
// the boot screen already wear them. Fonts are system stacks plus the mono kiko ships: nothing is
// downloaded for a choice.

export type TextSize = "small" | "default" | "large" | "larger"
export type ChatWidth = "comfortable" | "wide" | "full"
export type InterfaceFont = "system" | "rounded" | "serif" | "mono"
export type CodeFont = "fantasque" | "system"

export type Display = Readonly<{
  /** Percent. Scales every border, hairline, and fill. */
  contrast: number
  textSize: TextSize
  chatWidth: ChatWidth
  interfaceFont: InterfaceFont
  codeFont: CodeFont
  /** Thinner grayscale smoothing instead of the system's. */
  smoothing: boolean
}>

export const CONTRAST = { min: 80, max: 150, step: 5, default: 100 } as const

export const DEFAULT_DISPLAY: Display = { contrast: 100, textSize: "default", chatWidth: "comfortable", interfaceFont: "system", codeFont: "fantasque", smoothing: false }

export const TEXT_SIZES: Record<TextSize, { label: string; px: number }> = {
  small: { label: "Small", px: 12 },
  default: { label: "Default", px: 13 },
  large: { label: "Large", px: 14 },
  larger: { label: "Larger", px: 15 },
}

export const CHAT_WIDTHS: Record<ChatWidth, { label: string; width: string }> = {
  comfortable: { label: "Comfortable", width: "768px" },
  wide: { label: "Wide", width: "960px" },
  full: { label: "Full", width: "100%" },
}

const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
const MONO_SYSTEM = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export const INTERFACE_FONTS: Record<InterfaceFont, { label: string; family: string }> = {
  system: { label: "System", family: SANS },
  rounded: { label: "Rounded", family: `ui-rounded, "SF Pro Rounded", ${SANS}` },
  serif: { label: "Serif", family: 'ui-serif, "New York", Charter, Georgia, serif' },
  mono: { label: "Mono", family: `"Fantasque Sans Mono", ${MONO_SYSTEM}` },
}

export const CODE_FONTS: Record<CodeFont, { label: string; family: string }> = {
  fantasque: { label: "Fantasque Sans Mono", family: `"Fantasque Sans Mono", ${MONO_SYSTEM}` },
  system: { label: "System mono", family: MONO_SYSTEM },
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const oneOf = <T extends string>(table: Record<T, unknown>, v: unknown, fallback: T): T => (typeof v === "string" && v in table ? (v as T) : fallback)

/** Display settings read from a stored look. Anything missing or malformed is its default. */
export function readDisplay(value: unknown): Display {
  if (!isObject(value)) return DEFAULT_DISPLAY
  const c = typeof value.contrast === "number" && Number.isFinite(value.contrast) ? value.contrast : CONTRAST.default
  return {
    contrast: Math.round(Math.min(CONTRAST.max, Math.max(CONTRAST.min, c)) / CONTRAST.step) * CONTRAST.step,
    textSize: oneOf(TEXT_SIZES, value.textSize, DEFAULT_DISPLAY.textSize),
    chatWidth: oneOf(CHAT_WIDTHS, value.chatWidth, DEFAULT_DISPLAY.chatWidth),
    interfaceFont: oneOf(INTERFACE_FONTS, value.interfaceFont, DEFAULT_DISPLAY.interfaceFont),
    codeFont: oneOf(CODE_FONTS, value.codeFont, DEFAULT_DISPLAY.codeFont),
    smoothing: typeof value.smoothing === "boolean" ? value.smoothing : DEFAULT_DISPLAY.smoothing,
  }
}

/** The css variables these settings set. Contrast is applied where the neutrals are mixed (palette.ts). */
export function displayVars(display: Display): Record<string, string> {
  return {
    "--font-base": `${TEXT_SIZES[display.textSize].px}px`,
    "--content-max-w": CHAT_WIDTHS[display.chatWidth].width,
    "--font-family-sans": INTERFACE_FONTS[display.interfaceFont].family,
    "--font-family-mono": CODE_FONTS[display.codeFont].family,
    "--font-smoothing": display.smoothing ? "antialiased" : "auto",
  }
}
