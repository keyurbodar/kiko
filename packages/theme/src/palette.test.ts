import { describe, expect, it } from "vitest"
import { PALETTES, tokensFor } from "./palette"

describe("syntax colours", () => {
  it("paints Cursor's syntax colours for the built-in themes", () => {
    expect(tokensFor("dark")["--syntax-keyword"]).toBe("#82d2ce")
    expect(tokensFor("light", "light-high-contrast")["--syntax-string"]).toBe("#8f84e0")
  })

  it("paints an imported theme's own syntax colours", () => {
    const syntax = { keyword: "#cba6f7", string: "#a6e3a1", func: "#89b4fa", comment: "#9399b2" }
    const tokens = tokensFor("dark", undefined, 100, { palette: PALETTES.dark, syntax })
    expect(tokens["--syntax-keyword"]).toBe("#cba6f7")
    expect(tokens["--syntax-string"]).toBe("#a6e3a1")
    expect(tokens["--syntax-function"]).toBe("#89b4fa")
    expect(tokens["--syntax-comment"]).toBe("#9399b2")
  })
})
