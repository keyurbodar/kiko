import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyCommitted, CACHE_KEY, resolveLook, saveImported, writeCache } from "./apply"
import { withPalette } from "../scripts/gen-palette"
import { MONO_STACK, SANS_STACK, fontFamily } from "./display"
import { DEFAULT_LOOK, formatLook, parseLook, type Look } from "./look"
import { ACCENT_IDS, ACCENTS, DEFAULT_ACCENT, PALETTES, tokensFor } from "./palette"

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
    for (const token of Object.keys(tokensFor("light", "matcha"))) expect([token, declared.has(token)]).toEqual([token, true])
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

  test.each(["light", "dark"] as const)("%s text reads on its paper, and so does the action button", (mode) => {
    const p = PALETTES[mode]
    expect(contrast(p.text, p.canvas)).toBeGreaterThan(12)
    expect(contrast(p.muted, p.canvas)).toBeGreaterThan(3.5)
    expect(contrast(p.onAction, p.action)).toBeGreaterThan(12)
  })

  test.each(["light", "dark"] as const)("every %s accent reads as a link on its paper", (mode) => {
    for (const id of ACCENT_IDS) expect([id, contrast(ACCENTS[id][mode], PALETTES[mode].canvas) > 3]).toEqual([id, true])
  })

  test("an accent colors the marks and your bubble, never the send button", () => {
    const vars = tokensFor("dark", "ramune")
    expect(vars["--ring"]).toBe(ACCENTS.ramune.dark)
    expect(vars["--message-user"]).toContain(ACCENTS.ramune.dark)
    expect(vars["--primary"]).toBe(PALETTES.dark.action)
  })

  test("contrast scales every neutral", () => {
    expect(tokensFor("dark", "blush", 150)["--border"]).toBe(`color-mix(in oklab, ${PALETTES.dark.text} 9%, transparent)`)
  })
})

describe("the fonts", () => {
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
    expect(parseLook(JSON.stringify({ kind: "look", version: 2, accent: DEFAULT_ACCENT })).mode).toBe("dark")
  })

  test("a look survives the round trip", () => {
    const look: Look = { ...DEFAULT_LOOK, mode: "dark", accent: "yuzu", avatars: { ada: { flavour: "matcha", charm: "beret", outfit: "none" } } }
    expect(parseLook(formatLook(look))).toEqual(look)
  })

  test("a record from the old theme system keeps its mode and avatars and drops the rest", () => {
    const old = JSON.stringify({ version: 1, kind: "look", mode: "light", light: "grove", dark: null, themes: [], tint: { hue: 10 }, accent: "#ec4899", birds: { bo: "ramune.none" } })
    expect(parseLook(old)).toEqual({ ...DEFAULT_LOOK, mode: "light", avatars: { bo: { flavour: "ramune" } } })
  })

  test("a version 2 bird record converts once to avatar pins, and the next save writes version 3", () => {
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
    expect(JSON.parse(formatLook(look))).toMatchObject({ version: 3, avatars: look.avatars })
    expect(JSON.parse(formatLook(look))).not.toHaveProperty("birds")
  })

  test("a version 3 record drops values the library does not have, and an entry with none left", () => {
    const v3 = JSON.stringify({
      version: 3, kind: "look", mode: "system", accent: DEFAULT_LOOK.accent, display: DEFAULT_LOOK.display,
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

  function boot(stored: string | null, prefersLight = false) {
    const { root, style, classes, dataset } = fakeRoot()
    const storage = { getItem: (k: string) => (k === CACHE_KEY ? stored : null) }
    new Function("document", "localStorage", "matchMedia", script)({ documentElement: root }, storage, () => ({ matches: prefersLight }))
    return { style, classes, dataset: { appearance: classes.has("dark") ? "dark" : "light" } }
  }
  const cacheOf = (look: Look) => JSON.stringify({ v: 5, text: "x", mode: look.mode, vars: resolveLook(look) })

  test("paints the cached tokens for the saved appearance", () => {
    const { style, dataset, classes } = boot(cacheOf({ ...DEFAULT_LOOK, mode: "light", accent: "matcha" }))
    expect([style["--ring"], style["--boot-bg"], dataset.appearance, classes.has("dark")]).toEqual([ACCENTS.matcha.light, PALETTES.light.canvas, "light", false])
  })

  test("with no cache, or a broken or old one, it paints the dark default whatever the system says", () => {
    expect([boot(null, true).dataset.appearance, boot(null, true).style["--boot-bg"]]).toEqual(["dark", PALETTES.dark.canvas])
    expect([boot(null, false).dataset.appearance, boot(null, false).style["--boot-bg"]]).toEqual(["dark", PALETTES.dark.canvas])
    expect(boot("{ not json", true).dataset.appearance).toBe("dark")
    expect("--bg" in boot(JSON.stringify({ v: 3, mode: "dark", vars: { dark: { "--bg": "#000" } } })).style).toBe(false)
  })

  test("a cache with no mode paints dark", () => {
    expect(boot(JSON.stringify({ v: 5, text: "x", vars: resolveLook(DEFAULT_LOOK) }), true).dataset.appearance).toBe("dark")
  })

  test("the static theme color is the dark canvas", () => {
    expect(html).toContain(`<meta name="theme-color" content="${PALETTES.dark.canvas}" />`)
  })

  test("reads what writeCache writes", () => {
    const store: Record<string, string> = {}
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    }
    writeCache("text", { ...DEFAULT_LOOK, mode: "dark", accent: "lavender" })
    expect(boot(store[CACHE_KEY]!).style["--ring"]).toBe(ACCENTS.lavender.dark)
    delete (globalThis as { localStorage?: unknown }).localStorage
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
