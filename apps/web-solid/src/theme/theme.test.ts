import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyCommitted, CACHE_KEY, endPreview, preview, resolveLook, writeCache } from "./apply"
import { BUILT_IN_THEMES } from "./builtins"
import { canonicalColor, colorToHex, pairVsCodeThemes, parseAnyThemeFile, parseThemeFile, parseVsCodeThemeFile, stripJsonComments } from "./import"
import { colorsFor, DEFAULT_LOOK, formatLook, parseLook, withHalf, withTheme, type Look } from "./look"
import {
  DEFAULT_DARK_COLORS,
  DEFAULT_LIGHT_COLORS,
  oklchOf,
  readStoredThemes,
  serializeThemeFile,
  THEME_COLOR_ROLES,
  themeModes,
  TOKEN_ROLES,
  tokensFor,
  type ThemeDefinition,
} from "./palette"

const KAT = readFileSync(join(import.meta.dir, "../../../../packages/ui/src/styles/kat.css"), "utf8")
const grove = BUILT_IN_THEMES.find((t) => t.id === "grove")!
const imported = parseThemeFile({ version: 1, name: "Aurora", appearance: "dark", colors: { canvas: "#102030", accent: "#e05050" } })

const dracula = {
  name: "Dracula",
  type: "dark",
  colors: {
    "editor.background": "#282A36",
    "editor.foreground": "#F8F8F2",
    "sideBar.background": "#21222C",
    focusBorder: "#6272A4",
    "button.background": "#44475A",
    "list.hoverBackground": "#44475A75",
  },
  tokenColors: [],
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** The declarations of one kat.css rule, as a map. */
function katRule(selector: string, after: string): Record<string, string> {
  const start = KAT.indexOf(`${selector} {`, KAT.indexOf(after))
  const body = KAT.slice(KAT.indexOf("{", start) + 1, KAT.indexOf("\n}", start))
  return Object.fromEntries(body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]))
}

describe("the palette on kiko's tokens", () => {
  test("kat.css paints t3code's stock palette before any theme loads", () => {
    // The 4e block is what a fresh browser sees. It must equal what the theme code paints.
    expect(katRule(":root", "4e. The palette")).toEqual(tokensFor(DEFAULT_DARK_COLORS))
    expect(katRule(':root[data-appearance="light"]', "4e. The palette")).toEqual(tokensFor(DEFAULT_LIGHT_COLORS))
  })

  test("every token a theme sets is one kat.css declares, so a theme reaches the UI", () => {
    const declared = new Set([...KAT.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))
    for (const token of Object.keys(tokensFor(DEFAULT_DARK_COLORS))) expect([token, declared.has(token)]).toEqual([token, true])
  })

  test("each role lands on its token, and the hue follows the accent", () => {
    const vars = tokensFor(grove.variants!.dark!)
    for (const [token, role] of TOKEN_ROLES) expect(vars[token]).toBe(grove.variants!.dark![role])
    expect(Number(vars["--hue"])).toBeCloseTo(oklchOf(grove.variants!.dark!.accent)!.h, 0)
    expect(vars["--tint"]).toContain(grove.variants!.dark!.text)
  })

  test("hex and oklch read to the same lightness, chroma and hue", () => {
    const hex = oklchOf("#346bf1")!
    const ok = oklchOf(canonicalColor("#346bf1")!)!
    expect([hex.l, hex.c, hex.h].map((n) => n.toFixed(2))).toEqual([ok.l, ok.c, ok.h].map((n) => n.toFixed(2)))
  })

  test("every built-in is t3code's: valid, stored safely, and draws both modes", () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual(["t3-chat", "grove", "ocean", "ember", "iris"])
    // Reading them back through the store's guard drops nothing, so every color is a safe literal.
    expect(readStoredThemes(JSON.parse(JSON.stringify(BUILT_IN_THEMES)))).toEqual(BUILT_IN_THEMES as ThemeDefinition[])
    for (const theme of BUILT_IN_THEMES) expect(themeModes(theme)).toEqual(["light", "dark"])
  })
})

describe("stored themes", () => {
  test("a color that could end the declaration is dropped for the stock one", () => {
    const [theme] = readStoredThemes([{ id: "x", label: "X", appearance: "dark", colors: { canvas: "red; background: url(x)", text: "#fff" } }])
    expect([theme!.colors.canvas, theme!.colors.text]).toEqual([DEFAULT_DARK_COLORS.canvas, "#fff"])
  })

  test("malformed entries and duplicate ids are skipped", () => {
    const good = { id: "a", label: "A", appearance: "light", colors: {} }
    expect(readStoredThemes([good, { ...good, label: "again" }, { id: "Bad Id", label: "B", appearance: "light", colors: {} }, null]).map((t) => t.label)).toEqual(["A"])
    expect(readStoredThemes("nope")).toEqual([])
  })
})

describe("the look record", () => {
  test("nothing stored, or anything unreadable, is the default look", () => {
    for (const text of [null, "", "{ nope", "[]", '{"version":1}']) expect(parseLook(text)).toEqual(DEFAULT_LOOK)
  })

  test("a record from before t3code's themes keeps its mode and birds, and drops the old looks", () => {
    const old = JSON.stringify({ version: 1, kind: "look", mode: "light", material: "frost", tint: 0.5, preset: "plum", wallpaper: null, birds: { scout: "robin" } })
    expect(parseLook(old)).toEqual({ ...DEFAULT_LOOK, mode: "light", birds: { scout: "robin" } })
  })

  test("a look survives the round trip, carrying the imported theme its half names", () => {
    const look = withHalf(withTheme(DEFAULT_LOOK, grove), "dark", imported)
    expect([look.light, look.dark, look.themes.map((t) => t.id)]).toEqual(["grove", "aurora", ["aurora"]])
    expect(parseLook(formatLook(look))).toEqual(look)
  })

  test("an id the record cannot resolve falls back to the stock palette", () => {
    const raw = JSON.parse(formatLook({ ...DEFAULT_LOOK, light: "grove" }))
    expect(parseLook(JSON.stringify({ ...raw, light: "missing", dark: "Not An Id" }))).toEqual(DEFAULT_LOOK)
  })

  test("a theme takes every half it can draw, and a light-only theme leaves dark alone", () => {
    const lightOnly = parseThemeFile({ version: 1, name: "Paper", appearance: "light", colors: { canvas: "#fff8ee" } })
    const look = withTheme({ ...DEFAULT_LOOK, dark: "iris" }, lightOnly)
    expect([look.light, look.dark]).toEqual(["paper", "iris"])
    expect(colorsFor(look, "light", []).canvas).toBe(lightOnly.colors.canvas)
    expect(withTheme(look, null)).toEqual({ ...DEFAULT_LOOK })
  })

  test("a half whose theme is gone or cannot draw that mode paints the stock palette", () => {
    expect(colorsFor({ ...DEFAULT_LOOK, dark: "gone" }, "dark", [])).toEqual(DEFAULT_DARK_COLORS)
    expect(colorsFor({ ...DEFAULT_LOOK, light: "aurora", themes: [imported] }, "light", [])).toEqual(DEFAULT_LIGHT_COLORS)
  })

  test("the server keeps it: a version 1 object well under its 32 KB limit with two imported themes", () => {
    const other = parseThemeFile({ version: 1, name: "Other", appearance: "light", colors: { canvas: "#fefefe" }, variants: { dark: { canvas: "#010101" } } })
    const text = formatLook(withHalf(withHalf(DEFAULT_LOOK, "light", other), "dark", imported))
    expect(JSON.parse(text).version).toBe(1)
    expect(text.length).toBeLessThan(16 * 1024)
  })
})

describe("theme files", () => {
  test("a file fills omitted roles and stores colors as oklch", () => {
    expect(imported.id).toBe("aurora")
    expect(imported.colors.canvas).toBe(canonicalColor("#102030")!)
    expect(imported.colors.text).toBe(canonicalColor(DEFAULT_DARK_COLORS.text)!)
    expect(Object.keys(imported.colors).sort()).toEqual([...THEME_COLOR_ROLES].sort())
  })

  test("unknown roles, contextual colors, and reserved and built-in ids are refused", () => {
    expect(() => parseThemeFile({ version: 1, name: "X", appearance: "dark", colors: { nope: "#fff" } })).toThrow("supported theme color role")
    expect(() => parseThemeFile({ version: 1, name: "X", appearance: "dark", colors: { canvas: "var(--x)" } })).toThrow("literal CSS color")
    expect(() => parseThemeFile({ version: 1, name: "Dark", appearance: "dark", colors: { canvas: "#000" } })).toThrow("reserved")
    expect(() => parseThemeFile({ version: 1, name: "Grove", appearance: "dark", colors: { canvas: "#000" } })).toThrow("reserved")
    expect(canonicalColor("currentColor")).toBeNull()
  })

  test("an exported theme imports to the same theme, and a built-in exports as a file t3code reads", () => {
    const theme = parseThemeFile({ version: 1, name: "Round Trip", appearance: "dark", colors: { canvas: "#123456" }, variants: { light: { canvas: "#fefefe" } } })
    expect(parseAnyThemeFile(serializeThemeFile(theme))).toEqual(theme)
    const file = JSON.parse(serializeThemeFile(grove))
    expect([file.version, file.name, file.appearance, Object.keys(file.variants)]).toEqual([1, "Grove", "light", ["dark"]])
  })
})

describe("VS Code themes", () => {
  test("Dracula converts to a dark palette on its own background, with readable text", () => {
    const theme = parseVsCodeThemeFile(dracula)
    expect(theme.appearance).toBe("dark")
    expect(theme.colors.canvas).toBe(canonicalColor("#282a36")!)
    expect(tokensFor(theme.colors)["--bg-sidebar"]).toBe(canonicalColor("#21222c")!)
    expect(contrast(colorToHex(theme.colors.text)!, "#282a36")).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colorToHex(theme.colors.sidebarForeground)!, "#21222c")).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colorToHex(theme.colors.messageActionForeground)!, colorToHex(theme.colors.messageAction)!)).toBeGreaterThanOrEqual(4.5)
  })

  test("comments and trailing commas in JSONC are stripped, not text inside strings", () => {
    const text = stripJsonComments('{\n // a comment\n "url": "https://x.y/z", /* block */ "a": [1, 2,],\n}')
    expect(JSON.parse(text)).toEqual({ url: "https://x.y/z", a: [1, 2] })
  })

  test("a light and a dark file with the same base name pair into one two-mode theme", () => {
    const light = parseVsCodeThemeFile({ name: "Solar Light", type: "light", colors: { "editor.background": "#fdf6e3" } })
    const dark = parseVsCodeThemeFile({ name: "Solar Dark", type: "dark", colors: { "editor.background": "#002b36" } })
    const [paired, ...rest] = pairVsCodeThemes([light, dark])
    expect(rest).toEqual([])
    expect(paired!.label).toBe("Solar")
    expect(themeModes(paired!)).toEqual(["light", "dark"])
  })
})

// A stand-in for the page, to prove what reaches the root element.
function fakeRoot() {
  const style: Record<string, string> = {}
  const classes = new Set<string>(["dark"])
  const dataset: Record<string, string> = {}
  const root = {
    dataset,
    style: {
      setProperty: (k: string, v: string) => void (style[k] = v),
      removeProperty: (k: string) => void delete style[k],
      set colorScheme(v: string) {
        style.colorScheme = v
      },
      set backgroundColor(v: string) {
        style.backgroundColor = v
      },
    },
    classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) },
  }
  return { root, style, classes, dataset }
}

describe("applying", () => {
  const g = globalThis as { document?: unknown }
  afterEach(() => {
    delete g.document
  })

  test("paints the half on screen, previews another look, and puts the saved one back", () => {
    const { root, style, classes, dataset } = fakeRoot()
    g.document = { documentElement: root, querySelectorAll: () => [] }
    applyCommitted({ ...withTheme(DEFAULT_LOOK, grove), mode: "dark" }, [])
    expect([style["--bg"], style["--accent"], dataset.appearance, classes.has("dark")]).toEqual([grove.variants!.dark!.canvas, grove.variants!.dark!.accent, "dark", true])
    preview({ ...withTheme(DEFAULT_LOOK, imported), mode: "dark" })
    expect(style["--bg"]).toBe(imported.colors.canvas)
    endPreview()
    expect(style["--bg"]).toBe(grove.variants!.dark!.canvas)
    applyCommitted({ ...DEFAULT_LOOK, mode: "light" }, [])
    expect([style["--bg"], dataset.appearance, classes.has("dark"), style["--boot-bg"]]).toEqual([DEFAULT_LIGHT_COLORS.canvas, "light", false, DEFAULT_LIGHT_COLORS.canvas])
  })

  test("a half on a theme only this browser's library has still paints", () => {
    const { root, style } = fakeRoot()
    g.document = { documentElement: root, querySelectorAll: () => [] }
    applyCommitted({ ...DEFAULT_LOOK, mode: "dark", dark: "aurora" }, [imported])
    expect(style["--bg"]).toBe(imported.colors.canvas)
  })
})

describe("the pre-paint script", () => {
  const html = readFileSync(join(import.meta.dir, "../../index.html"), "utf8")
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!

  function boot(stored: string | null, prefersLight = false) {
    const { root, style, classes, dataset } = fakeRoot()
    const storage = { getItem: (k: string) => (k === CACHE_KEY ? stored : null) }
    new Function("document", "localStorage", "matchMedia", script)({ documentElement: root }, storage, () => ({ matches: prefersLight }))
    return { style, classes, dataset }
  }
  const cacheOf = (look: Look) => JSON.stringify({ v: 3, text: "x", mode: look.mode, vars: resolveLook(look, []) })

  test("paints the cached tokens for the saved appearance", () => {
    const { style, dataset, classes } = boot(cacheOf({ ...withTheme(DEFAULT_LOOK, grove), mode: "light" }))
    expect([style["--bg"], style["--boot-bg"], dataset.appearance, classes.has("dark")]).toEqual([grove.colors.canvas, grove.colors.canvas, "light", false])
  })

  test("system follows the system, half by half", () => {
    const cache = cacheOf(withHalf(DEFAULT_LOOK, "dark", grove))
    expect(boot(cache, true).style["--bg"]).toBe(DEFAULT_LIGHT_COLORS.canvas)
    expect(boot(cache, false).style["--bg"]).toBe(grove.variants!.dark!.canvas)
  })

  test("with no cache, a broken one, or an old one, it follows the system on kat.css's stock palette", () => {
    expect([boot(null).style["--boot-bg"], boot(null).dataset.appearance, "--bg" in boot(null).style]).toEqual(["#0a0a0a", "dark", false])
    expect(boot("{ not json", true).dataset.appearance).toBe("light")
    expect("--l-brand-user" in boot(JSON.stringify({ v: 2, mode: "dark", vars: { dark: { "--l-brand-user": "0.9" } } })).style).toBe(false)
  })

  test("reads what writeCache writes", () => {
    const store: Record<string, string> = {}
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    }
    writeCache("text", { ...DEFAULT_LOOK, mode: "dark", dark: "aurora" }, [imported])
    expect(boot(store[CACHE_KEY]!).style["--accent"]).toBe(imported.colors.accent)
    delete (globalThis as { localStorage?: unknown }).localStorage
  })
})
