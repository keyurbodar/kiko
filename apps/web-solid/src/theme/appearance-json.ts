// The appearance settings as one json document, the way a code editor's settings.json works:
// everything but the theme list and the chat background's picture is edited here. Pure: the page
// turns the settings into a document, and a typed document back into settings or a sentence that
// says what is wrong and where.
import { BACKGROUND_EFFECTS, BLUR_RADIUS, SIDEBAR_OPACITY, VISIBILITY, type Background, type BackgroundEffect, type Glass } from "./glass"
import { MODES, TOKEN_NAME, isTokenValue, type Look, type Mode, type Tokens } from "./look"
import { isAccent, TINT_RANGE, type ThemeAppearance } from "./palette"

export type AppearanceDoc = {
  mode: Mode
  theme: Record<ThemeAppearance, string | null>
  accent: string | null
  tint: { hue: number; saturation: number; lightness: number }
  glass: { sidebarOpacity: number; blur: number; mainPaneGlass: boolean }
  background: { effect: BackgroundEffect; showOn: "empty" | "all"; emptyChatVisibility: number; chatVisibility: number }
  tokens: Tokens
}

export type BackgroundSettings = Pick<Background, "effect" | "scope" | "empty" | "session">

const DEFAULT_BACKGROUND: BackgroundSettings = { effect: "none", scope: "all", empty: VISIBILITY.default, session: VISIBILITY.default }

/** The settings as the document shows them. Without a picture the background block shows its defaults. */
export function toDoc(look: Look, glass: Glass, background: BackgroundSettings | null): AppearanceDoc {
  const bg = background ?? DEFAULT_BACKGROUND
  return {
    mode: look.mode,
    theme: { light: look.light, dark: look.dark },
    accent: look.accent,
    tint: { ...look.tint },
    glass: { sidebarOpacity: glass.opacity, blur: glass.blur, mainPaneGlass: glass.body },
    background: { effect: bg.effect, showOn: bg.scope, emptyChatVisibility: bg.empty, chatVisibility: bg.session },
    tokens: look.tokens,
  }
}

export const formatDoc = (doc: AppearanceDoc) => `${JSON.stringify(doc, null, 2)}\n`

export type Applied = {
  look: Pick<Look, "mode" | "light" | "dark" | "accent" | "tint" | "tokens">
  glass: Glass
  background: BackgroundSettings
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

class DocError extends Error {}
const fail = (message: string): never => {
  throw new DocError(message)
}

function only(value: Record<string, unknown>, path: string, keys: readonly string[]) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path ? `${path}.` : ""}${key} is not a setting. the settings are ${keys.join(", ")}.`)
}

function object(value: unknown, path: string): Record<string, unknown> {
  return isObject(value) ? value : fail(`${path} must be an object.`)
}

function number(value: unknown, path: string, range: { min: number; max: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < range.min || value > range.max) fail(`${path} must be a number from ${range.min} to ${range.max}.`)
  return value as number
}

/**
 * Reads a typed document. A key left out keeps its current value, so a short document is fine.
 * `themes` are the ids a half may name: the built-in and imported themes, and "wallpaper" when the
 * picture's palette is known.
 */
export function fromDoc(text: string, current: AppearanceDoc, themes: ReadonlySet<string>): { ok: true; value: Applied } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `not valid json: ${(e instanceof Error ? e.message : String(e)).toLowerCase()}` }
  }
  try {
    const doc = object(raw, "the document")
    only(doc, "", ["mode", "theme", "accent", "tint", "glass", "background", "tokens"])

    const mode = doc.mode === undefined ? current.mode : MODES.includes(doc.mode as Mode) ? (doc.mode as Mode) : fail(`mode must be one of ${MODES.join(", ")}.`)

    const theme = { ...current.theme }
    if (doc.theme !== undefined) {
      const t = object(doc.theme, "theme")
      only(t, "theme", ["light", "dark"])
      for (const half of ["light", "dark"] as const) {
        if (t[half] === undefined) continue
        const id = t[half]
        if (id !== null && (typeof id !== "string" || !themes.has(id))) fail(`theme.${half} must be null for kiko's own theme, or one of: ${[...themes].join(", ")}.`)
        theme[half] = id as string | null
      }
    }

    const accent = doc.accent === undefined ? current.accent : doc.accent === null ? null : isAccent(doc.accent) ? doc.accent.toLowerCase() : fail(`accent must be null or a color like "#4da3f5".`)

    const tint = { ...current.tint }
    if (doc.tint !== undefined) {
      const t = object(doc.tint, "tint")
      only(t, "tint", ["hue", "saturation", "lightness"])
      for (const key of ["hue", "saturation", "lightness"] as const) if (t[key] !== undefined) tint[key] = Math.round(number(t[key], `tint.${key}`, TINT_RANGE[key]))
    }

    const glass = { ...current.glass }
    if (doc.glass !== undefined) {
      const g = object(doc.glass, "glass")
      only(g, "glass", ["sidebarOpacity", "blur", "mainPaneGlass"])
      if (g.sidebarOpacity !== undefined) glass.sidebarOpacity = Math.round(number(g.sidebarOpacity, "glass.sidebarOpacity", SIDEBAR_OPACITY) * 100) / 100
      if (g.blur !== undefined) glass.blur = Math.round(number(g.blur, "glass.blur", { min: 0, max: BLUR_RADIUS.max }))
      if (g.mainPaneGlass !== undefined) glass.mainPaneGlass = typeof g.mainPaneGlass === "boolean" ? g.mainPaneGlass : fail("glass.mainPaneGlass must be true or false.")
    }

    const background = { ...current.background }
    if (doc.background !== undefined) {
      const b = object(doc.background, "background")
      only(b, "background", ["effect", "showOn", "emptyChatVisibility", "chatVisibility"])
      if (b.effect !== undefined) background.effect = BACKGROUND_EFFECTS.includes(b.effect as BackgroundEffect) ? (b.effect as BackgroundEffect) : fail(`background.effect must be one of ${BACKGROUND_EFFECTS.join(", ")}.`)
      if (b.showOn !== undefined) background.showOn = b.showOn === "empty" || b.showOn === "all" ? b.showOn : fail(`background.showOn must be "empty" or "all".`)
      if (b.emptyChatVisibility !== undefined) background.emptyChatVisibility = Math.round(number(b.emptyChatVisibility, "background.emptyChatVisibility", VISIBILITY) * 100) / 100
      if (b.chatVisibility !== undefined) background.chatVisibility = Math.round(number(b.chatVisibility, "background.chatVisibility", VISIBILITY) * 100) / 100
    }

    let tokens = current.tokens
    if (doc.tokens !== undefined) {
      const t = object(doc.tokens, "tokens")
      only(t, "tokens", ["light", "dark"])
      const next: Record<ThemeAppearance, Record<string, string>> = { light: {}, dark: {} }
      for (const half of ["light", "dark"] as const) {
        if (t[half] === undefined) continue
        for (const [name, value] of Object.entries(object(t[half], `tokens.${half}`))) {
          if (!TOKEN_NAME.test(name)) fail(`tokens.${half}: "${name}" must be a css variable name like "--accent".`)
          if (!isTokenValue(value)) fail(`tokens.${half}.${name} must be a css value of up to 120 characters, with no ; { } < > or url().`)
          next[half][name] = (value as string).trim()
        }
      }
      tokens = next
    }

    return {
      ok: true,
      value: {
        look: { mode, light: theme.light, dark: theme.dark, accent, tint, tokens },
        glass: { opacity: glass.sidebarOpacity, blur: glass.blur, body: glass.mainPaneGlass },
        background: { effect: background.effect, scope: background.showOn, empty: background.emptyChatVisibility, session: background.chatVisibility },
      },
    }
  } catch (e) {
    if (e instanceof DocError) return { ok: false, error: e.message }
    throw e
  }
}

