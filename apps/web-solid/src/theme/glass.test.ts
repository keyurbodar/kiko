import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BACKGROUND_KEY, DEFAULT_GLASS, GLASS_KEY, glassRoot, parseBackground, parseGlass, type Background } from "./glass"

const desktop = "data:image/webp;base64,UklGRg=="
const picked: Background = { id: "a1b2", desktop, effect: "halftone", scope: "empty", empty: 0.4, session: 0.1 }

describe("glass settings", () => {
  test("nothing stored, or anything unreadable, is monocode's default: 85% opacity, 24 blur, main pane glass on", () => {
    for (const text of [null, "", "{ nope", "[]"]) expect(parseGlass(text)).toEqual(DEFAULT_GLASS)
    expect(DEFAULT_GLASS).toEqual({ opacity: 0.85, blur: 24, body: true })
  })

  test("values are clamped to monocode's ranges", () => {
    expect(parseGlass(JSON.stringify({ opacity: 0.01, blur: 999, body: false }))).toEqual({ opacity: 0.15, blur: 64, body: false })
    expect(parseGlass(JSON.stringify({ opacity: 0.333, blur: 12.6 }))).toEqual({ opacity: 0.33, blur: 13, body: true })
  })

  test("a background that could break out of its url, or has no picture, is none", () => {
    expect(parseBackground(JSON.stringify(picked))).toEqual(picked)
    expect(parseBackground(JSON.stringify({ ...picked, desktop: 'data:image/png;base64,") ; x' }))).toBeNull()
    expect(parseBackground(JSON.stringify({ ...picked, desktop: "https://example.com/a.png" }))).toBeNull()
    expect(parseBackground(JSON.stringify({ ...picked, id: "../x" }))).toBeNull()
    expect(parseBackground(JSON.stringify({ ...picked, effect: "sparkle", empty: 2 }))).toEqual({ ...picked, effect: "none", empty: 0.65 })
  })
})

// A stand-in for the page, to prove what reaches the root element.
function fakeRoot() {
  const attrs: Record<string, string> = {}
  const style: Record<string, string> = {}
  const root = {
    dataset: {} as Record<string, string>,
    setAttribute: (k: string, v: string) => void (attrs[k] = v),
    removeAttribute: (k: string) => void delete attrs[k],
    style: {
      setProperty: (k: string, v: string) => void (style[k] = v),
      set colorScheme(_: string) {},
      set backgroundColor(_: string) {},
    },
    classList: { toggle: () => {} },
  }
  return { root, attrs, style }
}

describe("the pre-paint script", () => {
  const html = readFileSync(join(import.meta.dir, "../../index.html"), "utf8")
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!

  function boot(glass: string | null, background: string | null) {
    const { root, attrs, style } = fakeRoot()
    const stored: Record<string, string | null> = { [GLASS_KEY]: glass, [BACKGROUND_KEY]: background }
    new Function("document", "localStorage", "matchMedia", script)({ documentElement: root }, { getItem: (k: string) => stored[k] ?? null }, () => ({ matches: false }))
    return { attrs, style }
  }

  // The inline script cannot import glass.ts, so it repeats glassRoot(). Here both run on the same input.
  const cases: [string | null, string | null][] = [
    [null, null],
    [JSON.stringify({ opacity: 0.5, blur: 40, body: false }), JSON.stringify(picked)],
    [JSON.stringify({ opacity: 9, blur: -1 }), JSON.stringify({ ...picked, effect: "sparkle", scope: "nope", empty: 0.01 })],
    ["{ nope", JSON.stringify({ ...picked, desktop: "javascript:alert(1)" })],
  ]
  for (const [glass, background] of cases) {
    test(`paints what glassRoot() says for ${glass ?? "nothing"} and ${background ? "a background" : "none"}`, () => {
      const want = glassRoot(parseGlass(glass), parseBackground(background))
      const got = boot(glass, background)
      const attrs = Object.fromEntries(Object.entries(want.attrs).filter((e): e is [string, string] => e[1] !== null))
      expect(Object.fromEntries(Object.entries(got.attrs).filter(([k]) => k in want.attrs))).toEqual(attrs)
      for (const [name, value] of Object.entries(want.vars)) expect([name, got.style[name]]).toEqual([name, value])
    })
  }
})
