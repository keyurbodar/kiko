import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildDoc, buildTokensFile, DOC_FILE, TOKENS_FILE } from "../../scripts/gen-theme"
import { parseKat, ROOT } from "../../scripts/theme-tokens"
import { applyCommitted, CACHE_KEY, compileTheme, endPreview, preview, writeCache } from "./apply"
import { KNOWN_TOKENS } from "./known-tokens"
import { PRESETS } from "./presets"
import { FIELDS, PRESET_IDS, parseTheme, resolveTheme, type Theme } from "./schema"

const base = { version: 1, name: "t" }

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
  ["an unknown preset", { ...base, extends: "neon" }, 'extends: expected one of kat-dark, kat-light, ink, paper, got "neon"'],
  ["a bad appearance", { ...base, appearance: "blue" }, 'appearance: expected "dark" or "light", got "blue"'],
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
    const c = compileTheme(JSON.stringify({ version: 1, name: "blue", colors: { accent: "oklch(0.7 0.14 250)" } }))
    expect(c.ok && c.resolved.base).toEqual({ appearance: "dark", vars: { "--accent": "oklch(0.7 0.14 250)" } })
  })

  test("numbers outside the range are clamped, with a note", () => {
    const r = parseTheme({ ...base, radius: { bubble: 5000 }, type: { lineHeight: 99, weightBold: 1000 } })
    expect(r.ok && r.theme.radius?.bubble).toBe("999px")
    expect(r.ok && r.theme.type?.lineHeight).toBe(3)
    expect(r.ok && r.theme.type?.weightBold).toBe(900)
    expect(r.ok && r.notes).toContain("radius.bubble: clamped to 999px")
  })

  test("a number is pixels and a string keeps its unit", () => {
    const c = compileTheme(JSON.stringify({ ...base, spacing: { runGap: 20, rowGap: "0.25rem" } }))
    expect(c.ok && c.resolved.base.vars).toEqual({ "--run-gap": "20px", "--row-gap": "0.25rem" })
  })

  test("scale multiplies the default and a set value, and leaves the pill alone", () => {
    const c = compileTheme(JSON.stringify({ ...base, radius: { scale: 0.5, small: "20px" } }))
    expect(c.ok && c.resolved.base.vars).toEqual({
      "--radius-bubble": "9px",
      "--radius-bubble-tight": "4px",
      "--radius-sm": "10px",
      "--radius-row": "10px",
    })
  })

  test("tokens are applied after the groups", () => {
    const c = compileTheme(JSON.stringify({ ...base, colors: { bg: "#000" }, tokens: { "--bg": "#111", "--l-bg": 0.5, "--tab-shadow": "0 1px 2px #000" } }))
    expect(c.ok && c.resolved.base.vars).toEqual({ "--bg": "#111", "--l-bg": "0.5", "--tab-shadow": "0 1px 2px #000" })
  })

  test("extends inherits, and the child wins", () => {
    const c = compileTheme(JSON.stringify({ ...base, extends: "paper", colors: { accent: "#c00" } }))
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.resolved.base.appearance).toBe("light")
    expect(c.resolved.base.vars["--accent"]).toBe("#c00")
    expect(c.resolved.base.vars["--bg"]).toBe("oklch(0.965 0.012 85)") // from paper
    expect(c.resolved.base.vars["--text"]).toBe("oklch(0.3248 0.012 55)") // from kat light, through paper
    expect(c.resolved.base.vars["--radius-bubble"]).toBe("22px")
  })

  test("a light variant resolves a second set", () => {
    const c = compileTheme(JSON.stringify({ ...base, colors: { bg: "#111" }, variants: { light: { colors: { bg: "#eee" }, tokens: { "--scrim": "#0004" } } } }))
    expect(c.ok && c.resolved.light).toEqual({ appearance: "light", vars: { "--bg": "#eee", "--scrim": "#0004" } })
    expect(c.ok && c.resolved.base.vars).toEqual({ "--bg": "#111" })
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
    // --danger, --success and --gold are registered and read, but kat.css never declares them.
    const undeclared = FIELDS.filter((f) => !f.variable.endsWith("-scale") && !defaults.has(f.variable)).map((f) => f.variable)
    expect(undeclared.sort()).toEqual(["--danger", "--gold", "--success"])
  })
})

// A stand-in for the page, to prove what reaches the root element.
function fakeRoot() {
  const style: Record<string, string> = {}
  const classes = new Set<string>(["dark"])
  const root = {
    style: {
      setProperty: (k: string, v: string) => void (style[k] = v),
      removeProperty: (k: string) => void delete style[k],
      set colorScheme(v: string) { style.colorScheme = v },
      set backgroundColor(v: string) { style.backgroundColor = v },
    },
    classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) },
  }
  return { root, style, classes }
}

describe("applying", () => {
  const g = globalThis as { document?: unknown }
  afterEach(() => {
    delete g.document
  })

  test("sets the variables, previews, reverts, and removes what a reset leaves behind", () => {
    const { root, style, classes } = fakeRoot()
    g.document = { documentElement: root }
    const a = compileTheme(JSON.stringify({ ...base, extends: "kat-light", colors: { accent: "#c00" } }))
    const b = compileTheme(JSON.stringify({ ...base, colors: { accent: "#00c" }, radius: { bubble: 2 } }))
    if (!a.ok || !b.ok) throw new Error("fixture")
    applyCommitted(a.resolved)
    expect(style["--accent"]).toBe("#c00")
    expect(classes.has("dark")).toBe(false)
    preview(b.resolved)
    expect([style["--accent"], style["--radius-bubble"], classes.has("dark")]).toEqual(["#00c", "2px", true])
    endPreview()
    expect([style["--accent"], "--radius-bubble" in style, classes.has("dark")]).toEqual(["#c00", false, false])
    applyCommitted(null)
    expect(Object.keys(style).filter((k) => k.startsWith("--") && k !== "--boot-bg")).toEqual([])
    expect(classes.has("dark")).toBe(true)
  })
})

describe("the pre-paint script", () => {
  const html = readFileSync(join(import.meta.dir, "../../index.html"), "utf8")
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!

  function boot(stored: string | null, prefersLight = false) {
    const { root, style, classes } = fakeRoot()
    const storage = { getItem: (k: string) => (k === CACHE_KEY ? stored : null) }
    new Function("document", "localStorage", "matchMedia", script)({ documentElement: root }, storage, () => ({ matches: prefersLight }))
    return { style, classes }
  }

  test("paints the cached variables before anything else", () => {
    const c = compileTheme(JSON.stringify({ ...base, extends: "kat-light", colors: { accent: "#c00" }, radius: { bubble: 3 } }))
    if (!c.ok) throw new Error("fixture")
    const cache = { v: 1, text: "x", theme: c.resolved }
    const { style, classes } = boot(JSON.stringify(cache))
    expect(style["--accent"]).toBe("#c00")
    expect(style["--radius-bubble"]).toBe("3px")
    expect(style["--boot-bg"]).toBe(c.resolved.base.vars["--bg"])
    expect(classes.has("dark")).toBe(false)
  })

  test("uses the light variant when the system prefers light", () => {
    const c = compileTheme(JSON.stringify({ ...base, colors: { bg: "#111" }, variants: { light: { colors: { bg: "#eee" } } } }))
    if (!c.ok) throw new Error("fixture")
    const cache = JSON.stringify({ v: 1, text: "x", theme: c.resolved })
    expect(boot(cache, true).style["--bg"]).toBe("#eee")
    expect(boot(cache, false).style["--bg"]).toBe("#111")
  })

  test("falls back to the dark shell with no cache or a broken one", () => {
    expect(boot(null).style["--boot-bg"]).toBe("#1c1b1f")
    expect(boot("{ not json").style["--boot-bg"]).toBe("#1c1b1f")
  })

  test("reads what writeCache writes", () => {
    const store: Record<string, string> = {}
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    }
    const c = compileTheme(JSON.stringify({ ...base, colors: { accent: "#0a0" } }))
    if (!c.ok) throw new Error("fixture")
    writeCache("text", c.resolved)
    expect(boot(store[CACHE_KEY]!).style["--accent"]).toBe("#0a0")
    delete (globalThis as { localStorage?: unknown }).localStorage
  })
})
