import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildDoc, buildTokensFile, DOC_FILE, TOKENS_FILE } from "../../scripts/gen-theme"
import { parseKat, ROOT } from "../../scripts/theme-tokens"
import { applyCommitted, CACHE_KEY, compileTheme, endPreview, preview, resolveLook, writeCache } from "./apply"
import { DEFAULT_LOOK, DEFAULT_TINT, formatLook, parseLook, STYLES, styleOf, withStyle, type Look } from "./look"
import { KNOWN_TOKENS } from "./known-tokens"
import { PRESETS, presetFor } from "./presets"
import { FIELDS, PRESET_IDS, parseTheme, resolveTheme, type Theme } from "./schema"

const base = { version: 1, name: "t" }

/** Parses and resolves a fixture theme, or throws. */
function res(theme: unknown) {
  const p = parseTheme(theme)
  if (!p.ok) throw new Error(p.errors[0])
  const r = resolveTheme(p.theme, presetFor)
  if (!r.ok) throw new Error(r.error)
  return r.resolved
}

function errorsOf(theme: unknown): string[] {
  const r = parseTheme(theme)
  return r.ok ? [] : r.errors
}

// Each row is a bad theme and the first error it must produce. The error starts with the
// key that is wrong, so a person can find it.
const BAD: [string, unknown, string][] = [
  ["not json", "{ nope", "json: "],
  ["an array", "[]", "json: expected an object"],
  ["a bad version", { ...base, version: 2 }, "version: expected 1, got 2"],
  ["no name", { version: 1 }, "name: expected 1 to 48 characters"],
  ["a long name", { version: 1, name: "x".repeat(49) }, "name: expected 1 to 48 characters"],
  ["raw css", { ...base, css: "body{}" }, "css: unknown key"],
  ["an unknown preset", { ...base, extends: "neon" }, 'extends: expected one of plum, bluebird, ocean, periwinkle, lilac, orchid, sakura, coral, sage, mint, teal, slate, graphite, mono, got "neon"'],
  ["an appearance key", { ...base, appearance: "light" }, "appearance: unknown key"],
  ["a group that is not an object", { ...base, colors: "red" }, 'colors: expected an object, got "red"'],
  ["an unknown color key", { ...base, colors: { accnt: "red" } }, "colors.accnt: unknown key"],
  ["a color that is not one", { ...base, colors: { accent: "big" } }, 'colors.accent: expected a color, got "big"'],
  ["a color that injects", { ...base, colors: { accent: "red; background: url(x)" } }, "colors.accent: expected a color"],
  ["a color that reads a variable", { ...base, colors: { bg: "var(--bg)" } }, "colors.bg: expected a color"],
  ["a color that is a number", { ...base, colors: { text: 5 } }, "colors.text: expected a color, got 5"],
  ["a radius that is not a length", { ...base, radius: { bubble: "big" } }, 'radius.bubble: expected a length, got "big"'],
  ["a spacing that is not a length", { ...base, spacing: { runGap: "lots" } }, 'spacing.runGap: expected a length, got "lots"'],
  ["a size with a bad unit", { ...base, size: { railWidth: "60vw" } }, 'size.railWidth: expected a length, got "60vw"'],
  ["a scale that is a string", { ...base, radius: { scale: "2" } }, 'radius.scale: expected a number, got "2"'],
  ["a font that breaks out", { ...base, type: { sans: "a; b" } }, 'type.sans: expected a font family list, got "a; b"'],
  ["a weight that is not a number", { ...base, type: { weightBold: "bold" } }, 'type.weightBold: expected a number, got "bold"'],
  ["a token that is not in tokens.md", { ...base, tokens: { "--nope": "1px" } }, "tokens.--nope: unknown token"],
  ["a motion token", { ...base, tokens: { "--spring250-duration": "9s" } }, "tokens.--spring250-duration: unknown token"],
  ["a token with a url", { ...base, tokens: { "--tab-shadow": "url(https://x)" } }, "tokens.--tab-shadow: expected a CSS value"],
  ["a token of the wrong kind", { ...base, tokens: { "--bubble-pad-x": "red" } }, 'tokens.--bubble-pad-x: expected a length, got "red"'],
  ["a variant that is not light", { ...base, variants: { dark: {} } }, 'variants.dark: unknown key, only "light" is allowed'],
  ["a bad value in a variant", { ...base, variants: { light: { colors: { bg: "big" } } } }, 'variants.light.colors.bg: expected a color, got "big"'],
  ["a motion key", { ...base, motion: { duration: 300 } }, "motion: unknown key"],
]

describe("a bad theme names the wrong key", () => {
  for (const [label, theme, first] of BAD) {
    test(label, () => {
      const errors = errorsOf(theme)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toStartWith(first)
    })
  }

  test("every problem is reported, not only the first", () => {
    const errors = errorsOf({ ...base, colors: { accent: "big" }, radius: { bubble: "big" }, size: { nope: 1 } })
    expect(errors.map((e) => e.split(":")[0])).toEqual(["colors.accent", "radius.bubble", "size.nope"])
  })

  test("a theme with errors has no theme to apply", () => {
    expect(compileTheme(JSON.stringify({ ...base, colors: { accent: "big" } })).ok).toBe(false)
  })
})

describe("good themes", () => {
  test("a two line theme works and keeps everything else", () => {
    const r = res({ version: 1, name: "blue", colors: { accent: "oklch(0.7 0.14 250)" } })
    expect(r).toEqual({ dark: { "--accent": "oklch(0.7 0.14 250)" }, light: { "--accent": "oklch(0.7 0.14 250)" } })
  })

  test("numbers outside the range are clamped, with a note", () => {
    const r = parseTheme({ ...base, radius: { bubble: 5000 }, type: { lineHeight: 99, weightBold: 1000 } })
    expect(r.ok && r.theme.radius?.bubble).toBe("999px")
    expect(r.ok && r.theme.type?.lineHeight).toBe(3)
    expect(r.ok && r.theme.type?.weightBold).toBe(900)
    expect(r.ok && r.notes).toContain("radius.bubble: clamped to 999px")
  })

  test("a number is pixels and a string keeps its unit", () => {
    expect(res({ ...base, spacing: { runGap: 20, rowGap: "0.25rem" } }).dark).toEqual({ "--run-gap": "20px", "--row-gap": "0.25rem" })
  })

  test("scale multiplies the default and a set value, and leaves the pill alone", () => {
    expect(res({ ...base, radius: { scale: 0.5, small: "20px" } }).dark).toEqual({
      "--radius-bubble": "9px",
      "--radius-bubble-tight": "4px",
      "--radius-sm": "10px",
      "--radius-row": "10px",
    })
  })

  test("tokens are applied after the groups", () => {
    expect(res({ ...base, colors: { bg: "#000" }, tokens: { "--bg": "#111", "--l-bg": 0.5, "--tab-shadow": "0 1px 2px #000" } }).dark).toEqual({ "--bg": "#111", "--l-bg": "0.5", "--tab-shadow": "0 1px 2px #000" })
  })

  test("extends inherits, and the child wins", () => {
    const r = res({ ...base, extends: "bluebird", colors: { accent: "#c00" } })
    expect(r.dark["--accent"]).toBe("#c00")
    expect(r.dark["--hue"]).toBe("245") // from bluebird
    expect(r.light["--hue"]).toBe("245")
  })

  test("a light variant layers on top for the light appearance only", () => {
    const r = res({ ...base, colors: { bg: "#111" }, variants: { light: { colors: { bg: "#eee" }, tokens: { "--scrim": "#0004" } } } })
    expect(r.light).toEqual({ "--bg": "#eee", "--scrim": "#0004" })
    expect(r.dark).toEqual({ "--bg": "#111" })
  })

  test("mono flips the own bubble between appearances", () => {
    const r = res(PRESETS.mono)
    expect([r.dark["--l-brand-user"], r.light["--l-brand-user"]]).toEqual(["0.9", "0.22"])
  })

  test("a chain that loops or runs too long is an error, not a hang", () => {
    const loop: Theme = { version: 1, name: "a", extends: "x" }
    const r = resolveTheme(loop, () => loop)
    expect(r.ok).toBe(false)
  })

  test("every preset is valid and resolves", () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_IDS].sort())
    for (const [id, preset] of Object.entries(PRESETS)) {
      const c = compileTheme(JSON.stringify(preset))
      expect(c.ok, id).toBe(true)
    }
  })
})

describe("every token is reachable", () => {
  const tokensMd = readFileSync(join(ROOT, "packages/ui/src/styles/tokens.md"), "utf8")
  const named = [...new Set([...tokensMd.matchAll(/`(--[a-z0-9-]+)`/g)].map((m) => m[1]!))]
  const viaField = new Set(FIELDS.map((f) => f.variable))

  test("tokens.md names variables", () => {
    expect(named.length).toBeGreaterThan(60)
  })

  test("each one has a key in the format or is in the tokens table", () => {
    const missing = named.filter((n) => !viaField.has(n) && !(n in KNOWN_TOKENS))
    expect(missing).toEqual([])
  })

  test("a theme can set each one through tokens, with a value of its kind", () => {
    const sample = { color: "#123456", length: "10px", number: 0.5, font: "serif", weight: 500, any: "none" } as const
    const failures: string[] = []
    for (const [name, kind] of Object.entries(KNOWN_TOKENS)) {
      const r = parseTheme({ ...base, tokens: { [name]: sample[kind] } })
      if (!r.ok) failures.push(r.errors[0]!)
    }
    expect(failures).toEqual([])
  })

  test("the format has no motion", () => {
    expect([...viaField, ...Object.keys(KNOWN_TOKENS)].filter((v) => /spring|ease|duration|transition|animation/.test(v))).toEqual([])
  })
})

describe("the files that follow kat.css", () => {
  const css = readFileSync(join(ROOT, "packages/ui/src/styles/kat.css"), "utf8")

  test("known-tokens.ts is current", () => {
    expect(readFileSync(TOKENS_FILE, "utf8")).toBe(buildTokensFile(css))
  })

  test("docs/theming.md is current", () => {
    expect(readFileSync(DOC_FILE, "utf8")).toBe(buildDoc(css))
  })

  test("a field default matches kat.css", () => {
    const defaults = parseKat(css)
    for (const f of FIELDS) {
      if (f.default === undefined || f.variable.endsWith("-scale")) continue
      expect([f.variable, defaults.get(f.variable)]).toEqual([f.variable, f.default])
    }
  })

  test("every field variable is declared in kat.css or is derived from one", () => {
    const defaults = parseKat(css)
    // --danger, --success and --gold were once registered but never declared, so they rendered transparent.
    const undeclared = FIELDS.filter((f) => !f.variable.endsWith("-scale") && !defaults.has(f.variable)).map((f) => f.variable)
    expect(undeclared.sort()).toEqual([])
  })
})

describe("the look record", () => {
  test("nothing stored, or anything unreadable, is the default look", () => {
    for (const text of [null, "", "{ nope", "[]", JSON.stringify({ version: 1, kind: "look", mode: "neon", preset: "nope" })]) {
      expect(parseLook(text)).toEqual(DEFAULT_LOOK)
    }
  })

  test("an older record that is a bare theme becomes a custom theme", () => {
    const look = parseLook(JSON.stringify({ version: 1, name: "old", colors: { accent: "#c00" } }))
    expect(look.mode).toBe("system")
    expect("custom" in look.theme && look.theme.custom.name).toBe("old")
  })

  test("a look survives the round trip, and bad bird entries are dropped", () => {
    const look: Look = { mode: "light", material: "solid", tint: 0.25, theme: { preset: "sage" }, wallpaper: null, glass: 0.85, birds: { scout: "cardinal.2.leaf" } }
    expect(parseLook(formatLook(look))).toEqual(look)
    const raw = JSON.parse(formatLook(look))
    raw.birds = { scout: "cardinal.2.leaf", "Bad Slug": "x", other: "<script>" }
    expect(parseLook(JSON.stringify(raw)).birds).toEqual({ scout: "cardinal.2.leaf" })
  })

  test("a look without a material or tint is frost at the default tint, and a tint is clamped", () => {
    const old = parseLook(JSON.stringify({ version: 1, kind: "look", mode: "dark", preset: "sage", birds: {} }))
    expect([old.material, old.tint]).toEqual(["frost", DEFAULT_TINT])
    const loud = parseLook(JSON.stringify({ version: 1, kind: "look", mode: "dark", material: "chrome", tint: 7 }))
    expect([loud.material, loud.tint]).toEqual(["frost", 1])
    expect(parseLook(JSON.stringify({ version: 1, kind: "look", tint: -1 })).tint).toBe(0)
  })

  test("the three styles map to a material and an appearance, and back", () => {
    const base = { ...DEFAULT_LOOK, mode: "system" as const }
    expect(withStyle(base, "graphite")).toMatchObject({ material: "solid", mode: "dark" })
    expect(withStyle(base, "porcelain")).toMatchObject({ material: "solid", mode: "light" })
    expect(withStyle({ ...base, material: "solid", mode: "light" }, "frost")).toMatchObject({ material: "frost", mode: "light" })
    for (const style of STYLES) {
      const look = withStyle(base, style)
      const appearance = look.mode === "light" ? "light" : "dark"
      expect(styleOf(look, appearance)).toBe(style)
    }
  })

  test("the server keeps it, because it is a version 1 object", () => {
    expect(JSON.parse(formatLook(DEFAULT_LOOK)).version).toBe(1)
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
      set colorScheme(v: string) { style.colorScheme = v },
      set backgroundColor(v: string) { style.backgroundColor = v },
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

  test("sets the variables and the appearance, previews, reverts, and clears what a reset leaves", () => {
    const { root, style, classes, dataset } = fakeRoot()
    g.document = { documentElement: root }
    const custom: Look = { mode: "dark", material: "solid", tint: 0.5, theme: { custom: { version: 1, name: "c", colors: { accent: "#c00" } } }, wallpaper: null, glass: 0.85, birds: {} }
    applyCommitted(custom)
    expect([style["--accent"], dataset.appearance, classes.has("dark")]).toEqual(["#c00", "dark", true])
    preview({ mode: "light", material: "solid", tint: 0.5, theme: { preset: "mono" }, wallpaper: null, glass: 0.85, birds: {} })
    expect([style["--accent"] ?? "", style["--l-brand-user"], dataset.appearance, classes.has("dark")]).toEqual(["", "0.22", "light", false])
    endPreview()
    expect([style["--accent"], "--l-brand-user" in style, dataset.appearance]).toEqual(["#c00", false, "dark"])
    expect([dataset.material, style["--tinge"]]).toEqual(["solid", "0.5"])
    applyCommitted({ ...DEFAULT_LOOK, mode: "dark" })
    expect(Object.keys(style).filter((k) => k.startsWith("--") && k !== "--boot-bg" && k !== "--tinge" && k !== "--glass")).toEqual([])
    expect([dataset.material, style["--tinge"]]).toEqual(["frost", String(DEFAULT_TINT)])
  })
})

describe("a wallpaper", () => {
  const g = globalThis as { document?: unknown }
  afterEach(() => {
    delete g.document
  })
  const pic = "data:image/webp;base64,UklGRg=="

  test("round-trips with the glass, and the glass is clamped", () => {
    const look: Look = { ...DEFAULT_LOOK, wallpaper: pic, glass: 0.6 }
    expect(parseLook(formatLook(look))).toEqual(look)
    const raw = JSON.parse(formatLook(look))
    expect(parseLook(JSON.stringify({ ...raw, glass: 0.01 })).glass).toBe(0.15)
    expect(parseLook(JSON.stringify({ ...raw, glass: 9 })).glass).toBe(1)
    expect(parseLook(JSON.stringify({ ...raw, wallpaper: "javascript:x" })).wallpaper).toBe(null)
  })

  test("paints under frost and not under solid", () => {
    const { root, style, dataset } = fakeRoot()
    g.document = { documentElement: root }
    applyCommitted({ ...DEFAULT_LOOK, mode: "dark", wallpaper: pic, glass: 0.7 })
    expect(["wallpaper" in dataset, style["--wallpaper"], style["--glass"]]).toEqual([true, `url("${pic}")`, "0.7"])
    applyCommitted({ ...DEFAULT_LOOK, mode: "dark", material: "solid", wallpaper: pic })
    expect(["wallpaper" in dataset, "--wallpaper" in style]).toEqual([false, false])
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
  const cacheOf = (look: Look) => JSON.stringify({ v: 2, text: "x", mode: look.mode, material: look.material, tint: look.tint, vars: resolveLook(look) })

  test("paints the cached variables for the saved appearance", () => {
    const { style, dataset, classes } = boot(cacheOf({ mode: "light", material: "solid", tint: 0.5, theme: { preset: "mono" }, wallpaper: null, glass: 0.85, birds: {} }))
    expect([style["--l-brand-user"], dataset.appearance, classes.has("dark")]).toEqual(["0.22", "light", false])
  })

  test("system follows the system", () => {
    const cache = cacheOf({ mode: "system", material: "solid", tint: 0.5, theme: { preset: "mono" }, wallpaper: null, glass: 0.85, birds: {} })
    expect(boot(cache, true).dataset.appearance).toBe("light")
    expect(boot(cache, false).style["--l-brand-user"]).toBe("0.9")
  })

  test("paints the material and tint before first paint, and frost without a cache", () => {
    const { style, dataset } = boot(cacheOf({ mode: "dark", material: "solid", tint: 0.2, theme: { preset: "mono" }, wallpaper: null, glass: 0.85, birds: {} }))
    expect([dataset.material, style["--tinge"]]).toEqual(["solid", "0.2"])
    expect([boot(null).dataset.material, boot(null).style["--tinge"]]).toEqual(["frost", "0.5"])
  })

  test("falls back to the system appearance with no cache or a broken one", () => {
    expect([boot(null).style["--boot-bg"], boot(null).dataset.appearance]).toEqual(["#141414", "dark"])
    expect(boot("{ not json", true).dataset.appearance).toBe("light")
  })

  test("reads what writeCache writes", () => {
    const store: Record<string, string> = {}
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    }
    const look: Look = { mode: "dark", material: "solid", tint: 0.5, theme: { custom: { version: 1, name: "g", colors: { accent: "#0a0" } } }, wallpaper: null, glass: 0.85, birds: {} }
    writeCache("text", look)
    expect(boot(store[CACHE_KEY]!).style["--accent"]).toBe("#0a0")
    writeCache("text", { ...look, material: "frost", wallpaper: "data:image/webp;base64,UklGRg==", glass: 0.6 })
    const booted = boot(store[CACHE_KEY]!)
    expect(["wallpaper" in booted.dataset, booted.style["--wallpaper"], booted.style["--glass"]]).toEqual([true, 'url("data:image/webp;base64,UklGRg==")', "0.6"])
    delete (globalThis as { localStorage?: unknown }).localStorage
  })
})
