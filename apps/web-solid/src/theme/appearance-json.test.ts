import { describe, expect, test } from "bun:test"
import { formatDoc, fromDoc, toDoc } from "./appearance-json"
import { DEFAULT_GLASS } from "./glass"
import { DEFAULT_LOOK, parseLook, formatLook } from "./look"

const themes = new Set(["t3-chat", "grove"])
const current = toDoc(DEFAULT_LOOK, DEFAULT_GLASS, null)

describe("the appearance json", () => {
  test("the document of the current settings reads back to the same settings", () => {
    const out = fromDoc(formatDoc(current), current, themes)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(toDoc({ ...DEFAULT_LOOK, ...out.value.look }, out.value.glass, out.value.background)).toEqual(current)
  })

  test("a short document changes only what it names", () => {
    const out = fromDoc(`{ "mode": "light", "tokens": { "dark": { "--accent": "#ff5500" } } }`, current, themes)
    expect(out.ok && out.value.look.mode).toBe("light")
    expect(out.ok && out.value.look.tint).toEqual(current.tint)
    expect(out.ok && out.value.look.tokens).toEqual({ light: {}, dark: { "--accent": "#ff5500" } })
  })

  test("a mistake is a sentence that names where it is", () => {
    const error = (text: string) => {
      const out = fromDoc(text, current, themes)
      return out.ok ? null : out.error
    }
    expect(error("{ nope")).toStartWith("not valid json")
    expect(error(`{ "colour": 1 }`)).toContain("colour is not a setting")
    expect(error(`{ "tint": { "hue": 400 } }`)).toBe("tint.hue must be a number from 0 to 360.")
    expect(error(`{ "theme": { "dark": "nope" } }`)).toContain("theme.dark must be null")
    expect(error(`{ "accent": "red" }`)).toContain("accent must be null or a color")
  })

  test("a token cannot leave its declaration or load anything", () => {
    for (const value of ["red; } body { display: none", "url(https://x.test/a.png)", "<script>"]) {
      const out = fromDoc(JSON.stringify({ tokens: { dark: { "--bg": value } } }), current, themes)
      expect(out.ok).toBe(false)
    }
    expect(fromDoc(JSON.stringify({ tokens: { dark: { "not-a-var": "red" } } }), current, themes).ok).toBe(false)
  })

  test("tokens travel with the stored look, and unsafe stored ones are dropped", () => {
    const look = { ...DEFAULT_LOOK, tokens: { light: { "--accent": "#123456" }, dark: {} } }
    expect(parseLook(formatLook(look)).tokens).toEqual(look.tokens)
    const tampered = JSON.parse(formatLook(look))
    tampered.tokens.dark = { "--bg": "red;}", "--text": "white" }
    expect(parseLook(JSON.stringify(tampered)).tokens.dark).toEqual({ "--text": "white" })
  })
})
