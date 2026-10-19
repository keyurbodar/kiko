import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyCommitted, CACHE_KEY, selectBuiltin, importedThemes, readCache, resolveLook, saveImported, writeCache } from "./apply"
import { withPalette, withBootPalettes } from "../scripts/gen-palette"
import { DEFAULT_DISPLAY, DISPLAY_STACK, MONO_STACK, SANS_STACK, displayVars, fontFamily } from "./display"
import { formatImported, IMPORTED_KEY, parseImported, type Imported } from "./imported"
import { DEFAULT_LOOK, formatLook, parseLook, type Look } from "./look"
import { DARK_THEME_IDS, THEME_IDS, THEMES, DEFAULT_DARK_THEME, resolveAppearance, PALETTES, paletteFor, tokensFor } from "./palette"

const KAT = readFileSync(join(import.meta.dir, "../../../apps/web-solid/src/index.css"), "utf8")

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function katRule(selector: string, after: string): Record<string, string> {
  const start = KAT.indexOf(`${selector} {`, KAT.indexOf(after))
  const body = KAT.slice(KAT.indexOf("{", start) + 1, KAT.indexOf("\n}", start))
  return Object.fromEntries(body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]))
}

describe("the palette", () => {
  test("index.css paints Kiko's palette before any module loads", () => {
    expect(withPalette(KAT)).toBe(KAT)
    expect(katRule(":root", "palette:start")).toEqual(tokensFor("dark"))
    expect(katRule(':root:not(.dark)', "palette:start")).toEqual(tokensFor("light"))
  })

  test("every token the palette sets is one index.css declares, so it reaches the UI", () => {
    const declared = new Set([...KAT.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))
    for (const token of Object.keys(tokensFor("light", "moss"))) expect([token, declared.has(token)]).toEqual([token, true])
  })

  test("a palette color is declared only in the first-paint block", () => {
    const outside = KAT.slice(0, KAT.indexOf("palette:start")) + KAT.slice(KAT.indexOf("palette:end"))
    for (const token of Object.keys(tokensFor("light"))) expect([token, new RegExp(`^\\s*${token}:`, "m").test(outside)]).toEqual([token, false])
  })

  test("index.css declares the radius, type and icon scales", () => {
    for (const token of ["--radius-xs", "--radius-sm", "--radius-md", "--radius-lg", "--radius-bubble", "--radius-pill", "--font-xs", "--font-sm", "--font-md", "--font-base", "--font-lg", "--icon-xs", "--icon-sm", "--icon-md", "--icon-lg"]) {
      expect([token, new RegExp(`^\\s*${token}:`, "m").test(KAT)]).toEqual([token, true])
    }
  })

  test("all eight authored palettes keep text, links and semantic colors readable", () => {
    expect(THEME_IDS).toHaveLength(8)
    expect(new Set(THEME_IDS.map((id) => THEMES[id].palette.canvas)).size).toBe(8)
    for (const id of THEME_IDS) {
      const { palette: p, accent } = THEMES[id]
      for (const background of [p.canvas, p.sidebar]) {
        expect(contrast(p.text, background)).toBeGreaterThan(12)
        for (const foreground of [p.muted, p.faint, accent, p.danger, p.gold]) expect(contrast(foreground, background)).toBeGreaterThan(4.5)
      }
      expect(contrast(p.onAction, p.action)).toBeGreaterThan(12)
    }
  })
  test("system uses Snow and the remembered dark palette", () => {
    expect(resolveAppearance("system", false)).toBe("light")
    expect(resolveAppearance("system", true)).toBe("dark")
    for (const id of DARK_THEME_IDS) {
      expect(paletteFor("light", id)).toEqual(THEMES.snow.palette)
      expect(paletteFor("dark", id)).toEqual(THEMES[id].palette)
    }
  })
  test("marks and message highlights use the selected palette accent", () => {
    expect(tokensFor("dark", "glacier")["--ring"]).toBe("#96c8eb")
    expect(tokensFor("dark", "glacier")["--message-user"]).toContain("#96c8eb")
    expect(tokensFor("dark")["--popover"]).toBe("#101a24")
  })
  test("contrast scales neutral fills", () => {
    expect(tokensFor("dark", "glacier", 150)["--border"]).toBe(`color-mix(in oklab, ${PALETTES.dark.text} 9%, transparent)`)
  })

})

describe("the fonts", () => {
  test("empty preferences use system fonts and clearing custom fonts restores them", () => {
    expect(SANS_STACK).toStartWith("-apple-system")
    expect(DISPLAY_STACK).toBe(SANS_STACK)
    const custom = displayVars({ ...DEFAULT_DISPLAY, interfaceFont: "Arial", codeFont: "Courier New" })
    expect(custom["--font-family-sans"]).toStartWith("Arial,")
    expect(custom["--font-family-display"]).toBe(custom["--font-family-sans"])
    expect(custom["--font-family-mono"]).toStartWith('"Courier New",')
    const reset = displayVars(DEFAULT_DISPLAY)
    expect(reset["--font-family-sans"]).toBe(SANS_STACK)
    expect(reset["--font-family-display"]).toBe(SANS_STACK)
    expect(reset["--font-family-mono"]).toBe(MONO_STACK)
  })
  test("the system mono stack names concrete fonts before the generic ui-monospace", () => {
    const stack = MONO_STACK
    expect(stack.indexOf("Menlo")).toBeLessThan(stack.indexOf("ui-monospace"))
  })
})

describe("the look record", () => {
  test("nothing stored, or anything unreadable, is the default look", () => {
    for (const text of [null, "", "{ nope", JSON.stringify({ kind: "other" })]) expect(parseLook(text)).toEqual(DEFAULT_LOOK)
  })

  test("the default appearance is dark, and a stored look with no mode reads as dark", () => {
    expect(DEFAULT_LOOK.mode).toBe("dark")
    expect(parseLook(JSON.stringify({ kind: "look", version: 2, darkTheme: DEFAULT_DARK_THEME })).mode).toBe("dark")
  })

  test("a look survives the round trip", () => {
    const look: Look = { ...DEFAULT_LOOK, mode: "dark", darkTheme: "dusk", avatars: { ada: { flavour: "matcha", charm: "beret", outfit: "none" } } }
    expect(parseLook(formatLook(look))).toEqual(look)
  })

  test("a record from the old theme system keeps its mode and avatars and drops the rest", () => {
    const old = JSON.stringify({ version: 1, kind: "look", mode: "light", light: "grove", dark: null, themes: [], tint: { hue: 10 }, accent: "#ec4899", birds: { bo: "ramune.none" } })
    expect(parseLook(old)).toEqual({ ...DEFAULT_LOOK, mode: "light", avatars: { bo: { flavour: "ramune" } } })
  })

  test("a version 2 bird record converts once to avatar pins, and the next save writes version 4", () => {
    const v2 = JSON.stringify({
      version: 2, kind: "look", mode: "dark", accent: "yuzu",
      birds: { kiko: "kiko.beret", ada: "peach.momiji", bo: "lavender.bucket", cy: "mintchoco.nightcap", di: "nope.none", ed: "matcha.phones" },
      display: DEFAULT_LOOK.display,
    })
    const look = parseLook(v2)
    expect(look.avatars).toEqual({
      kiko: { flavour: "fubuki", charm: "beret" },
      ada: { flavour: "momo", leaf: "momiji" },
      bo: { flavour: "ajisai" },
      cy: { flavour: "chocomint" },
      ed: { flavour: "matcha", charm: "headphones" },
    })
    expect(JSON.parse(formatLook(look))).toMatchObject({ version: 4, avatars: look.avatars })
    expect(JSON.parse(formatLook(look))).not.toHaveProperty("birds")
  })

  test("a version 3 record drops values the library does not have, and an entry with none left", () => {
    const v3 = JSON.stringify({
      version: 3, kind: "look", mode: "system", darkTheme: DEFAULT_LOOK.darkTheme, display: DEFAULT_LOOK.display,
      avatars: { ada: { flavour: "matcha", charm: "crown", eye: "kuromame" }, bo: { flavour: "dragon", leaf: "nope" }, "Bad Slug": { flavour: "matcha" } },
    })
    expect(parseLook(v3).avatars).toEqual({ ada: { flavour: "matcha", eye: "kuromame" } })
  })
})

function fakeRoot() {
  const style: Record<string, string> = {}
  const classes = new Set<string>()
  const dataset: Record<string, string> = {}
  const root = {
    dataset,
    style: {
      setProperty: (k: string, v: string) => void (style[k] = v),
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

describe("the pre-paint script", () => {
  const html = readFileSync(join(import.meta.dir, "../../../apps/web-solid/index.html"), "utf8")
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!
  function boot(stored: string | null, signedIn = true, prefersLight = false, imported: string | null = null) {
    const { root, style, classes } = fakeRoot()
    const storage = { getItem: (k: string) => k === CACHE_KEY ? stored : k === IMPORTED_KEY ? imported : k === "kiko:session" && signedIn ? "owner" : null, removeItem() {} }
    new Function("document", "localStorage", "matchMedia", script)({ documentElement: root }, storage, () => ({ matches: prefersLight }))
    return { style, classes }
  }
  test("generated boot palettes and static canvas stay in sync", async () => {
    expect(await withBootPalettes(html)).toBe(html)
    expect(html).toContain(`<meta name="theme-color" content="${PALETTES.dark.canvas}" />`)
  })
  function expectRuntime(stored: string | null, imported: string | null = null, prefersLight = false, signedIn = true) {
    const cached = stored ? JSON.parse(stored) : null
    const look = signedIn ? parseLook(cached?.text ?? null) : DEFAULT_LOOK
    saveImported(signedIn ? parseImported(imported) : { themes: [], active: {} })
    try {
      const mode = resolveAppearance(look.mode, !prefersLight)
      const expected = resolveLook(look)[mode]
      const painted = boot(stored, signedIn, prefersLight, imported)
      for (const [key, value] of Object.entries(expected)) expect([key, painted.style[key]]).toEqual([key, value])
      expect(painted.classes.has("dark")).toBe(mode === "dark")
    } finally { saveImported({ themes: [], active: {} }) }
  }
  const custom: Imported = {
    themes: [
      { id: "custom", name: "Custom", source: "test", appearance: "dark", accent: "#abcdef", palette: { ...PALETTES.dark, canvas: "#221122" } },
      { id: "custom-light", name: "Custom light", source: "test", appearance: "light", accent: "#654321", palette: { ...PALETTES.light, canvas: "#ffeedd" } },
    ],
    active: { dark: "custom", light: "custom-light" },
  }
  const display = { ...DEFAULT_LOOK.display, contrast: 150, baseSize: 16, interfaceFont: "Arial", codeFont: "Courier New", chatWidth: "wide" as const, smoothing: false }
  test("every built-in, Snow and System match the runtime despite poisoned cached vars", () => {
    for (const darkTheme of DARK_THEME_IDS) {
      for (const mode of ["dark", "light", "system"] as const) {
        const text = formatLook({ ...DEFAULT_LOOK, darkTheme, mode, display })
        const cache = JSON.stringify({ v: 6, text, mode: "light", vars: { dark: { "--background": "red", "--font-md": "99px" } } })
        for (const prefersLight of [false, true]) expectRuntime(cache, null, prefersLight)
      }
    }
  })
  test("current imported palettes and display settings match the runtime", () => {
    for (const mode of ["dark", "light", "system"] as const) {
      const text = formatLook({ ...DEFAULT_LOOK, mode, display })
      const cache = JSON.stringify({ v: 6, text, vars: { dark: { "--background": "red" } } })
      for (const prefersLight of [false, true]) expectRuntime(cache, formatImported(custom), prefersLight)
    }
  })
  test("an imported palette with no saved Look matches runtime defaults plus imports", () => {
    expectRuntime(null, formatImported(custom))
  })
  test("signed-out prepaint always uses the full default Glacier look", () => {
    const text = formatLook({ ...DEFAULT_LOOK, mode: "light", darkTheme: "plum", display })
    expectRuntime(JSON.stringify({ v: 6, text }), formatImported(custom), true, false)
  })
  test("invalid cache and imported data fall back independently", () => {
    for (const stored of [null, "{", JSON.stringify({ v: 6, text: "{" })]) {
      const painted = boot(stored, true, false, formatImported(custom))
      expect(painted.style["--background"]).toBe("#221122")
    }
    for (const imported of ["{", JSON.stringify({ v: 1, themes: [{ ...custom.themes[0], accent: "red" }], active: custom.active })]) {
      expectRuntime(null, imported)
    }
  })
  test("invalid look fields use the runtime defaults and display parser", () => {
    const text = JSON.stringify({ kind: "look", version: 4, mode: "invalid", darkTheme: ["moss"], display: { contrast: 900, baseSize: 2, interfaceFont: "<Arial>", chatWidth: "nope" } })
    expectRuntime(JSON.stringify({ v: 6, text }))
  })
  test("legacy cache migrates to Glacier and preserves mode, avatars and display", () => {
    const old = { version: 3, kind: "look", mode: "system", accent: "yuzu", avatars: { ada: { flavour: "matcha" } }, display }
    const value = JSON.stringify({ v: 5, text: JSON.stringify(old), vars: { dark: { "--background": "orange" } } })
    const storage = { getItem: () => value }
    Object.assign(globalThis, { localStorage: storage })
    try {
      const cache = readCache()!
      expect(cache.v).toBe(6)
      expect(cache.vars.dark["--background"]).toBe(PALETTES.dark.canvas)
      expect(parseLook(cache.text)).toMatchObject({ darkTheme: "glacier", mode: "system", avatars: old.avatars, display: old.display })
      expectRuntime(value, null, true)
      expectRuntime(value, null, false)
      expect(boot(value, false, true).classes.has("dark")).toBe(true)
    } finally { delete (globalThis as { localStorage?: unknown }).localStorage }
  })
  test("reads the cache writer and resolves Snow", () => {
    const store: Record<string, string> = {}
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v }, removeItem: (k: string) => { delete store[k] } } })
    try {
      const look = { ...DEFAULT_LOOK, mode: "light" as const }
      writeCache(formatLook(look), look)
      expect(boot(store[CACHE_KEY]!).style["--background"]).toBe(PALETTES.light.canvas)
    } finally { delete (globalThis as { localStorage?: unknown }).localStorage }
  })
})

describe("painting a look", () => {
  test("the page's own ink follows the look, not the pre-paint guess", () => {
    const { root, style } = fakeRoot()
    const page = { documentElement: { ...root, style: { ...root.style, removeProperty: () => {} } }, querySelectorAll: () => [] }
    ;(globalThis as { document?: unknown }).document = page
    try {
      style["--boot-fg"] = PALETTES.light.text
      applyCommitted({ ...DEFAULT_LOOK, mode: "dark" })
      expect([style["--boot-bg"], style["--boot-fg"]]).toEqual([PALETTES.dark.canvas, PALETTES.dark.text])
      applyCommitted({ ...DEFAULT_LOOK, mode: "light" })
      expect([style["--boot-bg"], style["--boot-fg"]]).toEqual([PALETTES.light.canvas, PALETTES.light.text])
    } finally {
      delete (globalThis as { document?: unknown }).document
    }
  })
})

describe("imported themes", () => {
  test("paint while signed in and never on the signed-out screens", () => {
    const canvas = "#1e1e2e"
    const palette = { ...PALETTES.dark, canvas }
    saveImported({ themes: [{ id: "mocha", name: "Mocha", source: "catppuccin.catppuccin-vsc", appearance: "dark", accent: "#cba6f7", palette }], active: { dark: "mocha" } })
    expect(resolveLook(DEFAULT_LOOK).dark["--background"]).toBe(canvas)
    applyCommitted(DEFAULT_LOOK, false)
    expect(resolveLook(DEFAULT_LOOK).dark["--background"]).toBe(PALETTES.dark.canvas)
    applyCommitted(DEFAULT_LOOK)
    expect(resolveLook(DEFAULT_LOOK).dark["--background"]).toBe(canvas)
    saveImported({ themes: [], active: {} })
  })
})

describe("the font names", () => {
  test("a typed name goes first, quoted when it has spaces, and the system stack follows", () => {
    expect(fontFamily("", SANS_STACK)).toBe(SANS_STACK)
    expect(fontFamily("Inter, JetBrains Mono", SANS_STACK)).toBe(`Inter, "JetBrains Mono", ${SANS_STACK}`)
  })
})

test("choosing each built-in clears its imported override and remembers the dark choice", () => {
  const dark = { id: "dark", name: "Dark", source: "test", appearance: "dark" as const, accent: "#abcdef", palette: PALETTES.dark }
  const light = { ...dark, id: "light", appearance: "light" as const, palette: PALETTES.light }
  for (const id of THEME_IDS) {
    saveImported({ themes: [dark, light], active: { dark: dark.id, light: light.id } })
    const next = selectBuiltin({ ...DEFAULT_LOOK, darkTheme: "moss", mode: "system" }, id)
    expect(next.mode).toBe(id === "snow" ? "light" : "dark")
    expect(next.darkTheme).toBe(id === "snow" ? "moss" : id)
    expect(importedThemes().active[next.mode === "light" ? "light" : "dark"]).toBeUndefined()
    expect(importedThemes().active[id === "snow" ? "dark" : "light"]).toBe(id === "snow" ? dark.id : light.id)
    expect(importedThemes().themes).toHaveLength(2)
  }
  saveImported({ themes: [], active: {} })
})
