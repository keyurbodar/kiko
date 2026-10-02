import { describe, expect, test } from "bun:test"
import { copySymbol } from "./sprite-subset"

const sprite = `<svg><defs>
<symbol viewBox="0 0 24 24" id="Zip"><path fill="#afb42b" d="M1 1"></path></symbol>
<symbol viewBox="0 0 32 32" id="Svg"><defs><linearGradient id="a"><stop offset="0"/></linearGradient></defs><path fill="url(#a)" d="M2 2"/><use href="#a"/></symbol>
<symbol viewBox="0 0 32 32" id="Svelte"><linearGradient id="a"/><path fill="url(#a)"/></symbol>
</defs></svg>`

describe("copySymbol", () => {
  test("copies one symbol under its new id and nothing else", () => {
    expect(copySymbol(sprite, "Zip", "fi-Zip")).toBe(`<symbol viewBox="0 0 24 24" id="fi-Zip"><path fill="#afb42b" d="M1 1"></path></symbol>`)
  })

  test("prefixes inner ids and every reference to them, so two copies never share a gradient", () => {
    const svg = copySymbol(sprite, "Svg", "fi-Svg")!
    expect(svg).toContain(`id="fi-Svg"`)
    expect(svg).toContain(`<linearGradient id="fi-Svg-a">`)
    expect(svg).toContain(`fill="url(#fi-Svg-a)"`)
    expect(svg).toContain(`href="#fi-Svg-a"`)
    expect(svg).not.toContain(`id="a"`)
    expect(svg).not.toContain("Svelte")
    expect(copySymbol(sprite, "Svelte", "fi-Svelte")).toContain(`url(#fi-Svelte-a)`)
  })

  test("a missing name copies nothing", () => {
    expect(copySymbol(sprite, "Nope", "fi-Nope")).toBeNull()
  })
})
