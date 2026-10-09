// The interface and font settings, after t3code's appearance page (MIT, apps/web/src/components/
// settings/SettingsPanels.tsx `AppearanceSettingsPanel`): contrast, chat width, the interface,
// prompt, and code fonts with their px sizes, and font smoothing. They travel with the look
// (look.ts), so another device shows the same, and they become css variables the theme paints, so the first paint and
// the boot screen already wear them. Fonts are system stacks plus the mono kiko ships: nothing is
// downloaded for a choice.

export type ChatWidth = "comfortable" | "wide" | "full"
export type InterfaceFont = "system" | "rounded" | "serif" | "mono"
/** The prompt box's family. `interface` follows the interface font. */
export type PromptFont = "interface" | InterfaceFont
export type CodeFont = "fantasque" | "system"

/** t3code's three px sizes (contracts/src/settings.ts), each with its own range. */
export type FontSizes = Readonly<{ interface: number; prompt: number; code: number }>

export type Display = Readonly<{
  /** Percent. Scales every border, hairline, and fill. */
  contrast: number
  chatWidth: ChatWidth
  interfaceFont: InterfaceFont
  promptFont: PromptFont
  codeFont: CodeFont
  sizes: FontSizes
  /** Thinner grayscale smoothing instead of the system's. */
  smoothing: boolean
}>

export const CONTRAST = { min: 80, max: 150, step: 5, default: 100 } as const

/** Interface text is messages and reading text: t3code sets those at 14px (text-sm on a 16px root). */
export const FONT_SIZES: Record<keyof FontSizes, { min: number; max: number; default: number }> = {
  interface: { min: 12, max: 20, default: 14 },
  prompt: { min: 12, max: 20, default: 14 },
  code: { min: 10, max: 18, default: 13 },
}

export const DEFAULT_DISPLAY: Display = {
  contrast: 100,
  chatWidth: "comfortable",
  interfaceFont: "system",
  promptFont: "interface",
  codeFont: "fantasque",
  sizes: { interface: FONT_SIZES.interface.default, prompt: FONT_SIZES.prompt.default, code: FONT_SIZES.code.default },
  smoothing: false,
}

/** t3code's lanes (index.css `--chat-content-max-width`): 46rem, 72rem, and the whole pane. */
export const CHAT_WIDTHS: Record<ChatWidth, { label: string; width: string }> = {
  comfortable: { label: "Comfortable", width: "736px" },
  wide: { label: "Wide", width: "1152px" },
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

export const PROMPT_FONTS: Record<PromptFont, { label: string }> = {
  interface: { label: "Same as interface" },
  system: INTERFACE_FONTS.system,
  rounded: INTERFACE_FONTS.rounded,
  serif: INTERFACE_FONTS.serif,
  mono: INTERFACE_FONTS.mono,
}

export const CODE_FONTS: Record<CodeFont, { label: string; family: string }> = {
  fantasque: { label: "Fantasque Sans Mono", family: `"Fantasque Sans Mono", ${MONO_SYSTEM}` },
  system: { label: "System mono", family: MONO_SYSTEM },
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const oneOf = <T extends string>(table: Record<T, unknown>, v: unknown, fallback: T): T => (typeof v === "string" && v in table ? (v as T) : fallback)

const px = (v: unknown, key: keyof FontSizes): number => {
  const { min, max, default: fallback } = FONT_SIZES[key]
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
}

/** Display settings read from a stored look. Anything missing or malformed is its default. */
export function readDisplay(value: unknown): Display {
  if (!isObject(value)) return DEFAULT_DISPLAY
  const c = typeof value.contrast === "number" && Number.isFinite(value.contrast) ? value.contrast : CONTRAST.default
  const sizes = isObject(value.sizes) ? value.sizes : {}
  return {
    contrast: Math.round(Math.min(CONTRAST.max, Math.max(CONTRAST.min, c)) / CONTRAST.step) * CONTRAST.step,
    chatWidth: oneOf(CHAT_WIDTHS, value.chatWidth, DEFAULT_DISPLAY.chatWidth),
    interfaceFont: oneOf(INTERFACE_FONTS, value.interfaceFont, DEFAULT_DISPLAY.interfaceFont),
    promptFont: oneOf(PROMPT_FONTS, value.promptFont, DEFAULT_DISPLAY.promptFont),
    codeFont: oneOf(CODE_FONTS, value.codeFont, DEFAULT_DISPLAY.codeFont),
    sizes: { interface: px(sizes.interface, "interface"), prompt: px(sizes.prompt, "prompt"), code: px(sizes.code, "code") },
    smoothing: typeof value.smoothing === "boolean" ? value.smoothing : DEFAULT_DISPLAY.smoothing,
  }
}

/** The css variables these settings set. Contrast is applied where the neutrals are mixed (palette.ts). */
export function displayVars(display: Display): Record<string, string> {
  const prompt = display.promptFont === "interface" ? display.interfaceFont : display.promptFont
  return {
    "--font-base": `${display.sizes.interface}px`,
    "--font-size-prompt": `${display.sizes.prompt}px`,
    "--font-size-code": `${display.sizes.code}px`,
    "--content-max-w": CHAT_WIDTHS[display.chatWidth].width,
    "--font-family-sans": INTERFACE_FONTS[display.interfaceFont].family,
    "--font-family-prompt": INTERFACE_FONTS[prompt].family,
    "--font-family-mono": CODE_FONTS[display.codeFont].family,
    "--font-smoothing": display.smoothing ? "antialiased" : "auto",
  }
}
